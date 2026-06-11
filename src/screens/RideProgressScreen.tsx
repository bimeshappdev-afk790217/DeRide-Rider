import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Alert, ActivityIndicator, Share,
} from "react-native";
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { ethers } from "ethers";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Shadow } from "../theme";
import { postRideRequest, pollForAcceptance, clearRelayMessage, generateRideId } from "../services/api";
import { getPolUsdFromOracle } from "../services/chainlinkOracle";
import { WebRTCGPSAnswerer } from "../services/WebRTCGPS";

const _ESCROW_ENV = process.env.EXPO_PUBLIC_RIDE_ESCROW_ADDRESS;
if (!_ESCROW_ENV) console.error("[RideEscrow] EXPO_PUBLIC_RIDE_ESCROW_ADDRESS not set — escrow calls will fail");
const ESCROW_ADDR   = _ESCROW_ENV ?? "";

const _DA_ENV = process.env.EXPO_PUBLIC_DRIVER_AVAILABILITY_ADDRESS;
if (!_DA_ENV) console.error("[DriverAvailability] EXPO_PUBLIC_DRIVER_AVAILABILITY_ADDRESS not set — driver online check will fail");
const DRIVER_AVAIL  = _DA_ENV ?? "";
const POLYGON_RPC   = "https://polygon-mainnet.g.alchemy.com/v2/Q25ZjjJ1haH3RxjFuVWuS";
const MATCHING_HTTP = "http://157.230.59.42:3000";
const MATCHING_WS   = "ws://157.230.59.42:3000";
const AVAIL_ABI     = ["function isOnline(address) external view returns (bool)"];
const ESCROW_ABI    = [
  "function createRide(bytes32,address,address,bytes32,uint256,uint8) external payable",
  "function createRide(bytes32,address,address,bytes32,uint256,uint8,uint256,bytes) external payable",
  "function confirmPickupByRider(bytes32) external",
  "function confirmRide(bytes32,bytes32) external",
  "function disputeRide(bytes32,bytes32) external",
  "function escalateDispute(bytes32) external",
  "function cancelRide(bytes32) external",
  "function getRideStatus(bytes32) external view returns (uint8)",
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


export const RideProgressScreen = ({ route, navigation }: any) => {
  const { colors } = useTheme();
  const _p = route.params;
  const driver          = _p.driver;
  const destination     = _p.destination;
  const pickupLat       = parseFloat(_p.pickupLat);
  const pickupLng       = parseFloat(_p.pickupLng);
  const destLat         = parseFloat(_p.destLat);
  const destLng         = parseFloat(_p.destLng);
  const offerMultiplier: number = _p.offerMultiplier ?? 100;
  const nodeAddress: string = _p.nodeAddress ?? "";

  type Status =
    | "confirming"          // calling /riders/confirm HTTP
    | "creating_escrow"     // calling createRide on blockchain
    | "waiting_pickup"      // showing PIN, waiting for pickup confirmation
    | "driver_arriving"     // pickup confirmed, driver en route
    | "pending_confirmation"// driver submitted proof
    | "completed"           // rider confirmed ride
    | "disputed"            // rider raised dispute
    | "escalated"           // escalated to DAO after dispute
    | "failed";

  const [status, setStatus]           = useState<Status>("confirming");
  const [rideId, setRideId]           = useState<string | null>(null);
  const [pin, setPin]                 = useState<number | null>(null);
  const [txHash, setTxHash]           = useState<string | null>(null);
  const [fareUSD, setFareUSD]         = useState(driver.fareUSD ?? 0);
  const [eta, setEta]                 = useState(driver.eta ?? 5);
  const [etaMinutes, setEtaMinutes]   = useState<number | null>(driver.eta ?? null);
  const originalEtaMins               = useRef<number>(driver.eta ?? 5);
  const [driverLoc, setDriverLoc]     = useState<{ lat: number; lng: number } | null>(null);
  const [riderPos,  setRiderPos]      = useState({ lat: pickupLat, lng: pickupLng });
  const [elapsed, setElapsed]             = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [disputedAt, setDisputedAt]   = useState<number | null>(null);
  const riderWalletRef       = useRef("");
  const privateKeyRef        = useRef("");
  const fadeAnim             = useRef(new Animated.Value(0)).current;
  const isBlockchainFallback = useRef(false);
  const webRTCAnswererRef    = useRef<WebRTCGPSAnswerer | null>(null);
  const gpsLogRef            = useRef<Array<{ lat: number; lng: number; ts: number }>>([]);
  const [usingWebRTC, setUsingWebRTC] = useState(false);

  useEffect(() => {
    console.log("RideProgress mounted");
    console.log("Params:", JSON.stringify(route.params));
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    loadWalletAndStart();
    (async () => {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setRiderPos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch { /* keep param coords */ }
    })();
  }, []);

  // Ride timer — starts when rider confirms pickup
  useEffect(() => {
    if (status !== "driver_arriving") return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Record GPS every 10s during the ride
  useEffect(() => {
    if (status !== "driver_arriving" && status !== "pending_confirmation") return;
    const interval = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        gpsLogRef.current.push({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          ts:  Math.floor(loc.timestamp / 1000),
        });
      } catch { /* skip if location unavailable */ }
    }, 10_000);
    return () => clearInterval(interval);
  }, [status]);

  // Poll RideEscrow.getRideStatus() every 5s after escrow is created
  useEffect(() => {
    if (!rideId) return;
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, provider);
    let active = true;
    const poll = setInterval(async () => {
      try {
        const s = Number(await escrow.getRideStatus(rideId));
        console.log("[POLL] rideStatus:", s);
        if (!active) return;
        if (s === 1) { console.log("[POLL] Updating UI to InProgress"); setStatus("driver_arriving"); } // InProgress
        if (s === 2) setStatus("pending_confirmation"); // PendingConfirmation
        if (s === 3) { clearInterval(poll); setStatus("disputed"); }    // Disputed
        if (s === 4) { clearInterval(poll); setStatus("escalated"); }   // Escalated
        if (s === 5) { clearInterval(poll); setStatus("completed"); }   // Completed
      } catch (e: any) {
        console.warn("[POLL] getRideStatus error:", e.message);
      }
    }, 5000);
    return () => { active = false; clearInterval(poll); };
  }, [rideId]);

  // GPS relay: WebSocket when server available, WebRTC data channel in blockchain fallback mode
  useEffect(() => {
    if (!rideId || !riderWalletRef.current) return;

    if (isBlockchainFallback.current) {
      // Matching server was unreachable — attempt WebRTC P2P GPS relay.
      // Wrapped in try/catch: if react-native-webrtc causes a native bridge abort
      // in Expo Go (not catchable inside start()), this guard ensures the ride
      // handshake (acceptance polling in fallbackViaRelay) is never disrupted.
      try {
        const privateKey  = privateKeyRef.current;
        const riderWallet = riderWalletRef.current;
        if (privateKey && riderWallet) {
          const answerer = new WebRTCGPSAnswerer();
          answerer.onGPSUpdate = (lat, lng) => {
            setDriverLoc({ lat, lng });
            const distKm  = haversineKm(lat, lng, pickupLat, pickupLng);
            const etaMins = Math.round((distKm / 30) * 60);
            setEtaMinutes(etaMins);
            setEta(etaMins);
          };
          answerer.onConnected    = () => setUsingWebRTC(true);
          answerer.onDisconnected = () => setUsingWebRTC(false);
          webRTCAnswererRef.current = answerer;
          answerer.start(privateKey, riderWallet, rideId)
            .catch((e: any) => console.warn("[WEBRTC] Answerer start failed:", e.message));
        }
      } catch (e: any) {
        console.warn("[WEBRTC] GPS relay setup failed — continuing without it:", e?.message ?? e);
      }
      return () => {
        webRTCAnswererRef.current?.stop();
        webRTCAnswererRef.current = null;
      };
    }

    // Normal path: matching server WebSocket
    const ws = new WebSocket(MATCHING_WS);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "RIDER_JOIN", rideId, address: riderWalletRef.current }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "DRIVER_LOCATION") {
          setDriverLoc({ lat: msg.lat, lng: msg.lng });
          const distKm  = haversineKm(msg.lat, msg.lng, pickupLat, pickupLng);
          // TODO: replace with routing API duration; 30 km/h assumption also affects late-penalty trigger in PolicyRegistry
          const etaMins = Math.round((distKm / 30) * 60);
          setEtaMinutes(etaMins);
          setEta(etaMins);
        }
        if (msg.type === "PROOF_SUBMITTED") {
          setStatus("pending_confirmation");
        }
      } catch { /* ignore parse errors */ }
    };
    return () => ws.close();
  }, [rideId]);

  const loadWalletAndStart = async () => {
    try {
      console.log("loadWalletAndStart: reading AsyncStorage...");
      const addr = await AsyncStorage.getItem("rider_wallet_address") ?? "";
      const key  = await SecureStore.getItemAsync("rider_wallet_key")  ?? "";
      console.log("Wallet loaded, addr:", addr ? addr.slice(0, 10) + "..." : "MISSING");
      console.log("Key loaded:", key ? "yes" : "MISSING");
      riderWalletRef.current = addr;
      privateKeyRef.current  = key;
      // Await clearRelayMessage so its nonce is consumed before postRideRequest runs.
      // Fire-and-forget caused a nonce race: both txs got the same nonce,
      // postRideRequest was REPLACEMENT_UNDERPRICED vs the auto-priced clearMessage.
      if (key) {
        console.log("[RELAY] Clearing stale rider messages before new ride");
        await clearRelayMessage(key);
      }
      await confirmWithServer(addr);
    } catch (err: any) {
      console.error("Mount error:", err.message);
      console.error("Stack:", err.stack);
      setStatus("failed");
    }
  };

  // Returns true if driver is online. Tries matching server first, falls back to blockchain.
  const checkDriverOnline = async (driverAddr: string): Promise<boolean> => {
    try {
      const res = await fetch(`${MATCHING_HTTP}/drivers/${driverAddr}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        // on_ride = driver accepted our ride and is still connected; locked = mid-confirmation
        return data.online === true;
      }
    } catch { /* server unreachable — fall through to blockchain */ }

    try {
      const provider  = new ethers.JsonRpcProvider(POLYGON_RPC);
      const avail     = new ethers.Contract(DRIVER_AVAIL, AVAIL_ABI, provider);
      const online    = await avail.isOnline(driverAddr);
      console.log(`[DRIVER] On-chain isOnline(${driverAddr.slice(0,8)}...):`, online);
      return online as boolean;
    } catch (e: any) {
      console.warn("[DRIVER] isOnline check failed:", e.message);
      return true; // assume online if both checks fail — don't block the ride
    }
  };

  const confirmWithServer = async (riderWallet: string) => {
    if (!driver.address || driver.address.length !== 42) {
      Alert.alert(
        "Invalid Driver",
        "Driver address is invalid. Please search again.",
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
      setStatus("failed");
      return;
    }
    const driverAddr = driver.address;

    console.log("Calling /riders/confirm...");
    console.log("riderWallet:", riderWallet ? riderWallet.slice(0, 10) + "..." : "MISSING");
    console.log("driverAddr:", driverAddr.slice(0, 10) + "...");

    try {
      const res = await fetch("http://157.230.59.42:3000/riders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riderAddress:    riderWallet,
          driverAddress:   driverAddr,
          pickupLat, pickupLng, destLat, destLng,
          offerMultiplier,
        }),
      });
      const data = await res.json();
      console.log("/riders/confirm response:", JSON.stringify(data));
      if (!data.ok) { setStatus("failed"); return; }

      // Driver accepted — double-check they're still connected before spending gas
      const still = await checkDriverOnline(data.driverWallet ?? driverAddr);
      if (!still) {
        Alert.alert(
          "Driver Unavailable",
          "The driver went offline before the ride could start. Please search again.",
          [{ text: "Back to Search", onPress: () => navigation.goBack() }],
        );
        setStatus("failed");
        return;
      }

      setFareUSD(data.fareUSD);
      await createEscrowRide(data.rideId, data.driverWallet, data.fareWei, data.nodeAddress ?? nodeAddress);

    } catch {
      // Matching server unreachable — fall back to MessageRelay + WebRTC GPS
      console.log("[RELAY] Matching server unreachable — using MessageRelay fallback");
      isBlockchainFallback.current = true;
      await fallbackViaRelay(driverAddr);
    }
  };

  const createEscrowRide = async (
    newRideId:        string,
    driverWallet:     string,
    fareWei:          string,
    nodeAddr:         string,
    committedFareWei?: string,
    driverSig?:        string,
  ) => {
    setStatus("creating_escrow");
    try {
      const key = privateKeyRef.current;
      if (!key) throw new Error("No wallet key");

      // Generate 4-digit PIN and hash it
      const newPin  = Math.floor(Math.random() * 9000) + 1000;
      const pinHash = ethers.solidityPackedKeccak256(["uint256"], [newPin]);

      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const signer   = new ethers.Wallet(key, provider);
      const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);

      const etaSeconds = BigInt(Math.round(originalEtaMins.current * 60));
      // In the relay fallback (server down) there is no matching-server node, so
      // nodeAddr arrives as "". Ethers v6 treats "" as an ENS name and throws
      // "unconfigured name" on Polygon. Use ZeroAddress instead.
      const safeNodeAddr = nodeAddr || ethers.ZeroAddress;

      let tx: any;
      if (committedFareWei && driverSig) {
        console.log("[ESCROW] createRide (signed):", newRideId.slice(0,10), "committedFareWei:", committedFareWei);
        tx = await escrow["createRide(bytes32,address,address,bytes32,uint256,uint8,uint256,bytes)"](
          newRideId,
          driverWallet,
          safeNodeAddr,
          pinHash,
          etaSeconds,
          offerMultiplier,
          BigInt(committedFareWei),
          driverSig,
          { value: BigInt(committedFareWei) },
        );
      } else {
        console.log("[ESCROW] createRide (legacy):", newRideId.slice(0,10), "fareWei:", fareWei, "PIN:", newPin, "etaSecs:", etaSeconds.toString());
        tx = await escrow["createRide(bytes32,address,address,bytes32,uint256,uint8)"](
          newRideId,
          driverWallet,
          safeNodeAddr,
          pinHash,
          etaSeconds,
          offerMultiplier,
          { value: BigInt(fareWei) },
        );
      }
      console.log("[ESCROW] createRide tx:", tx.hash);
      await tx.wait();
      console.log("[ESCROW] createRide confirmed, PIN:", newPin);

      setRideId(newRideId);
      setPin(newPin);
      setTxHash(tx.hash);
      setStatus("waiting_pickup");

    } catch (err: any) {
      console.error("[ESCROW] createRide failed:", err.message);
      Alert.alert("Escrow Error", err.message);
      setStatus("failed");
    }
  };

  const handleConfirmPickup = async () => {
    if (!rideId) return;
    setActionLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const signer   = new ethers.Wallet(privateKeyRef.current, provider);
      const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);
      const tx = await escrow.confirmPickupByRider(rideId);
      await tx.wait();

      // Notify matching server so driver receives PICKUP_CONFIRMED
      fetch("http://157.230.59.42:3000/riders/pickup-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      }).catch(e => console.warn("[PICKUP] notify failed:", e.message));

      setStatus("driver_arriving");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const computeRouteHash = (): string => {
    const log = gpsLogRef.current;
    if (log.length === 0) return ethers.ZeroHash;
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(log)));
  };

  const saveGpsLog = async (currentRideId: string) => {
    try {
      await AsyncStorage.setItem(
        `rider_gps_log_${currentRideId}`,
        JSON.stringify(gpsLogRef.current),
      );
    } catch { /* non-critical */ }
  };

  const handleConfirmRide = async () => {
    console.log("Confirm ride tapped");
    if (!rideId) return;
    setActionLoading(true);
    try {
      const routeHash = computeRouteHash();
      await saveGpsLog(rideId);
      console.log("Confirming ride, routeHash:", routeHash.slice(0, 18) + "...");
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const signer   = new ethers.Wallet(privateKeyRef.current, provider);
      const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);
      const tx = await escrow.confirmRide(rideId, routeHash);
      console.log("TX hash:", tx.hash);
      await tx.wait();
      setStatus("completed");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisputeRide = async () => {
    if (!rideId) return;
    Alert.alert("Raise Dispute", "Are you sure you want to dispute this ride?", [
      { text: "Cancel", style: "cancel" },
      { text: "Dispute", style: "destructive", onPress: async () => {
        setActionLoading(true);
        try {
          const routeHash = computeRouteHash();
          await saveGpsLog(rideId!);
          const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
          const signer   = new ethers.Wallet(privateKeyRef.current, provider);
          const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);
          const tx = await escrow.disputeRide(rideId, routeHash);
          await tx.wait();
          setDisputedAt(Date.now());
          setStatus("disputed");
        } catch (err: any) {
          Alert.alert("Error", err.message);
        } finally {
          setActionLoading(false);
        }
      }},
    ]);
  };

  const handleEscalate = async () => {
    if (!rideId) return;
    Alert.alert("Escalate to DAO", "This will escalate the dispute to the DeRide DAO for review.", [
      { text: "Cancel", style: "cancel" },
      { text: "Escalate", style: "destructive", onPress: async () => {
        setActionLoading(true);
        try {
          const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
          const signer   = new ethers.Wallet(privateKeyRef.current, provider);
          const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);
          const tx = await escrow.escalateDispute(rideId);
          await tx.wait();
          setStatus("escalated");
        } catch (err: any) {
          Alert.alert("Error", err.message);
        } finally {
          setActionLoading(false);
        }
      }},
    ]);
  };

  const handleCancelDueLate = async () => {
    if (!rideId) return;
    Alert.alert(
      "Cancel Ride (Driver Late)",
      "The driver is running late. You can cancel for a full refund.",
      [
        { text: "Keep Waiting", style: "cancel" },
        { text: "Cancel Ride", style: "destructive", onPress: async () => {
          setActionLoading(true);
          try {
            const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
            const signer   = new ethers.Wallet(privateKeyRef.current, provider);
            const escrow   = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);
            const tx = await escrow.cancelRide(rideId);
            await tx.wait();
            Alert.alert("Ride Cancelled", "Your full fare has been refunded.", [
              { text: "OK", onPress: () => navigation.goBack() },
            ]);
          } catch (err: any) {
            Alert.alert("Cancel Failed", err.message?.slice(0, 200));
          } finally {
            setActionLoading(false);
          }
        }},
      ],
    );
  };

  const handleExportLog = async () => {
    const log = gpsLogRef.current;
    if (log.length === 0) {
      Alert.alert("No GPS Data", "No route data was recorded for this ride.");
      return;
    }
    await Share.share({
      title:   `DeRide GPS Log — Ride ${rideId?.slice(0, 10) ?? ""}`,
      message: JSON.stringify({ rideId, log }, null, 2),
    });
  };

  const escalationWindowOpen =
    disputedAt !== null && Date.now() - disputedAt < 48 * 3600 * 1000;

  const fallbackViaRelay = async (driverAddr: string) => {
    try {
      const privateKey  = privateKeyRef.current;
      const riderWallet = riderWalletRef.current;
      if (!privateKey) { setStatus("failed"); return; }

      // Compute fare from the driver's on-chain session rate (BUG-16 fix).
      // sessionRateCentsPerMile is the effective rate (base × ±50% adjustment) written
      // to DriverAvailability.goOnline — it already includes the driver's adjustment.
      // Falls back to fareUSD (server estimate) if the driver went online before the upgrade.
      const sessionRate   = driver.sessionRateCentsPerMile ?? 0;
      const tripDistKm    = haversineKm(pickupLat, pickupLng, destLat, destLng);
      const tripDistMi    = tripDistKm * 0.621371;
      const actualFareUSD = sessionRate > 0
        ? Math.round((sessionRate / 100) * tripDistMi * (offerMultiplier / 100) * 100) / 100
        : driver.fareUSD * offerMultiplier / 100; // pre-upgrade fallback
      const polPriceUsd = await getPolUsdFromOracle();
      const fareWei = BigInt(Math.round((actualFareUSD / polPriceUsd) * 1e18)).toString();

      // Generate rideId upfront so we can verify acceptance matches this exact ride
      const newRideId = await generateRideId();
      setRideId(newRideId); // set early so WS effect connects

      console.log("[RELAY] Posting ride request to driver:", driverAddr.slice(0, 10));
      await postRideRequest(
        driverAddr, riderWallet, privateKey,
        pickupLat, pickupLng, destLat, destLng,
        actualFareUSD,
        fareWei,
        offerMultiplier,
        newRideId,
      );
      console.log("[RELAY] Request posted, rideId:", newRideId.slice(0, 10), "— polling for acceptance...");

      const ACCEPTANCE_TIMEOUT = 90000;
      const startTime = Date.now();
      const pollRef = { interval: null as ReturnType<typeof setInterval> | null };
      pollRef.interval = setInterval(async () => {
        if (Date.now() - startTime > ACCEPTANCE_TIMEOUT) {
          clearInterval(pollRef.interval!);
          pollRef.interval = null;
          setStatus("failed");
          Alert.alert(
            "No Response",
            "Driver didn't respond. Please try again.",
            [{ text: "OK", onPress: () => navigation.goBack() }]
          );
          return;
        }
        const accepted = await pollForAcceptance(riderWallet, privateKey);
        if (accepted) {
          if (accepted.rideId !== newRideId) {
            console.log("[RELAY] Ignoring stale acceptance — rideId mismatch");
            return;
          }
          clearInterval(pollRef.interval!);
          pollRef.interval = null;
          console.log("[RELAY] Driver accepted:", accepted.rideId.slice(0, 10));

          // Check driver still reachable before spending gas
          const still = await checkDriverOnline(driverAddr);
          if (!still) {
            Alert.alert(
              "Driver Unavailable",
              "The driver went offline before the ride could start. Please search again.",
              [{ text: "Back to Search", onPress: () => navigation.goBack() }],
            );
            setStatus("failed");
            return;
          }

          setFareUSD(actualFareUSD);
          await createEscrowRide(
            newRideId, driverAddr, fareWei, nodeAddress,
            accepted.committedFareWei, accepted.driverSig,
          );
        }
      }, 3000);

    } catch (err: any) {
      console.error("[RELAY] Fallback failed:", err.message);
      setStatus("failed");
    }
  };

  const statusCfg = {
    confirming:           { emoji: "⏳", title: "Finding driver...",             sub: "Connecting to server" },
    creating_escrow:      { emoji: "🔗", title: "Creating escrow...",            sub: "Locking fare on Polygon" },
    waiting_pickup:       { emoji: "📍", title: "Driver is on the way",          sub: "Show PIN to driver at pickup" },
    driver_arriving:      { emoji: "🚗", title: "Ride in Progress",              sub: driver.vehicle },
    pending_confirmation: { emoji: "✋", title: "Confirm your ride",             sub: "Driver has completed the route" },
    completed:            { emoji: "✅", title: "You've arrived!",               sub: "Payment released" },
    disputed:             { emoji: "⚠️", title: "Dispute raised",               sub: "Awaiting verifier review" },
    escalated:            { emoji: "🏛", title: "Escalated to DAO",              sub: "DeRide DAO is reviewing" },
    failed:               { emoji: "❌", title: "Something went wrong",          sub: "Please try again" },
  }[status];

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.bg, opacity: fadeAnim }]}>
      <View style={styles.mapArea}>
        {driverLoc === null && (
          <View style={styles.mapWaiting}>
            <Text style={styles.mapWaitingText}>Waiting for driver location...</Text>
          </View>
        )}
        <MapView
          style={StyleSheet.absoluteFillObject}
          region={driverLoc !== null ? {
            latitude:       (riderPos.lat + driverLoc.lat) / 2,
            longitude:      (riderPos.lng + driverLoc.lng) / 2,
            latitudeDelta:  Math.abs(riderPos.lat - driverLoc.lat) * 3 + 0.01,
            longitudeDelta: Math.abs(riderPos.lng - driverLoc.lng) * 3 + 0.01,
          } : {
            latitude:       riderPos.lat,
            longitude:      riderPos.lng,
            latitudeDelta:  0.02,
            longitudeDelta: 0.02,
          }}
        >
          <Marker coordinate={{ latitude: riderPos.lat, longitude: riderPos.lng }}
            title="You" pinColor="#007AFF" />
          {driverLoc !== null && (status === "driver_arriving" || status === "pending_confirmation") && (
            <Marker coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
              title="Driver" pinColor="#00E5A0" />
          )}
        </MapView>
      </View>

      {usingWebRTC && (
        <View style={styles.webrtcBanner}>
          <Text style={styles.webrtcBannerText}>
            Matching server unavailable. Map updates may be slower. Your payment is safe on blockchain.
          </Text>
        </View>
      )}

      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.statusRow}>
          <Text style={{ fontSize: 32 }}>{statusCfg.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>{statusCfg.title}</Text>
            <Text style={[{ color: colors.textSub, fontSize: 13, marginTop: 2 }]}>{statusCfg.sub}</Text>
          </View>
        </View>

        <View style={[styles.details, { borderColor: colors.border }]}>
          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: colors.textSub }]}>Fare</Text>
            <Text style={[styles.detailValue, { color: Colors.brand }]}>${fareUSD}</Text>
          </View>
          <View style={[{ width: 1, marginHorizontal: 8, backgroundColor: colors.border }]} />
          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: colors.textSub }]}>Rating</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>⭐ {driver.rating}</Text>
          </View>
          <View style={[{ width: 1, marginHorizontal: 8, backgroundColor: colors.border }]} />
          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: colors.textSub }]}>To</Text>
            <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1}>
              {destination?.slice(0, 10)}{destination?.length > 10 ? "..." : ""}
            </Text>
          </View>
        </View>

        {/* PIN display + live ETA */}
        {status === "waiting_pickup" && pin !== null && (() => {
          const driverLate = etaMinutes !== null && etaMinutes > originalEtaMins.current * 3;
          return (
            <View style={{ gap: 10 }}>
              <View style={[styles.pinCard, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
                <Text style={[{ color: Colors.brandDim, fontSize: 11, fontWeight: "600",
                  letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }]}>
                  Pickup PIN — show to driver
                </Text>
                <Text style={[styles.pinText, { color: Colors.brand }]}>{pin}</Text>
                {etaMinutes !== null && (
                  <Text style={{ color: Colors.brandDim, fontSize: 13, marginBottom: 8 }}>
                    Driver arriving in {etaMinutes} min
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.pickupBtn, { borderColor: Colors.brand, opacity: actionLoading ? 0.7 : 1 }]}
                  onPress={handleConfirmPickup}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? <ActivityIndicator color={Colors.brand} />
                    : <Text style={[{ color: Colors.brand, fontSize: 14, fontWeight: "600" }]}>
                        I'm in the car ✓
                      </Text>
                  }
                </TouchableOpacity>
              </View>
              {driverLate && (
                <View style={[styles.successCard, { backgroundColor: "#1a0a00", borderColor: "#FF8800" }]}>
                  <Text style={{ color: "#FF8800", fontSize: 14, fontWeight: "700", marginBottom: 8 }}>
                    Driver is running late
                  </Text>
                  <Text style={{ color: colors.textSub, fontSize: 13, marginBottom: 12, textAlign: "center" }}>
                    Your driver is {etaMinutes} min away (expected {originalEtaMins.current} min).
                    You can cancel for a full refund.
                  </Text>
                  <TouchableOpacity
                    style={[styles.disputeBtn, { borderColor: "#FF8800" }, actionLoading && { opacity: 0.7 }]}
                    onPress={handleCancelDueLate}
                    disabled={actionLoading}
                  >
                    <Text style={{ color: "#FF8800", fontSize: 14, fontWeight: "600" }}>
                      Cancel (Full Refund)
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })()}

        {/* Confirm / Dispute buttons after driver submits proof */}
        {status === "pending_confirmation" && (
          <View style={{ gap: 10 }}>
            <TouchableOpacity
              style={[styles.confirmBtn, Shadow.brand, actionLoading && { opacity: 0.7 }]}
              onPress={handleConfirmRide}
              disabled={actionLoading}
            >
              {actionLoading
                ? <ActivityIndicator color="#000" />
                : <Text style={[{ color: "#000", fontSize: 16, fontWeight: "700" }]}>
                    Confirm Ride ✓
                  </Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.disputeBtn, { borderColor: "#FF4444" }]}
              onPress={handleDisputeRide}
              disabled={actionLoading}
            >
              <Text style={[{ color: "#FF4444", fontSize: 14, fontWeight: "600" }]}>
                Dispute Ride ⚠
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {txHash && status === "waiting_pickup" && (
          <Text style={[{ color: colors.textMuted, fontSize: 10, textAlign: "center", marginTop: 8 }]}>
            Escrow: {txHash.slice(0, 20)}...
          </Text>
        )}

        {status === "completed" && (
          <View>
            <View style={[styles.successCard, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
              <Text style={[{ color: Colors.brand, fontSize: 20, fontWeight: "700" }]}>✓ Ride Complete</Text>
              <Text style={[{ color: Colors.brandDim, fontSize: 13, marginTop: 4 }]}>
                Payment released · ${fareUSD}
              </Text>
            </View>
            <TouchableOpacity
              style={[{ padding: 20, borderRadius: 16, alignItems: "center", marginTop: 12,
                backgroundColor: colors.surfaceAlt }]}
              onPress={() => navigation.navigate("Main")}
            >
              <Text style={[{ color: colors.text, fontSize: 16, fontWeight: "700" }]}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === "disputed" && (
          <View style={{ gap: 10 }}>
            <View style={[styles.successCard, { backgroundColor: "#1a0000", borderColor: "#FF4444" }]}>
              <Text style={[{ color: "#FF4444", fontSize: 16, fontWeight: "700" }]}>Dispute Submitted</Text>
              <Text style={[{ color: colors.textSub, fontSize: 13, marginTop: 6, textAlign: "center" }]}>
                Your verifier will review and resolve.
              </Text>
            </View>
            {escalationWindowOpen && (
              <TouchableOpacity
                style={[styles.disputeBtn, { borderColor: "#FF8800" }, actionLoading && { opacity: 0.7 }]}
                onPress={handleEscalate}
                disabled={actionLoading}
              >
                {actionLoading
                  ? <ActivityIndicator color="#FF8800" />
                  : <Text style={{ color: "#FF8800", fontSize: 14, fontWeight: "600" }}>
                      Escalate to DAO 🏛
                    </Text>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.disputeBtn, { borderColor: colors.border }]}
              onPress={handleExportLog}
            >
              <Text style={{ color: colors.textSub, fontSize: 14, fontWeight: "600" }}>
                Export Ride Log
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {status === "escalated" && (
          <View style={{ gap: 10 }}>
            <View style={[styles.successCard, { backgroundColor: "#1a0a00", borderColor: "#FF8800" }]}>
              <Text style={[{ color: "#FF8800", fontSize: 16, fontWeight: "700" }]}>Escalated to DAO</Text>
              <Text style={[{ color: colors.textSub, fontSize: 13, marginTop: 6, textAlign: "center" }]}>
                The DeRide DAO will resolve this dispute.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.disputeBtn, { borderColor: colors.border }]}
              onPress={handleExportLog}
            >
              <Text style={{ color: colors.textSub, fontSize: 14, fontWeight: "600" }}>
                Export Ride Log
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {status === "failed" && (
          <TouchableOpacity
            style={[{ padding: 20, borderRadius: 16, alignItems: "center", backgroundColor: Colors.brand }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={[{ color: "#000", fontSize: 16, fontWeight: "700" }]}>Try Again</Text>
          </TouchableOpacity>
        )}

        {status === "driver_arriving" && (
          <View style={[styles.rideInProgressCard, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
            <Text style={[{ color: Colors.brandDim, fontSize: 11, fontWeight: "600",
              letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }]}>
              Elapsed Time
            </Text>
            <Text style={[{ color: Colors.brand, fontSize: 40, fontWeight: "700", letterSpacing: 4 }]}>
              {`${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1 },
  mapArea:        { flex: 1 },
  mapWaiting:     { position: "absolute", zIndex: 1, top: 16, alignSelf: "center",
                    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12,
                    paddingVertical: 6, borderRadius: 8 },
  mapWaitingText: { color: "#fff", fontSize: 12 },
  sheet:       { borderTopLeftRadius: 24, borderTopRightRadius: 24,
                 borderWidth: 1, borderBottomWidth: 0, padding: 24, paddingBottom: 40 },
  statusRow:   { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20 },
  statusTitle: { fontSize: 18, fontWeight: "700" },
  details:     { flexDirection: "row", borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  detailItem:  { flex: 1, alignItems: "center" },
  detailLabel: { fontSize: 11, marginBottom: 4 },
  detailValue: { fontSize: 16, fontWeight: "700" },
  pinCard:     { padding: 20, borderRadius: 16, borderWidth: 1, alignItems: "center", marginBottom: 12 },
  pinText:     { fontSize: 48, fontWeight: "700", letterSpacing: 8, marginBottom: 16 },
  pickupBtn:   { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  confirmBtn:  { backgroundColor: "#00E5A0", padding: 18, borderRadius: 14, alignItems: "center" },
  disputeBtn:  { padding: 14, borderRadius: 14, borderWidth: 1.5, alignItems: "center" },
  successCard:         { padding: 20, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  rideInProgressCard:  { padding: 20, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  webrtcBanner:        { backgroundColor: "rgba(255,153,0,0.92)", paddingHorizontal: 16,
                         paddingVertical: 10 },
  webrtcBannerText:    { color: "#000", fontSize: 11, textAlign: "center", fontWeight: "500" },
});
