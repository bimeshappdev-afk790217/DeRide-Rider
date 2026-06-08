import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import * as Crypto from "expo-crypto";
import { ethers } from "ethers";
import PaymentWebView from "../components/PaymentWebView";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Shadow } from "../theme";

const POLYGON_RPC = process.env.EXPO_PUBLIC_ALCHEMY_URL
  ?? "https://polygon-mainnet.g.alchemy.com/v2/Q25ZjjJ1haH3RxjFuVWuS";
const MIN_BALANCE_POL = 0.01;

export const RegisterScreen = ({ onRegistered }: { onRegistered: () => void }) => {
  const { colors } = useTheme();
  const [name, setName]               = useState("");
  const [phone, setPhone]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [pollingBalance, setPollingBalance] = useState(false);
  const [showPayment, setShowPayment]       = useState(false);
  const [step, setStep]               = useState<"form" | "fund">("form");
  const [walletAddress, setWalletAddress] = useState("");
  const [balance, setBalance]         = useState(0);

  const generateWallet = async () => {
    const randomBytes   = await Crypto.getRandomBytesAsync(32);
    const hexArray      = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, "0"));
    const privateKeyHex = "0x" + hexArray.join("");
    return new ethers.Wallet(privateKeyHex);
  };

  const checkBalance = async (address: string): Promise<number> => {
    try {
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const raw = await provider.getBalance(address);
      return parseFloat(ethers.formatEther(raw));
    } catch {
      return 0;
    }
  };

  const moonpayOnRampUrl =
    `https://buy.moonpay.com?` +
    `walletAddress=${walletAddress}&` +
    `currencyCode=matic_polygon&` +
    `baseCurrencyCode=inr&` +
    `baseCurrencyAmount=500`;

  const handlePaymentSuccess = () => {
    setShowPayment(false);
    onRegistered();
  };

  const handlePaymentClose = async () => {
    setShowPayment(false);
    setPollingBalance(true);
    try {
      for (let i = 0; i < 36; i++) {
        const bal = await checkBalance(walletAddress);
        setBalance(bal);
        if (bal >= MIN_BALANCE_POL) {
          setPollingBalance(false);
          onRegistered();
          return;
        }
        await new Promise(r => setTimeout(r, 5000));
      }
    } finally {
      setPollingBalance(false);
    }
  };

  const handleRegister = async () => {
    if (!name.trim())  { Alert.alert("Error", "Please enter your name"); return; }
    if (!phone.trim()) { Alert.alert("Error", "Please enter your phone number"); return; }

    setLoading(true);
    try {
      const wallet = await generateWallet();

      await AsyncStorage.setItem("rider_wallet_address", wallet.address);
      await SecureStore.setItemAsync("rider_wallet_key", wallet.privateKey);
      await AsyncStorage.setItem("rider_name",           name.trim());
      await AsyncStorage.setItem("rider_phone",          phone.trim());

      console.log("Rider wallet created:", wallet.address);

      const bal = await checkBalance(wallet.address);
      setWalletAddress(wallet.address);
      setBalance(bal);

      if (bal >= MIN_BALANCE_POL) {
        onRegistered();
      } else {
        setStep("fund");
      }

    } catch (err: any) {
      console.error("Registration error:", err.message);
      Alert.alert("Error", `Registration failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (step === "fund") {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ScrollView contentContainerStyle={styles.scroll}>

          <View style={styles.header}>
            <Text style={styles.emoji}>💳</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Add funds to pay for rides
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSub }]}>
              Your wallet needs a small amount of POL to pay for rides
              on the Polygon network.
            </Text>
          </View>

          <View style={[styles.balanceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.balanceLabel, { color: colors.textSub }]}>
              Current balance
            </Text>
            <Text style={[styles.balanceValue, { color: colors.text }]}>
              {balance.toFixed(4)} POL
            </Text>
            <Text style={[styles.balanceNeeded, { color: colors.textMuted }]}>
              Minimum needed: {MIN_BALANCE_POL} POL (~$0.01)
            </Text>
          </View>

          <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.noteText, { color: colors.textSub }]}>
              🔐 Your wallet address:{"\n"}
              <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
                {walletAddress}
              </Text>
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, Shadow.brand, pollingBalance && { opacity: 0.7 }]}
            onPress={() => setShowPayment(true)}
            disabled={pollingBalance}
          >
            {pollingBalance
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.btnText}>Add funds with Card/UPI</Text>
            }
          </TouchableOpacity>
          {pollingBalance && (
            <Text style={[styles.noteText, { color: Colors.brand, marginTop: 8 }]}>
              Waiting for POL to arrive...
            </Text>
          )}

          {showPayment && (
            <PaymentWebView
              url={moonpayOnRampUrl}
              onClose={handlePaymentClose}
              onSuccess={handlePaymentSuccess}
            />
          )}

          <TouchableOpacity
            style={[styles.skipBtn, { borderColor: colors.border }]}
            onPress={onRegistered}
          >
            <Text style={[styles.skipText, { color: colors.textSub }]}>
              Skip for now (fund later)
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
          <Text style={styles.emoji}>🚗</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to DeRide
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>
            Ride on your own terms.{"\n"}No middleman. No surge pricing.
          </Text>
        </View>

        <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSub }]}>First Name</Text>
          <TextInput
            style={[styles.input, {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surfaceAlt,
            }]}
            placeholder="Enter your first name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { color: colors.textSub, marginTop: 16 }]}>
            Phone Number
          </Text>
          <TextInput
            style={[styles.input, {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surfaceAlt,
            }]}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor={colors.textMuted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.noteText, { color: colors.textSub }]}>
            🔐 A secure blockchain wallet will be created automatically.
            Your rides and payments are protected by Polygon.
          </Text>
        </View>

        <View style={[styles.featuresCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={[styles.featureText, { color: colors.textSub }]}>
              Transparent organic pricing — no hidden surge
            </Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={[styles.featureText, { color: colors.textSub }]}>
              Verified drivers — background checked
            </Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={[styles.featureText, { color: colors.textSub }]}>
              Payment protected by smart contract
            </Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={[styles.featureText, { color: colors.textSub }]}>
              You own your data — not a corporation
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.btn, Shadow.brand, loading && { opacity: 0.7 }]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.btnText}>Start Riding →</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container:    { flex: 1 },
  scroll:       { padding: 24, paddingTop: 60 },
  header:       { alignItems: "center", marginBottom: 32 },
  emoji:        { fontSize: 56, marginBottom: 12 },
  title:        { fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  subtitle:     { fontSize: 15, textAlign: "center", lineHeight: 22, color: "#888" },
  form:         { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  label:        { fontSize: 13, marginBottom: 6, fontWeight: "600" },
  input:        { borderWidth: 1, borderRadius: 10, padding: 14,
                  fontSize: 15, marginBottom: 4 },
  noteCard:     { borderRadius: 12, padding: 14, marginBottom: 16 },
  noteText:     { fontSize: 13, lineHeight: 20, textAlign: "center" },
  featuresCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  featureRow:   { flexDirection: "row", alignItems: "center",
                  gap: 10, marginBottom: 10 },
  featureIcon:  { fontSize: 16 },
  featureText:  { flex: 1, fontSize: 13, lineHeight: 20 },
  btn:          { backgroundColor: "#00E5A0", padding: 20,
                  borderRadius: 16, alignItems: "center" },
  btnText:      { color: "#000", fontSize: 16, fontWeight: "700" },
  balanceCard:  { borderRadius: 16, borderWidth: 1, padding: 20,
                  marginBottom: 16, alignItems: "center" },
  balanceLabel: { fontSize: 13, marginBottom: 4 },
  balanceValue: { fontSize: 32, fontWeight: "700", marginBottom: 4 },
  balanceNeeded:{ fontSize: 12 },
  skipBtn:      { marginTop: 12, padding: 16, borderRadius: 12,
                  borderWidth: 1, alignItems: "center" },
  skipText:     { fontSize: 14 },
});
