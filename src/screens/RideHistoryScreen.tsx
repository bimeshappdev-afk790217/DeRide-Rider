import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { ethers } from "ethers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPolUsdFromOracle } from "../services/chainlinkOracle";
import { fetchForexRates, polToLocal, formatLocal } from "../services/currencyService";
import { useTheme } from "../theme/ThemeContext";
import { Colors } from "../theme";

const ESCROW_ADDR = process.env.EXPO_PUBLIC_RIDE_ESCROW_ADDRESS ?? "";
const RPC_URL     = process.env.EXPO_PUBLIC_ALCHEMY_URL ?? "";
const LOG_CHUNK   = 2000;

const GET_RIDE_ABI = [
  "function getRide(bytes32) external view returns (address, address, address, address, uint256, bytes32, bytes32, bytes32, uint256, uint256, uint8, uint256, uint256, uint256, uint256, uint256, uint256, uint8, address)",
];

const RIDE_CREATED_SIG = "RideCreated(bytes32,address,address,uint256)";
const STATUS_COMPLETED = 5;
const STATUS_CANCELLED = 6;

const MULT_LABEL: Record<number, string> = {
  125: "Rush +25%", 150: "Priority +50%", 200: "Emergency 2×",
};

interface RideEntry {
  rideId: string;
  driver: string;
  fare: bigint;
  status: number;
  createdAt: number;
  offerMultiplier: number;
}

export const RideHistoryScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const PAGE_SIZE = parseInt(process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE ?? "4", 10);

  const [rides,        setRides]        = useState<RideEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [polUsdRate,   setPolUsdRate]   = useState<number | null>(null);
  const [forexRate,    setForexRate]    = useState<number | null>(null);
  const [currency,     setCurrency]     = useState("USD");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const addr = await AsyncStorage.getItem("rider_wallet_address");
      if (!addr || !RPC_URL || !ESCROW_ADDR) { setLoading(false); return; }

      const cur = await AsyncStorage.getItem("app_currency") ?? "USD";
      setCurrency(cur);

      const [polUsd, rates] = await Promise.allSettled([
        getPolUsdFromOracle(),
        fetchForexRates(),
      ]);
      if (polUsd.status  === "fulfilled" && polUsd.value  !== null) setPolUsdRate(polUsd.value);
      if (rates.status   === "fulfilled" && rates.value   && cur in rates.value) {
        setForexRate(rates.value[cur]);
      }

      const provider    = new ethers.JsonRpcProvider(RPC_URL);
      const latestBlock = await provider.getBlockNumber();
      const deployBlock = parseInt(process.env.EXPO_PUBLIC_ESCROW_DEPLOY_BLOCK ?? "0", 10);
      const fromBlock   = deployBlock > 0 ? deployBlock : Math.max(0, latestBlock - 4_000_000);

      const TOPIC0      = ethers.id(RIDE_CREATED_SIG);
      const paddedAddr  = "0x" + "000000000000000000000000" + addr.slice(2).toLowerCase();
      const rideIds: string[] = [];

      for (let from = fromBlock; from <= latestBlock; from += LOG_CHUNK) {
        const to   = Math.min(from + LOG_CHUNK - 1, latestBlock);
        const logs = await provider.getLogs({
          address: ESCROW_ADDR,
          fromBlock: from,
          toBlock:   to,
          topics:    [TOPIC0, null, paddedAddr, null],
        });
        for (const log of logs) rideIds.push(log.topics[1]);
      }

      const contract = new ethers.Contract(ESCROW_ADDR, GET_RIDE_ABI, provider);
      const results  = await Promise.allSettled(rideIds.map(id => contract.getRide(id)));

      const entries: RideEntry[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== "fulfilled") continue;
        const d      = r.value;
        const status = Number(d[10]);
        if (status !== STATUS_COMPLETED && status !== STATUS_CANCELLED) continue;
        entries.push({
          rideId:         rideIds[i],
          driver:         d[1] as string,
          fare:           d[4] as bigint,
          status,
          createdAt:      Number(d[11]),
          offerMultiplier: Number(d[17]),
        });
      }

      setRides(entries.sort((a, b) => b.createdAt - a.createdAt));
      setVisibleCount(PAGE_SIZE);
    } catch (e: any) {
      console.warn("[History] load error:", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const renderFarePol = (fareWei: bigint) => {
    const pol = parseFloat(ethers.formatEther(fareWei));
    return `${pol.toFixed(4)} POL`;
  };

  const renderFareLocal = (fareWei: bigint) => {
    const pol = parseFloat(ethers.formatEther(fareWei));
    if (polUsdRate === null || forexRate === null) return null;
    return formatLocal(polToLocal(pol, polUsdRate, forexRate), currency);
  };

  const renderItem = ({ item, index }: { item: RideEntry; index: number }) => {
    const isCompleted = item.status === STATUS_COMPLETED;
    const dateStr = item.createdAt > 0
      ? new Date(item.createdAt * 1000).toLocaleDateString() + " " +
        new Date(item.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "Unknown date";
    const counterparty = item.driver && item.driver !== ("0x" + "0".repeat(40))
      ? `${item.driver.slice(0, 8)}…${item.driver.slice(-4)}`
      : "—";
    const localFare = renderFareLocal(item.fare);
    const polFare   = renderFarePol(item.fare);

    return (
      <View
        testID={`history-item-${index}`}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.row}>
          <Text style={{ color: colors.textSub, fontSize: 12 }}>{dateStr}</Text>
          <View style={[styles.badge, { backgroundColor: isCompleted ? "#00E5A015" : "#FF444415" }]}>
            <Text style={{ color: isCompleted ? "#00E5A0" : "#FF4444", fontSize: 11, fontWeight: "700" }}>
              {isCompleted ? "Completed" : "Cancelled"}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={{ color: colors.textSub, fontSize: 11, marginBottom: 2 }}>Fare</Text>
            {localFare ? (
              <Text testID="fare-local-hero" style={{ color: Colors.brand, fontWeight: "700", fontSize: 16 }}>
                {localFare}
              </Text>
            ) : null}
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>{polFare}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: colors.textSub, fontSize: 11, marginBottom: 2 }}>
              {isCompleted ? "You paid" : "Status"}
            </Text>
            {isCompleted ? (
              <>
                {localFare ? (
                  <Text style={{ color: Colors.brand, fontWeight: "700", fontSize: 16 }}>{localFare}</Text>
                ) : null}
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>{polFare}</Text>
              </>
            ) : (
              <Text style={{ color: "#00E5A0", fontWeight: "600", fontSize: 14 }}>Refunded</Text>
            )}
          </View>
        </View>

        {MULT_LABEL[item.offerMultiplier] && (
          <Text style={{ color: Colors.brand, fontSize: 11, marginTop: 2 }}>
            {MULT_LABEL[item.offerMultiplier]}
          </Text>
        )}
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
          Driver: {counterparty}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={Colors.brand} />
        <Text style={{ color: colors.textSub, marginTop: 12 }}>Loading ride history…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rides.slice(0, visibleCount)}
        keyExtractor={item => item.rideId}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <Text style={[styles.heading, { color: colors.text }]}>Ride History</Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ color: colors.textSub, fontSize: 16 }} testID="empty-state">
              No past rides yet.
            </Text>
          </View>
        }
        ListFooterComponent={
          rides.length > visibleCount ? (
            <TouchableOpacity
              testID="load-more-btn"
              style={[styles.loadMore, { borderColor: colors.border }]}
              onPress={() => setVisibleCount(v => v + PAGE_SIZE)}
            >
              <Text style={{ color: colors.textSub }}>
                Load more ({rides.length - visibleCount} remaining)
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  center:   { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyWrap:{ flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 60 },
  heading:  { fontSize: 24, fontWeight: "700", marginBottom: 16, paddingTop: 16 },
  card:     { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  row:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  loadMore: { padding: 16, borderRadius: 12, borderWidth: 1, alignItems: "center", marginTop: 8 },
});
