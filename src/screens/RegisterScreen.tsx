import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, ScrollView, Switch,
} from "react-native";
import * as Crypto from "expo-crypto";
import { ethers } from "ethers";
import { getTransakOnRampUrl } from "../services/transak";
import TransakWebView from "../components/TransakWebView";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "../theme/ThemeContext";
import { Colors, Shadow } from "../theme";

const POLYGON_RPC = process.env.EXPO_PUBLIC_ALCHEMY_URL
  ?? "https://polygon-mainnet.g.alchemy.com/v2/Q25ZjjJ1haH3RxjFuVWuS";
const MIN_BALANCE_POL = 0.01;

export const RegisterScreen = ({ onRegistered }: { onRegistered: () => void }) => {
  const { colors } = useTheme();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Step + wallet ───────────────────────────────────────────────────────────
  const [step, setStep]               = useState<"form" | "backup" | "fund">("form");
  const [wallet, setWallet]           = useState<ethers.Wallet | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [keySaved, setKeySaved]       = useState(false);
  const [keyVisible, setKeyVisible]   = useState(false);

  // ── Import mode ─────────────────────────────────────────────────────────────
  const [importMode, setImportMode]   = useState(false);
  const [importKey, setImportKey]     = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting]     = useState(false);
  const [walletImported, setWalletImported] = useState(false);

  // ── Fund step ───────────────────────────────────────────────────────────────
  const [balance, setBalance]             = useState(0);
  const [pollingBalance, setPollingBalance] = useState(false);
  const [showTransak, setShowTransak]     = useState(false);
  const [transakUrl, setTransakUrl]       = useState('');

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const checkBalance = async (address: string): Promise<number> => {
    try {
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const raw = await provider.getBalance(address);
      return parseFloat(ethers.formatEther(raw));
    } catch {
      return 0;
    }
  };

  // ── Step 1: Create new wallet ────────────────────────────────────────────────

  const handleRegister = async () => {
    if (!name.trim())  { Alert.alert("Error", "Please enter your name"); return; }
    if (!phone.trim()) { Alert.alert("Error", "Please enter your phone number"); return; }

    setLoading(true);
    try {
      const randomBytes   = await Crypto.getRandomBytesAsync(32);
      const privateKeyHex = "0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const w             = new ethers.Wallet(privateKeyHex);

      await AsyncStorage.setItem("rider_wallet_address", w.address);
      await SecureStore.setItemAsync("rider_wallet_key", w.privateKey);
      await AsyncStorage.setItem("rider_name",  name.trim());
      await AsyncStorage.setItem("rider_phone", phone.trim());

      console.log("Rider wallet created:", w.address);
      setWallet(w);
      setWalletAddress(w.address);
      setStep("backup");
    } catch (err: any) {
      console.error("Registration error:", err.message);
      Alert.alert("Error", `Registration failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Backup confirmation ──────────────────────────────────────────────

  const handleBackupContinue = async () => {
    if (!keySaved) {
      Alert.alert(
        "Back Up Your Key First",
        "Your private key is the only way to recover your wallet and funds. Please write it down before continuing.",
      );
      return;
    }
    try {
      const bal = await checkBalance(walletAddress);
      setBalance(bal);
      if (bal >= MIN_BALANCE_POL) {
        onRegistered();
      } else {
        setStep("fund");
      }
    } catch {
      setStep("fund");
    }
  };

  // ── Import existing wallet ───────────────────────────────────────────────────

  const handleImportWallet = async () => {
    const key = importKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      setImportError("Invalid private key. Must be 0x followed by 64 hex characters.");
      return;
    }
    if (!name.trim())  { setImportError("Please enter your name first."); return; }
    if (!phone.trim()) { setImportError("Please enter your phone number first."); return; }

    setImporting(true);
    setImportError("");
    try {
      const imported = new ethers.Wallet(key);
      await SecureStore.setItemAsync("rider_wallet_key", imported.privateKey);
      await AsyncStorage.setItem("rider_wallet_address", imported.address);
      await AsyncStorage.setItem("rider_name",  name.trim());
      await AsyncStorage.setItem("rider_phone", phone.trim());

      setWallet(imported);
      setWalletAddress(imported.address);
      setWalletImported(true);

      const bal = await checkBalance(imported.address);
      setBalance(bal);
      if (bal >= MIN_BALANCE_POL) {
        onRegistered();
      } else {
        setStep("fund");
      }
    } catch (err: any) {
      setImportError("Import failed: " + (err.message ?? "invalid key"));
    } finally {
      setImporting(false);
    }
  };

  // ── Transak ─────────────────────────────────────────────────────────────────

  const handleOpenTransak = () => {
    setTransakUrl(getTransakOnRampUrl(walletAddress));
    setShowTransak(true);
  };

  const handleTransakSuccess = async () => {
    setShowTransak(false);
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Step: backup ─────────────────────────────────────────────────────────────
  if (step === "backup" && wallet) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.emoji}>🔐</Text>
            <Text style={[styles.title, { color: colors.text }]}>Back Up Your Key</Text>
            <Text style={[styles.subtitle, { color: colors.textSub }]}>
              Write this down and store it somewhere safe. If you lose it, you lose access to your funds permanently.
            </Text>
          </View>

          <View style={[styles.walletCard, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
            <Text style={[styles.walletLabel, { color: Colors.brandDim }]}>Wallet Address</Text>
            <Text style={[styles.walletAddress, { color: Colors.brand }]}>
              {wallet.address.slice(0, 12)}...{wallet.address.slice(-10)}
            </Text>
          </View>

          <View style={[styles.keyCard, { backgroundColor: "#1a0000", borderColor: "#FF4444" }]}>
            <View style={styles.keyHeader}>
              <Text style={[styles.walletLabel, { color: "#FF9999" }]}>Private Key — DO NOT SHARE</Text>
              <TouchableOpacity onPress={() => setKeyVisible(v => !v)}>
                <Text style={{ color: "#FF4444", fontSize: 13, fontWeight: "600" }}>
                  {keyVisible ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text
              style={[styles.keyText, {
                color:           keyVisible ? "#FF4444" : "transparent",
                backgroundColor: keyVisible ? "transparent" : "#FF4444",
                borderRadius:    4,
              }]}
              selectable={keyVisible}
            >
              {wallet.privateKey}
            </Text>
            <Text style={{ color: "#FF9999", fontSize: 11, marginTop: 8, lineHeight: 16 }}>
              Tap "Show" to reveal. Write it down or store in a password manager.{"\n"}
              This is shown only once.
            </Text>
          </View>

          <View style={[styles.confirmRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                I have saved my private key
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                I understand I cannot recover it if lost
              </Text>
            </View>
            <Switch
              value={keySaved}
              onValueChange={setKeySaved}
              trackColor={{ true: Colors.brand }}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, Shadow.brand, !keySaved && { opacity: 0.5 }]}
            onPress={handleBackupContinue}
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Step: fund ───────────────────────────────────────────────────────────────
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
              {walletImported ? "🔑 Imported wallet:" : "🔐 Your wallet address:"}{"\n"}
              <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
                {walletAddress}
              </Text>
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, Shadow.brand, pollingBalance && { opacity: 0.7 }]}
            onPress={handleOpenTransak}
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

          <TouchableOpacity
            style={[styles.skipBtn, { borderColor: colors.border }]}
            onPress={onRegistered}
          >
            <Text style={[styles.skipText, { color: colors.textSub }]}>
              Skip for now (fund later)
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {showTransak && (
          <TransakWebView
            url={transakUrl}
            onClose={() => setShowTransak(false)}
            onSuccess={handleTransakSuccess}
          />
        )}
      </View>
    );
  }

  // ── Step: form ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.emoji}>🚗</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to DeRide
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>
            Ride on your own terms.{"\n"}No middleman. No surge pricing.
          </Text>
        </View>

        {/* Create New / Import Wallet toggle */}
        <View style={[styles.modeRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.modeBtn, !importMode && { backgroundColor: Colors.brand }]}
            onPress={() => { setImportMode(false); setImportError(""); }}
          >
            <Text style={[styles.modeBtnText, { color: !importMode ? "#000" : colors.textSub }]}>
              Create New
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, importMode && { backgroundColor: "#6C63FF" }]}
            onPress={() => { setImportMode(true); setImportError(""); }}
          >
            <Text style={[styles.modeBtnText, { color: importMode ? "#fff" : colors.textSub }]}>
              Import Wallet
            </Text>
          </TouchableOpacity>
        </View>

        {/* Shared name + phone fields */}
        <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSub }]}>First Name</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            placeholder="Enter your first name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { color: colors.textSub, marginTop: 16 }]}>Phone Number</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor={colors.textMuted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        {importMode ? (
          <>
            <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textSub }]}>Private Key</Text>
              <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>
                Paste your 66-character private key to restore your wallet on this device.
              </Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt, fontFamily: "Courier", fontSize: 13 }]}
                placeholder="0x1a2b3c4d..."
                placeholderTextColor={colors.textMuted}
                value={importKey}
                onChangeText={t => { setImportKey(t); setImportError(""); }}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              {importError ? (
                <Text style={{ color: "#FF6666", fontSize: 12, marginTop: 6 }}>{importError}</Text>
              ) : null}
            </View>

            <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.noteText, { color: colors.textSub }]}>
                🔑 Your key starts with 0x and is 66 characters long.{"\n"}
                It never leaves your device.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: "#6C63FF" }, importing && { opacity: 0.6 }]}
              onPress={handleImportWallet}
              disabled={importing}
            >
              {importing
                ? <ActivityIndicator color="#fff" />
                : <Text style={[styles.btnText, { color: "#fff" }]}>Import & Recover</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.noteText, { color: colors.textSub }]}>
                🔐 A secure blockchain wallet will be created automatically.
                You'll be shown your recovery key on the next screen.
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
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container:    { flex: 1 },
  scroll:       { padding: 24, paddingTop: 60, paddingBottom: 40 },
  header:       { alignItems: "center", marginBottom: 32 },
  emoji:        { fontSize: 56, marginBottom: 12 },
  title:        { fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  subtitle:     { fontSize: 15, textAlign: "center", lineHeight: 22 },
  modeRow:      { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, marginBottom: 20, gap: 4 },
  modeBtn:      { flex: 1, borderRadius: 9, padding: 12, alignItems: "center" },
  modeBtnText:  { fontSize: 14, fontWeight: "700" },
  form:         { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  label:        { fontSize: 13, marginBottom: 6, fontWeight: "600" },
  input:        { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 4 },
  noteCard:     { borderRadius: 12, padding: 14, marginBottom: 16 },
  noteText:     { fontSize: 13, lineHeight: 20, textAlign: "center" },
  featuresCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  featureRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  featureIcon:  { fontSize: 16 },
  featureText:  { flex: 1, fontSize: 13, lineHeight: 20 },
  btn:          { backgroundColor: "#00E5A0", padding: 20, borderRadius: 16, alignItems: "center" },
  btnText:      { color: "#000", fontSize: 16, fontWeight: "700" },
  // backup step
  walletCard:   { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: "center", marginBottom: 16 },
  walletLabel:  { fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" },
  walletAddress:{ fontSize: 15, fontWeight: "700", fontFamily: "Courier" },
  keyCard:      { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  keyHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  keyText:      { fontSize: 11, fontFamily: "Courier", lineHeight: 18, letterSpacing: 0.5 },
  confirmRow:   { flexDirection: "row", alignItems: "center", borderWidth: 1,
                  borderRadius: 12, padding: 16, marginBottom: 20, gap: 12 },
  // fund step
  balanceCard:  { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 16, alignItems: "center" },
  balanceLabel: { fontSize: 13, marginBottom: 4 },
  balanceValue: { fontSize: 32, fontWeight: "700", marginBottom: 4 },
  balanceNeeded:{ fontSize: 12 },
  skipBtn:      { marginTop: 12, padding: 16, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  skipText:     { fontSize: 14 },
});
