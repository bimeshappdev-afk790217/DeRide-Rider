import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking, ActivityIndicator, RefreshControl,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ethers } from "ethers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Shadow } from "../theme";

const POLYGON_RPC = process.env.EXPO_PUBLIC_ALCHEMY_URL ?? "";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd";

const InfoRow = ({ label, value, accent = false }: any) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={{ fontSize: 13, color: colors.textSub }}>{label}</Text>
      <Text style={[{ fontSize: 13, fontWeight: "600" }, { color: accent ? Colors.brand : colors.text }]}>
        {value}
      </Text>
    </View>
  );
};

export const ProfileScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const [address, setAddress]     = useState("");
  const [name, setName]           = useState("Rider");
  const [balance, setBalance]     = useState<number | null>(null);
  const [polPrice, setPolPrice]   = useState<number | null>(null);
  const [totalRides, setTotalRides] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const addr     = await AsyncStorage.getItem("rider_wallet_address") ?? "";
      const riderName = await AsyncStorage.getItem("rider_name") ?? "Rider";
      const ridesStr = await AsyncStorage.getItem("rider_total_rides");
      setAddress(addr);
      setName(riderName);
      setTotalRides(ridesStr ? parseInt(ridesStr, 10) : 0);

      if (addr && POLYGON_RPC) {
        const [balResult, priceResult] = await Promise.allSettled([
          (async () => {
            const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
            const raw = await provider.getBalance(addr);
            return parseFloat(ethers.formatEther(raw));
          })(),
          (async () => {
            const res = await fetch(COINGECKO_URL);
            const json = await res.json();
            return (json["matic-network"]?.usd as number) ?? null;
          })(),
        ]);
        if (balResult.status === "fulfilled") setBalance(balResult.value);
        if (priceResult.status === "fulfilled") setPolPrice(priceResult.value);
      }
    } catch (err) {
      console.error("ProfileScreen fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleWithdraw = async () => {
    if (!address) return;
    setWithdrawing(true);
    try {
      const url =
        `https://global.transak.com?` +
        `walletAddress=${address}&` +
        `cryptoCurrencyCode=POL&` +
        `network=polygon&` +
        `productsAvailed=SELL&` +
        `fiatCurrency=INR`;
      await WebBrowser.openBrowserAsync(url);
      await fetchData();
    } finally {
      setWithdrawing(false);
    }
  };

  const usdValue =
    balance != null && polPrice != null
      ? (balance * polPrice).toFixed(2)
      : null;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); fetchData(); }}
          tintColor={Colors.brand}
        />
      }
    >
      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <View style={[styles.avatar, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
          <Text style={{ fontSize: 36, fontWeight: "700", color: Colors.brand }}>
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.text, marginBottom: 8 }}>
          {name}
        </Text>
      </View>

      {/* Wallet balance card */}
      {balance != null && (
        <View style={[styles.card, Shadow.md, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.textSub }]}>Wallet Balance</Text>
          <Text style={[styles.balancePol, { color: colors.text }]}>
            {balance.toFixed(4)} POL
          </Text>
          {usdValue && (
            <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.brand }}>
              ≈ ${usdValue} USD
            </Text>
          )}
        </View>
      )}

      {/* Withdraw to bank button — only if balance > 0 */}
      {balance != null && balance > 0 && (
        <TouchableOpacity
          style={[styles.withdrawBtn, Shadow.brand, withdrawing && { opacity: 0.7 }]}
          onPress={handleWithdraw}
          disabled={withdrawing}
        >
          {withdrawing
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.withdrawText}>Withdraw to Bank</Text>
          }
        </TouchableOpacity>
      )}

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 16 }}>
          Ride History
        </Text>
        <InfoRow label="Total Rides" value={totalRides} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 12 }}>
          Blockchain Identity
        </Text>
        <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 20, marginBottom: 12 }}>
          Your ride history is permanently stored on Polygon. You own your data.
        </Text>
        <InfoRow label="Network" value="Polygon Mainnet" />
        {address ? (
          <InfoRow
            label="Address"
            value={`${address.slice(0, 10)}...${address.slice(-6)}`}
            accent
          />
        ) : null}
        {address ? (
          <TouchableOpacity
            style={[styles.polygonBtn, { borderColor: Colors.brand }]}
            onPress={() => Linking.openURL(`https://polygonscan.com/address/${address}`)}
          >
            <Text style={{ color: Colors.brand, fontSize: 13, fontWeight: "600" }}>
              View on Polygonscan ↗
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.signOut, { borderColor: colors.border }]}
        onPress={() => navigation.navigate("Main")}
      >
        <Text style={{ color: colors.textSub, fontSize: 14 }}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  center:       { flex: 1, justifyContent: "center", alignItems: "center" },
  avatar:       { width: 80, height: 80, borderRadius: 40, alignItems: "center",
                  justifyContent: "center", borderWidth: 2, marginBottom: 12 },
  card:         { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 16 },
  cardLabel:    { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  balancePol:   { fontSize: 32, fontWeight: "700", marginBottom: 4 },
  withdrawBtn:  { backgroundColor: "#00E5A0", padding: 18, borderRadius: 16,
                  alignItems: "center", marginBottom: 24 },
  withdrawText: { color: "#000", fontSize: 16, fontWeight: "700" },
  section:      { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  infoRow:      { flexDirection: "row", justifyContent: "space-between",
                  paddingVertical: 10, borderBottomWidth: 1 },
  polygonBtn:   { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  signOut:      { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
