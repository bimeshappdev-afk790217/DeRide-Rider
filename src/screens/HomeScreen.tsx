import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, TextInput, StatusBar, Alert, FlatList,
} from "react-native";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { ethers } from "ethers";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Typography, Spacing, Radius, Shadow } from "../theme";

const ALCHEMY_URL         = process.env.EXPO_PUBLIC_ALCHEMY_URL                  ?? "";
const DRIVER_AVAILABILITY = process.env.EXPO_PUBLIC_DRIVER_AVAILABILITY_ADDRESS  ?? "";
const RIDE_ESCROW         = process.env.EXPO_PUBLIC_RIDE_ESCROW_ADDRESS           ?? "";
const NODE_REG_ADDR       = process.env.EXPO_PUBLIC_NODE_REGISTRY_ADDRESS         ?? "0xE8f8951cDcC4c6759A9E980b966D6742edcbAc59";
const AVAILABILITY_ABI    = [
  "function getAvailableDrivers() external view returns (tuple(address wallet, int256 lat, int256 lng, string vehicle, uint256 rating, uint256 lastSeen, bool available)[])",
];
const ESCROW_ABI = [
  "function hasActiveRide(address) external view returns (bool)",
];
const NODE_REG_ABI = [
  "function getNodes(string geohash) external view returns (tuple(address operator, string endpoint, string geohash, bytes publicKey, uint256 stake, uint256 reputation, uint256 registeredAt, uint256 lastHeartbeat, bool active)[])",
  "function reportFailure(address nodeAddress) external",
];

// Base pricing constants — must match matching server defaults for independent verification
const BASE_FARE_USD  = 1.50;
const PER_KM_RATE    = 0.80;
const FARE_TOLERANCE = 0.20; // 20% threshold triggers warning + report

function encodeGeohash(lat: number, lng: number, precision = 4): string {
  const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let [minLat, maxLat, minLng, maxLng] = [-90, 90, -180, 180];
  let hash = "", bits = 0, val = 0, isLng = true;
  while (hash.length < precision) {
    const mid = isLng ? (minLng + maxLng) / 2 : (minLat + maxLat) / 2;
    if (isLng) { if (lng > mid) { val = (val << 1) | 1; minLng = mid; } else { val <<= 1; maxLng = mid; } }
    else        { if (lat > mid) { val = (val << 1) | 1; minLat = mid; } else { val <<= 1; maxLat = mid; } }
    isLng = !isLng;
    if (++bits === 5) { hash += B32[val]; bits = 0; val = 0; }
  }
  return hash;
}

const NEARBY_CATEGORIES = ["Airport", "Hospital", "Mall", "Restaurant"];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function typeWeight(r: any): number {
  const t = r.type || r.class || '';
  if (t === 'city')                           return 0;
  if (t === 'town')                           return 1;
  if (t === 'suburb')                         return 2;
  if (t === 'neighbourhood')                  return 3;
  if (t === 'restaurant' || t === 'cafe')     return 1;
  if (t === 'hospital'   || t === 'airport')  return 1;
  return 4;
}

function formatSecondary(item: any): string {
  const addr  = item.address ?? {};
  const city  = addr.city || addr.town || addr.village || addr.suburb || '';
  const state = addr.state || addr.country || '';
  if (city && state) return `${city}, ${state}`;
  if (city)  return city;
  if (state) return state;
  const parts = (item.display_name ?? '').split(',');
  return parts.slice(1, 3).join(',').trim();
}

function formatDistMi(item: any, riderLoc: { lat: number; lng: number }): string {
  const km = haversineKm(riderLoc.lat, riderLoc.lng, parseFloat(item.lat), parseFloat(item.lon));
  const mi = km * 0.621;
  return mi < 0.1 ? 'nearby' : `${mi.toFixed(1)} mi`;
}

const RECENT_DESTS_KEY = 'recent_destinations';
interface RecentDest { name: string; address: string; lat: number; lng: number; savedAt: number; }


const DriverCard = ({ driver, onSelect, selected }: any) => {
  const { colors } = useTheme();
  const isSelected = selected?.address === driver.address;
  return (
    <TouchableOpacity
      style={[styles.driverCard, {
        backgroundColor: isSelected ? Colors.brandGlow : colors.surface,
        borderColor: isSelected ? Colors.brand : colors.border,
      }, isSelected && Shadow.brand]}
      onPress={() => onSelect(driver)}
    >
      <View style={styles.driverLeft}>
        <View style={[styles.driverAvatar, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ fontSize: 20 }}>🚗</Text>
        </View>
        <View>
          <Text style={[styles.driverVehicle, { color: colors.text }]}>{driver.vehicle}</Text>
          <Text style={[styles.driverMeta, { color: colors.textSub }]}>
            ⭐ {driver.rating} · {driver.distanceMi} mi away
          </Text>
        </View>
      </View>
      <View style={styles.driverRight}>
        <Text style={[styles.driverFare, { color: Colors.brand }]}>${driver.fareUSD}</Text>
        <Text style={[styles.driverEta, { color: colors.textSub }]}>{driver.eta} min</Text>
      </View>
    </TouchableOpacity>
  );
};

export const HomeScreen = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const [destination, setDestination]     = useState("");
  const [destCoords, setDestCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [searching, setSearching]         = useState(false);
  const [loading, setLoading]             = useState(false);
  const [drivers, setDrivers]             = useState<any[]>([]);
  const [selected, setSelected]           = useState<any>(null);
  const [multiplier, setMultiplier]       = useState(1.0);
  const [reason, setReason]               = useState("");
  const [riderLoc, setRiderLoc]           = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [updateStatus, setUpdateStatus]   = useState<"idle"|"checking"|"updating"|"uptodate">("idle");
  const [suggestions, setSuggestions]     = useState<any[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [countryCode, setCountryCode]     = useState("us");
  const [recentDests, setRecentDests]     = useState<RecentDest[]>([]);
  const nodeAddressRef = useRef<string>("");
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef    = useRef<MapView>(null);
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  const reportNodeFailure = (nodeAddr: string) => {
    if (!nodeAddr || !ethers.isAddress(nodeAddr)) return;
    // Fire-and-forget: rider signs with stored key
    SecureStore.getItemAsync("rider_wallet_key").then(key => {
      if (!key || !ALCHEMY_URL) return;
      const provider  = new ethers.JsonRpcProvider(ALCHEMY_URL);
      const signer    = new ethers.Wallet(key, provider);
      const nodeReg   = new ethers.Contract(NODE_REG_ADDR, NODE_REG_ABI, signer);
      nodeReg.reportFailure(nodeAddr, { gasLimit: 200_000 })
        .then((tx: any) => console.log("[NODE] reportFailure tx:", tx.hash))
        .catch((e: any) => console.warn("[NODE] reportFailure failed:", e.message));
    }).catch(() => {});
  };

  const verifyNodeFare = (quotedUSD: number, distanceKm: number, nodeAddr: string) => {
    const expectedUSD = BASE_FARE_USD + distanceKm * PER_KM_RATE;
    const ratio       = Math.abs(quotedUSD - expectedUSD) / expectedUSD;
    console.log(`[FARE] Quoted: $${quotedUSD.toFixed(2)}, Expected: $${expectedUSD.toFixed(2)}, diff: ${(ratio * 100).toFixed(0)}%`);

    if (ratio > FARE_TOLERANCE) {
      reportNodeFailure(nodeAddr);
      Alert.alert(
        "Unusual Fare Detected",
        `Node quoted $${quotedUSD.toFixed(2)} but our estimate is $${expectedUSD.toFixed(2)} for this distance (${(distanceKm * 0.621).toFixed(1)} mi).\n\nThis may indicate a pricing discrepancy.`,
        [
          { text: "Cancel Search", style: "destructive", onPress: () => setSearching(false) },
          { text: "Continue Anyway", style: "default" },
        ]
      );
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    AsyncStorage.getItem("rider_wallet_address").then(addr => {
      if (addr) setWalletAddress(addr);
    }).catch(() => {});
    AsyncStorage.getItem(RECENT_DESTS_KEY).then(raw => {
      if (raw) setRecentDests(JSON.parse(raw));
    }).catch(() => {});
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const { latitude: lat, longitude: lng } = loc.coords;
          setRiderLoc({ lat, lng });
          setLocationError(false);
          // Reverse-geocode to get country code for biased search results
          try {
            const r = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { "User-Agent": "DeRide/1.0" } }
            );
            const geo = await r.json();
            const cc  = (geo?.address?.country_code ?? 'us').toLowerCase();
            setCountryCode(cc);
          } catch {
            // keep default 'us'
          }
        } else {
          setLocationError(true);
        }
      } catch {
        setLocationError(true);
      }
    })();
  }, []);

  const searchPlaces = useCallback(async (input: string) => {
    if (!riderLoc) return;
    if (input.length < 3) { setSuggestions([]); return; }
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(input)}&format=json&limit=10&addressdetails=1` +
        `&countrycodes=${countryCode}` +
        `&lat=${riderLoc.lat}&lon=${riderLoc.lng}`,
        { headers: { "User-Agent": "DeRide/1.0" } }
      );
      const results: any[] = await resp.json();
      const sorted = [...results].sort((a, b) => {
        const distA = haversineKm(riderLoc.lat, riderLoc.lng, parseFloat(a.lat), parseFloat(a.lon));
        const distB = haversineKm(riderLoc.lat, riderLoc.lng, parseFloat(b.lat), parseFloat(b.lon));
        const scoreA = distA * 0.7 + typeWeight(a) * 10;
        const scoreB = distB * 0.7 + typeWeight(b) * 10;
        return scoreA - scoreB;
      });
      setSuggestions(sorted.slice(0, 6));
    } catch {
      setSuggestions([]);
    }
  }, [riderLoc, countryCode]);

  const searchNearbyCategory = useCallback(async (category: string) => {
    if (!riderLoc) return;
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(category)}&format=json&limit=10&addressdetails=1` +
        `&countrycodes=${countryCode}` +
        `&lat=${riderLoc.lat}&lon=${riderLoc.lng}`,
        { headers: { "User-Agent": "DeRide/1.0" } }
      );
      const results: any[] = await resp.json();
      const sorted = [...results].sort((a, b) => {
        const distA = haversineKm(riderLoc.lat, riderLoc.lng, parseFloat(a.lat), parseFloat(a.lon));
        const distB = haversineKm(riderLoc.lat, riderLoc.lng, parseFloat(b.lat), parseFloat(b.lon));
        const scoreA = distA * 0.7 + typeWeight(a) * 10;
        const scoreB = distB * 0.7 + typeWeight(b) * 10;
        return scoreA - scoreB;
      });
      setSuggestions(sorted.slice(0, 6));
    } catch {
      setSuggestions([]);
    }
  }, [riderLoc, countryCode]);

  // Fit map to show both pickup and destination after search starts
  useEffect(() => {
    if (!destCoords || !searching) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        [
          { latitude: riderLoc!.lat,   longitude: riderLoc!.lng },
          { latitude: destCoords.lat, longitude: destCoords.lng },
        ],
        { edgePadding: { top: 80, right: 60, bottom: 240, left: 60 }, animated: true }
      );
    }, 350);
    return () => clearTimeout(t);
  }, [destCoords, searching]);

  const queryNodesFromRegistry = async (resolved: { lat: number; lng: number }): Promise<boolean> => {
    if (!ALCHEMY_URL || !riderLoc) return false;
    try {
      const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
      const registry = new ethers.Contract(NODE_REG_ADDR, NODE_REG_ABI, provider);
      const geohash  = encodeGeohash(riderLoc!.lat, riderLoc!.lng);
      console.log("[NODE] Querying NodeRegistry for geohash:", geohash);

      const rawNodes = await Promise.race([
        registry.getNodes(geohash),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]) as any[];

      if (!rawNodes || rawNodes.length === 0) {
        console.log("[NODE] No registered nodes for geohash:", geohash);
        return false;
      }

      const sortedNodes = [...rawNodes]
        .filter((n: any) => n.active)
        .sort((a: any, b: any) => Number(b.reputation) - Number(a.reputation));

      console.log(`[NODE] Found ${sortedNodes.length} node(s) in registry`);

      // Get blockchain driver list for cross-reference
      let blockchainAddresses = new Set<string>();
      try {
        const avail   = new ethers.Contract(DRIVER_AVAILABILITY, AVAILABILITY_ABI, provider);
        const onChain = await avail.getAvailableDrivers();
        blockchainAddresses = new Set(onChain.map((d: any) => (d.wallet as string).toLowerCase()));
        console.log(`[NODE] ${blockchainAddresses.size} driver(s) on-chain`);
      } catch (e: any) {
        console.warn("[NODE] DriverAvailability read failed:", e.message);
      }

      const allDrivers = new Map<string, any>(); // wallet → driver object
      let   combinedFareUSD = 0;
      let   combinedDistKm  = 0;
      let   anySucceeded    = false;

      for (const node of sortedNodes) {
        const httpBase = (node.endpoint as string).replace(/^ws(s?):\/\//, "http$1://");
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          const resp = await fetch(`${httpBase}/riders/search`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ lat: riderLoc!.lat, lng: riderLoc!.lng, destLat: resolved.lat, destLng: resolved.lng }),
            signal:  ctrl.signal,
          });
          clearTimeout(timer);

          const data = await resp.json();
          if (!data.drivers || data.drivers.length === 0) continue;

          anySucceeded = true;
          const fareUSD = data.fare?.estimatedUSD ?? 3.25;
          const distKm  = data.fare?.distanceKm   ?? haversineKm(riderLoc!.lat, riderLoc!.lng, resolved.lat, resolved.lng);
          if (!combinedFareUSD) { combinedFareUSD = fareUSD; combinedDistKm = distKm; }

          let phantomCount = 0;
          for (const d of data.drivers) {
            const key = (d.address as string).toLowerCase();
            // Cross-reference: node advertising a driver not on blockchain → phantom
            if (blockchainAddresses.size > 0 && !blockchainAddresses.has(key)) {
              phantomCount++;
              console.warn(`[NODE] Phantom driver ${d.address.slice(0,8)} from node ${(node.operator as string).slice(0,8)}`);
              continue; // exclude phantom driver from results
            }
            if (!allDrivers.has(key)) {
              allDrivers.set(key, {
                address:     d.address,
                lat:         parseFloat(d.lat),
                lng:         parseFloat(d.lng),
                vehicle:     d.vehicle ?? "DeRide Car",
                rating:      d.rating  ?? 4.8,
                eta:         d.etaMinutes ?? 3,
                distanceMi:  ((d.distanceKm ?? 1) * 0.621).toFixed(1),
                fareUSD,
                nodeAddress: node.operator,
              });
            }
          }

          if (phantomCount > 0) {
            console.warn(`[NODE] Reporting node for ${phantomCount} phantom driver(s)`);
            reportNodeFailure(node.operator);
          }

          // Also check for blockchain drivers the node is hiding
          if (blockchainAddresses.size > 0) {
            const nodeAddressSet = new Set(data.drivers.map((d: any) => (d.address as string).toLowerCase()));
            let hiddenCount = 0;
            for (const addr of blockchainAddresses) {
              if (!nodeAddressSet.has(addr)) hiddenCount++;
            }
            if (hiddenCount > 0) {
              console.warn(`[NODE] Node hiding ${hiddenCount} on-chain driver(s) — reporting`);
              reportNodeFailure(node.operator);
            }
          }

        } catch (e: any) {
          console.warn(`[NODE] ${httpBase} unreachable:`, e.message);
          reportNodeFailure(node.operator);
        }
      }

      if (!anySucceeded || allDrivers.size === 0) return false;

      const driverList = Array.from(allDrivers.values());
      console.log("[SEARCH] Drivers found:", driverList.length);
      console.log("[SEARCH] Surge:", 1.0);
      if (process.env.EXPO_PUBLIC_DEBUG === "true") {
        console.log("[SEARCH] Driver locations:", driverList.map(d => ({
          wallet: d.address?.slice(0, 8), lat: d.lat, lng: d.lng, distanceMi: d.distanceMi,
        })));
      }
      setDrivers(driverList);
      setMultiplier(1.0);
      setReason(`NodeRegistry · ${sortedNodes.length} node(s)`);
      nodeAddressRef.current = sortedNodes[0]?.operator ?? "";

      verifyNodeFare(combinedFareUSD, combinedDistKm, sortedNodes[0]?.operator ?? "");
      return true;
    } catch (e: any) {
      console.warn("[NODE] Registry query failed:", e.message);
      return false;
    }
  };

  const fetchFromContract = async (resolved: { lat: number; lng: number }) => {
    try {
      console.log("[CONTRACT] Fetching drivers from DriverAvailability...");
      console.log("[CONTRACT] ALCHEMY_URL:", ALCHEMY_URL || "UNDEFINED");
      console.log("[CONTRACT] DRIVER_AVAILABILITY:", DRIVER_AVAILABILITY || "UNDEFINED");
      const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
      const contract = new ethers.Contract(DRIVER_AVAILABILITY, AVAILABILITY_ABI, provider);
      const raw: any[] = await contract.getAvailableDrivers();
      console.log("[CONTRACT] Raw result:", JSON.stringify(raw, (_, v) => typeof v === "bigint" ? v.toString() : v));
      console.log("[CONTRACT] Driver count:", raw.length);
      if (raw.length === 0) { setDrivers([]); return; }
      const escrow = new ethers.Contract(RIDE_ESCROW, ESCROW_ABI, provider);
      const mapped = (
        await Promise.all(
          raw.map(async (d: any) => {
            try {
              const busy = await escrow.hasActiveRide(d.wallet);
              if (busy) { console.log("[CONTRACT] Driver busy, skipping:", d.wallet.slice(0, 10)); return null; }
            } catch { /* if call fails, include driver */ }
            const dLat       = Number(d.lat) / 1e6;
            const dLng       = Number(d.lng) / 1e6;
            const distanceKm = haversineKm(riderLoc!.lat, riderLoc!.lng, dLat, dLng);
            return {
              address:    d.wallet,
              lat:        dLat,
              lng:        dLng,
              vehicle:    d.vehicle || "DeRide Car",
              rating:     Number(d.rating) / 100,
              eta:        Math.max(1, Math.ceil(distanceKm / 0.5)),
              distanceMi: (distanceKm * 0.621).toFixed(1),
              fareUSD:    3.25,
            };
          })
        )
      ).filter(d => d !== null);
      console.log(`[CONTRACT] ${mapped.length} driver(s) available (not on a ride)`);
      console.log("[SEARCH] Drivers found:", mapped.length);
      console.log("[SEARCH] Surge:", 1.0);
      if (process.env.EXPO_PUBLIC_DEBUG === "true") {
        console.log("[SEARCH] Driver locations:", mapped.map(d => ({
          wallet: d.address?.slice(0, 8), lat: d.lat, lng: d.lng, distanceMi: d.distanceMi,
        })));
      }
      setDrivers(mapped);
      setReason("On-chain driver availability");
    } catch (e: any) {
      console.error("[CONTRACT] getAvailableDrivers failed:", e.message);
      setDrivers([]);
    }
  };

  const saveRecentDest = useCallback(async (name: string, address: string, lat: number, lng: number) => {
    try {
      const raw  = await AsyncStorage.getItem(RECENT_DESTS_KEY);
      const prev: RecentDest[] = raw ? JSON.parse(raw) : [];
      const deduped = prev.filter(d => !(Math.abs(d.lat - lat) < 0.0001 && Math.abs(d.lng - lng) < 0.0001));
      const next = [{ name, address, lat, lng, savedAt: Date.now() }, ...deduped].slice(0, 5);
      await AsyncStorage.setItem(RECENT_DESTS_KEY, JSON.stringify(next));
      setRecentDests(next);
    } catch {}
  }, []);

  const searchDrivers = (dest: string, coords?: { lat: number; lng: number }) => {
    if (!riderLoc) {
      Alert.alert("Location required", "Please enable location to find drivers.");
      return;
    }
    const resolved = coords ?? destCoords;
    if (!resolved) {
      Alert.alert("Select a destination", "Please choose a destination first.");
      return;
    }
    if (process.env.EXPO_PUBLIC_DEBUG === "true") {
      console.log("[SEARCH] Searching near:", riderLoc!.lat, riderLoc!.lng);
      console.log("[SEARCH] Destination:", resolved.lat, resolved.lng);
    }
    setDestination(dest);
    setDestCoords(resolved);
    setSuggestions([]);
    setSearching(true);
    saveRecentDest(dest.split(",")[0].trim(), dest, resolved.lat, resolved.lng);
    setLoading(true);
    setDrivers([]);
    setSelected(null);

    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 10 }).start();

    (async () => {
      // 1. Try NodeRegistry (dynamic discovery)
      const foundViaRegistry = await queryNodesFromRegistry(resolved);
      if (foundViaRegistry) { setLoading(false); return; }

      // 2. Fall back to hardcoded matching server
      fetch("http://157.230.59.42:3000/riders/waiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: riderLoc!.lat, lng: riderLoc!.lng }),
      }).catch(() => {});

      fetch("http://157.230.59.42:3000/riders/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: riderLoc!.lat, lng: riderLoc!.lng, destLat: resolved.lat, destLng: resolved.lng }),
      })
      .then(r => r.json())
      .then(async data => {
        setLoading(false);
        if (data.drivers && data.drivers.length > 0) {
          nodeAddressRef.current = data.nodeAddress ?? "";
          const fareUSD = data.fare?.estimatedUSD ?? 3.25;
          const distKm  = data.fare?.distanceKm   ?? haversineKm(riderLoc!.lat, riderLoc!.lng, resolved.lat, resolved.lng);
          const surge = data.fare?.multiplier ?? 1.0;
          const mappedDrivers = data.drivers.map((d: any) => ({
            address:    d.address,
            lat:        parseFloat(d.lat),
            lng:        parseFloat(d.lng),
            vehicle:    d.vehicle ?? "DeRide Car",
            rating:     d.rating  ?? 4.8,
            eta:        d.etaMinutes ?? 3,
            distanceMi: ((d.distanceKm ?? 1) * 0.621).toFixed(1),
            fareUSD,
          }));
          console.log("[SEARCH] Drivers found:", mappedDrivers.length);
          console.log("[SEARCH] Surge:", surge);
          setDrivers(mappedDrivers);
          setMultiplier(surge);
          setReason(data.fare?.reason ?? "");
          verifyNodeFare(fareUSD, distKm, data.nodeAddress ?? "");
        } else {
          console.log("[SEARCH] Matching server returned no drivers — falling back to contract");
          await fetchFromContract(resolved);
        }
      })
      .catch(async () => {
        console.log("[SEARCH] Matching server unreachable — falling back to contract");
        setLoading(false);
        await fetchFromContract(resolved);
      });
    })();
  };

  const confirmRide = () => {
    if (!selected || !destCoords || !riderLoc) return;

    const pickupLat = parseFloat(riderLoc!.lat.toString());
    const pickupLng = parseFloat(riderLoc!.lng.toString());
    const destLat   = parseFloat(destCoords.lat.toString());
    const destLng   = parseFloat(destCoords.lng.toString());

    if (!destLat || !destLng) {
      Alert.alert("Please select a destination");
      return;
    }
    if (isNaN(pickupLat) || isNaN(pickupLng) || isNaN(destLat) || isNaN(destLng)) {
      Alert.alert("Invalid coordinates", "Could not determine your location or destination. Please try again.");
      return;
    }

    try {
      navigation.navigate("RideProgress", {
        driver: selected, destination,
        pickupLat, pickupLng, destLat, destLng,
      });
    } catch (error: any) {
      console.error("Ride creation error:", error);
      Alert.alert("Error", error.message ?? "Could not start ride. Please try again.");
    }
  };

  const routeInfo = destCoords && riderLoc ? (() => {
    const km   = haversineKm(riderLoc!.lat, riderLoc!.lng, destCoords.lat, destCoords.lng);
    const mi   = (km * 0.621).toFixed(1);
    const mins = Math.ceil(km / 0.5);
    return `${mi} miles · ~${mins} min`;
  })() : null;

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.bg, opacity: fadeAnim }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.textSub }]}>Where to?</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {riderLoc ? `${riderLoc!.lat.toFixed(3)}°, ${riderLoc!.lng.toFixed(3)}°` : "Finding your location..."}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.profileBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => navigation.navigate("Profile")}
        >
          <Text style={{ color: Colors.brand, fontSize: 18, fontWeight: "700" }}>R</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.searchRow}>
          <View style={[styles.dot, { backgroundColor: Colors.brand }]} />
          <Text style={[styles.searchLabel, { color: colors.textMuted }]}>
            {locationError ? "⚠ Location disabled" : "Current location"}
          </Text>
        </View>
        <View style={[styles.searchDivider, { backgroundColor: colors.border }]} />
        <View style={styles.searchRow}>
          <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Enter destination"
            placeholderTextColor={colors.textMuted}
            value={destination}
            onChangeText={text => {
              setDestination(text);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => searchPlaces(text), 500);
              if (text.length === 0) setSuggestions([]);
            }}
            onSubmitEditing={() => {
              if (suggestions.length > 0) {
                const s = suggestions[0];
                searchDrivers(s.display_name, { lat: parseFloat(s.lat), lng: parseFloat(s.lon) });
              } else {
                searchDrivers(destination);
              }
            }}
            returnKeyType="search"
          />
        </View>

        {/* Autocomplete dropdown — live results */}
        {suggestions.length > 0 && (
          <FlatList
            data={suggestions}
            keyExtractor={(_, i) => String(i)}
            style={[styles.suggestList, { backgroundColor: colors.surface, borderColor: colors.border }]}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const primary   = item.name || item.display_name.split(",")[0];
              const secondary = formatSecondary(item);
              const distText  = riderLoc ? formatDistMi(item, riderLoc) : '';
              return (
                <TouchableOpacity
                  style={[styles.suggestItem, { borderBottomColor: colors.border }]}
                  onPress={() => searchDrivers(
                    item.display_name,
                    { lat: parseFloat(item.lat), lng: parseFloat(item.lon) }
                  )}
                >
                  <View style={styles.suggestRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestName, { color: colors.text }]} numberOfLines={1}>
                        {primary}
                      </Text>
                      {secondary ? (
                        <Text style={[styles.suggestAddr, { color: colors.textSub }]} numberOfLines={1}>
                          {secondary}
                        </Text>
                      ) : null}
                    </View>
                    {distText ? (
                      <Text style={[styles.suggestDist, { color: colors.textMuted }]}>{distText}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Recent destinations — shown when input is empty */}
        {suggestions.length === 0 && destination.length === 0 && recentDests.length > 0 && (
          <View style={[styles.suggestList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.recentHeader, { color: colors.textMuted }]}>🕐  Recent</Text>
            {recentDests.map((item, i) => {
              const distText = riderLoc
                ? (() => {
                    const mi = haversineKm(riderLoc.lat, riderLoc.lng, item.lat, item.lng) * 0.621;
                    return mi < 0.1 ? 'nearby' : `${mi.toFixed(1)} mi`;
                  })()
                : '';
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.suggestItem, { borderBottomColor: colors.border }]}
                  onPress={() => searchDrivers(item.address, { lat: item.lat, lng: item.lng })}
                >
                  <View style={styles.suggestRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestName, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.suggestAddr, { color: colors.textSub }]} numberOfLines={1}>
                        {item.address.split(",").slice(1, 3).join(",").trim()}
                      </Text>
                    </View>
                    {distText ? (
                      <Text style={[styles.suggestDist, { color: colors.textMuted }]}>{distText}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {!searching ? (
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          {locationError ? (
            <View style={[styles.locationErrBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 24, marginBottom: 8 }}>📍</Text>
              <Text style={[{ color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: 6 }]}>
                Please enable location to find drivers
              </Text>
              <Text style={[{ color: colors.textSub, fontSize: 13, textAlign: "center" }]}>
                DeRide needs your location to show nearby drivers and calculate fares.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Nearby Places</Text>
              <View style={styles.categoryRow}>
                {NEARBY_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => searchNearbyCategory(cat)}
                  >
                    <Text style={[styles.categoryText, { color: colors.text }]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.mapArea}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFillObject}
              region={{
                latitude:       riderLoc?.lat  ?? 0,
                longitude:      riderLoc?.lng  ?? 0,
                latitudeDelta:  0.05,
                longitudeDelta: 0.05,
              }}
            >
              {/* Blue pin — rider pickup */}
              {riderLoc && (
              <Marker
                coordinate={{ latitude: riderLoc!.lat, longitude: riderLoc!.lng }}
                title="Pickup"
                pinColor="#007AFF"
              />
              )}

              {/* Red pin — destination */}
              {destCoords && (
                <Marker
                  coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }}
                  title={destination}
                  pinColor="#FF3B30"
                />
              )}

              {/* Dashed route line */}
              {riderLoc && destCoords && (
                <Polyline
                  coordinates={[
                    { latitude: riderLoc!.lat,   longitude: riderLoc!.lng },
                    { latitude: destCoords.lat, longitude: destCoords.lng },
                  ]}
                  strokeColor="#007AFF"
                  strokeWidth={3}
                  lineDashPattern={[8, 4]}
                />
              )}
            </MapView>

            {/* Distance / duration pill */}
            {routeInfo && (
              <View style={[styles.routeBadge, {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }]}>
                <Text style={[styles.routeBadgeText, { color: colors.text }]}>{routeInfo}</Text>
              </View>
            )}
          </View>

          <Animated.View style={[styles.sheet, {
            backgroundColor: colors.surface, borderColor: colors.border,
            transform: [{ translateY: slideAnim }],
          }]}>
            {(() => {
              const n = drivers.length;
              const dot  = n === 0 ? "🔴" : n <= 2 ? "🟡" : "🟢";
              const avail = n === 0 ? "No drivers available"
                          : n <= 2 ? "Limited availability"
                          : n <= 5 ? "Good availability"
                          :          "High availability";
              const surgeColor = multiplier > 1 ? "#FF6600" : Colors.brand;
              return (
                <View style={[styles.demandBar, { backgroundColor: colors.surfaceAlt }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: colors.textSub, fontSize: 12 }]}>
                      {dot}  {n} driver{n !== 1 ? "s" : ""} nearby — {avail}
                    </Text>
                    {reason ? (
                      <Text style={[{ color: colors.textMuted, fontSize: 10, marginTop: 1 }]}>
                        {reason}
                      </Text>
                    ) : null}
                  </View>
                  {multiplier !== 1.0 && (
                    <Text style={{ fontSize: 12, fontWeight: "700", color: surgeColor }}>
                      {multiplier}x
                    </Text>
                  )}
                </View>
              );
            })()}

            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 12 }]}>
              Available Drivers
            </Text>

            {loading && (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Text style={[{ color: colors.textSub, fontSize: 14 }]}>
                  Searching for drivers nearby...
                </Text>
              </View>
            )}

            {!loading && drivers.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Text style={[{ fontSize: 32, marginBottom: 12 }]}>🚫</Text>
                <Text style={[{ color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: 6 }]}>
                  No drivers available nearby
                </Text>
                <Text style={[{ color: colors.textSub, fontSize: 13, marginBottom: 24, textAlign: "center" }]}>
                  Please try again shortly.
                </Text>
                <TouchableOpacity
                  style={[{ paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12,
                    backgroundColor: Colors.brand }]}
                  onPress={() => searchDrivers(destination)}
                >
                  <Text style={[{ color: "#000", fontSize: 15, fontWeight: "700" }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {!loading && drivers.map((driver, i) => (
              <DriverCard key={i} driver={driver} selected={selected} onSelect={setSelected} />
            ))}

            {selected && (
              <TouchableOpacity style={[styles.confirmBtn, Shadow.brand]} onPress={confirmRide}>
                <Text style={styles.confirmBtnText}>
                  Confirm {selected.vehicle} · ${selected.fareUSD}
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>
      )}

      {process.env.EXPO_PUBLIC_DEBUG === "true" && (
        <View style={[styles.debugPanel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Text style={[styles.debugTitle, { color: colors.textSub }]}>🔧 Debug Panel</Text>
          <TouchableOpacity onPress={async () => { await AsyncStorage.clear(); await Updates.reloadAsync(); }}>
            <Text style={[styles.debugAction, { color: "#FF4444" }]}>🗑 Reset App</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              setUpdateStatus("checking");
              try {
                const update = await Updates.checkForUpdateAsync();
                if (update.isAvailable) {
                  setUpdateStatus("updating");
                  await Updates.fetchUpdateAsync();
                  await Updates.reloadAsync();
                } else {
                  setUpdateStatus("uptodate");
                  setTimeout(() => setUpdateStatus("idle"), 3000);
                }
              } catch {
                setUpdateStatus("idle");
              }
            }}
          >
            <Text style={[styles.debugAction, { color: Colors.brand }]}>
              {updateStatus === "checking" ? "⏳ Checking..." :
               updateStatus === "updating"  ? "⬇ Updating..." :
               updateStatus === "uptodate"  ? "✅ App is up to date" :
               "🔄 Check for Updates"}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.debugInfo, { color: colors.textMuted }]}>
            Wallet: {walletAddress ? walletAddress.slice(0, 12) + "..." : "not set"}
          </Text>
          <Text style={[styles.debugInfo, { color: colors.textMuted }]}>
            Server: {process.env.EXPO_PUBLIC_MATCHING_SERVER_URL ?? "unset"}
          </Text>
          <Text style={[styles.debugInfo, { color: colors.textMuted }]}>
            Escrow: {(process.env.EXPO_PUBLIC_RIDE_ESCROW_ADDRESS ?? "unset").slice(0, 12)}...
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1 },
  header:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    paddingHorizontal: 24, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1 },
  greeting:       { fontSize: 12, marginBottom: 2 },
  title:          { fontSize: 22, fontWeight: "700" },
  profileBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center",
                    justifyContent: "center", borderWidth: 1 },
  searchBox:      { margin: 16, borderRadius: 16, borderWidth: 1, padding: 16 },
  searchRow:      { flexDirection: "row", alignItems: "center", gap: 12 },
  dot:            { width: 10, height: 10, borderRadius: 5 },
  searchLabel:    { fontSize: 14 },
  searchInput:    { flex: 1, fontSize: 14, padding: 0 },
  searchDivider:  { height: 1, marginVertical: 12, marginLeft: 22 },
  sectionTitle:   { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  recentList:     { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  recentItem:     { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, gap: 12 },
  placeIcon:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  placeInfo:      { flex: 1 },
  placeName:      { fontSize: 15, fontWeight: "600" },
  placeAddress:   { fontSize: 12, marginTop: 2 },
  mapArea:        { flex: 1 },
  routeBadge:     { position: "absolute", top: 16, alignSelf: "center",
                    paddingHorizontal: 14, paddingVertical: 8,
                    borderRadius: 999, borderWidth: 1,
                    shadowColor: "#000", shadowOpacity: 0.12,
                    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
                    elevation: 4 },
  routeBadgeText: { fontSize: 13, fontWeight: "600" },
  sheet:          { borderTopLeftRadius: 24, borderTopRightRadius: 24,
                    borderWidth: 1, borderBottomWidth: 0, padding: 24, paddingBottom: 40 },
  demandBar:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    padding: 10, borderRadius: 10, marginBottom: 16 },
  driverCard:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    padding: 16, borderRadius: 16, borderWidth: 1.5, marginBottom: 10 },
  driverLeft:     { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  driverVehicle:  { fontSize: 15, fontWeight: "600" },
  driverMeta:     { fontSize: 12, marginTop: 2 },
  driverRight:    { alignItems: "flex-end" },
  driverFare:     { fontSize: 18, fontWeight: "700" },
  driverEta:      { fontSize: 12, marginTop: 2 },
  confirmBtn:      { backgroundColor: "#00E5A0", padding: 20, borderRadius: 16, alignItems: "center", marginTop: 8 },
  confirmBtnText:  { color: "#000", fontSize: 16, fontWeight: "700" },
  suggestList:    { maxHeight: 280, borderRadius: 12, borderWidth: 1, marginTop: 4, overflow: "hidden" },
  suggestItem:    { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  suggestRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  suggestName:    { fontSize: 14, fontWeight: "600" },
  suggestAddr:    { fontSize: 11, marginTop: 2 },
  suggestDist:    { fontSize: 11, fontWeight: "600", minWidth: 48, textAlign: "right" },
  recentHeader:   { fontSize: 11, fontWeight: "700", paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4,
                    textTransform: "uppercase", letterSpacing: 0.5 },
  categoryRow:     { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  categoryChip:    { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1 },
  categoryText:    { fontSize: 13, fontWeight: "600" },
  locationErrBox:  { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", marginBottom: 16 },
  debugPanel:      { padding: 12, borderTopWidth: 1 },
  debugTitle:      { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  debugAction:     { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  debugInfo:       { fontSize: 10, marginTop: 2 },
});
