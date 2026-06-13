import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking, ActivityIndicator, RefreshControl, Modal, FlatList,
} from "react-native";
import { ethers } from "ethers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTransakOffRampUrl } from "../services/transak";
import TransakWebView from "../components/TransakWebView";
import { getPolUsdFromOracle } from "../services/chainlinkOracle";
import { fetchForexRates, formatLocal, polToLocal, CURRENCIES } from "../services/currencyService";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Shadow } from "../theme";

const POLYGON_RPC = process.env.EXPO_PUBLIC_ALCHEMY_URL ?? "";

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
  const [address,           setAddress]           = useState("");
  const [name,              setName]              = useState("Rider");
  const [balance,           setBalance]           = useState<number | null>(null);
  const [localValue,        setLocalValue]        = useState<string | null>(null);
  const [ratesAvail,        setRatesAvail]        = useState(true);
  const [totalRides,        setTotalRides]        = useState(0);
  const [loading,           setLoading]           = useState(true);
  const [refreshing,        setRefreshing]        = useState(false);
  const [showTransak,       setShowTransak]       = useState(false);
  const [transakUrl,        setTransakUrl]        = useState('');
  const [selectedCurrency,  setSelectedCurrency]  = useState("USD");
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const addr      = await AsyncStorage.getItem("rider_wallet_address") ?? "";
      const riderName = await AsyncStorage.getItem("rider_name") ?? "Rider";
      const ridesStr  = await AsyncStorage.getItem("rider_total_rides");
      const currency  = await AsyncStorage.getItem("app_currency") ?? "USD";
      setAddress(addr);
      setName(riderName);
      setTotalRides(ridesStr ? parseInt(ridesStr, 10) : 0);
      setSelectedCurrency(currency);

      if (addr && POLYGON_RPC) {
        const [balResult, priceResult, ratesResult] = await Promise.allSettled([
          (async () => {
            const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
            const raw = await provider.getBalance(addr);
            return parseFloat(ethers.formatEther(raw));
          })(),
          getPolUsdFromOracle(),
          fetchForexRates(),
        ]);

        const bal   = balResult.status   === "fulfilled" ? balResult.value   : null;
        const price = priceResult.status === "fulfilled" ? priceResult.value : null;
        const rates = ratesResult.status === "fulfilled" ? ratesResult.value : null;

        if (bal !== null) setBalance(bal);

        if (bal !== null && price !== null && rates && currency in rates) {
          const lv = polToLocal(bal, price, rates[currency]);
          setLocalValue(formatLocal(lv, currency));
          setRatesAvail(true);
        } else {
          setRatesAvail(false);
        }
      }
    } catch (err) {
      console.error("ProfileScreen fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleWithdraw = () => {
    if (!address) return;
    setTransakUrl(getTransakOffRampUrl(address));
    setShowTransak(true);
  };


  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
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
          {localValue ? (
            <>
              <Text style={[styles.balanceHero, { color: Colors.brand }]} testID="balance-local">
                {localValue}
              </Text>
              <Text style={[styles.balancePol, { color: colors.textSub }]}>
                ({balance.toFixed(4)} POL)
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.balancePol, { color: colors.text }]}>
                {balance.toFixed(4)} POL
              </Text>
              {!ratesAvail && (
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  rate unavailable
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Withdraw to bank button — only if balance > 0 */}
      {balance != null && balance > 0 && (
        <TouchableOpacity
          style={[styles.withdrawBtn, Shadow.brand]}
          onPress={handleWithdraw}
        >
          <Text style={styles.withdrawText}>Withdraw to Bank</Text>
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

      {/* Settings */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 12 }}>
          Settings
        </Text>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => setShowCurrencyPicker(true)}
          testID="currency-picker-row"
        >
          <Text style={{ fontSize: 13, color: colors.textSub }}>Display Currency</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: Colors.brand }}>
            {selectedCurrency} ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Currency picker modal */}
      <Modal
        visible={showCurrencyPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Display Currency</Text>
            <Text style={[{ color: colors.textSub, fontSize: 13, marginBottom: 16 }]}>
              POL amounts shown alongside this currency (display only).
            </Text>
            <FlatList
              data={CURRENCIES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.currencyRow}
                  onPress={async () => {
                    setSelectedCurrency(item.code);
                    await AsyncStorage.setItem("app_currency", item.code);
                    setShowCurrencyPicker(false);
                    fetchData();
                  }}
                  testID={`currency-option-${item.code}`}
                >
                  <Text style={[{ color: colors.text, fontSize: 15 }]}>
                    {item.symbol}  {item.name}
                  </Text>
                  {selectedCurrency === item.code && (
                    <Text style={{ color: Colors.brand, fontSize: 16 }}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.modalCancel, { borderColor: colors.border }]}
              onPress={() => setShowCurrencyPicker(false)}
            >
              <Text style={{ color: colors.textSub, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity
        style={[styles.signOut, { borderColor: colors.border }]}
        onPress={() => navigation.navigate("Main")}
      >
        <Text style={{ color: colors.textSub, fontSize: 14 }}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
    {showTransak && (
      <TransakWebView
        url={transakUrl}
        onClose={() => setShowTransak(false)}
        onSuccess={() => { setShowTransak(false); fetchData(); }}
      />
    )}
    </View>
  );
};

const styles = StyleSheet.create({
  center:       { flex: 1, justifyContent: "center", alignItems: "center" },
  avatar:       { width: 80, height: 80, borderRadius: 40, alignItems: "center",
                  justifyContent: "center", borderWidth: 2, marginBottom: 12 },
  card:         { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 16 },
  cardLabel:    { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  balanceHero:  { fontSize: 36, fontWeight: "700", marginBottom: 2 },
  balancePol:   { fontSize: 16, fontWeight: "500", color: "#888", marginBottom: 4 },
  withdrawBtn:  { backgroundColor: "#00E5A0", padding: 18, borderRadius: 16,
                  alignItems: "center", marginBottom: 24 },
  withdrawText: { color: "#000", fontSize: 16, fontWeight: "700" },
  section:      { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  infoRow:      { flexDirection: "row", justifyContent: "space-between",
                  paddingVertical: 10, borderBottomWidth: 1 },
  polygonBtn:   { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  signOut:      { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  settingsRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  paddingVertical: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:   { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: "70%" },
  modalTitle:   { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  currencyRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  paddingVertical: 14, borderBottomWidth: 1 },
  modalCancel:  { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
