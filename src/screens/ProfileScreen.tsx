import React from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Colors } from "../theme";

const RIDER = {
  address:     "0xB53E43d7c44Df2acddEa0FEE3C3A23d776B2271E",
  name:        "Rider",
  totalRides:  23,
  totalSpent:  187.40,
  rating:      4.92,
  memberSince: "March 2026",
};

const InfoRow = ({ label, value, accent = false }: any) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[{ fontSize: 13, color: colors.textSub }]}>{label}</Text>
      <Text style={[{ fontSize: 13, fontWeight: "600" },
        { color: accent ? Colors.brand : colors.text }]}>{value}</Text>
    </View>
  );
};

export const ProfileScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  return (
    <ScrollView style={[{ flex: 1, backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 24 }}>

      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <View style={[styles.avatar, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
          <Text style={[{ fontSize: 36, fontWeight: "700", color: Colors.brand }]}>R</Text>
        </View>
        <Text style={[{ fontSize: 28, fontWeight: "700", color: colors.text, marginBottom: 8 }]}>
          {RIDER.name}
        </Text>
        <Text style={[{ color: colors.textMuted, fontSize: 12 }]}>
          Member since {RIDER.memberSince}
        </Text>
      </View>

      <View style={[styles.ratingCard, { backgroundColor: Colors.brandGlow, borderColor: Colors.brand }]}>
        <Text style={[{ fontSize: 48, fontWeight: "700", letterSpacing: -2, color: Colors.brand }]}>
          {RIDER.rating.toFixed(2)}
        </Text>
        <Text style={[{ color: Colors.brand, fontSize: 20, marginVertical: 4 }]}>★★★★★</Text>
        <Text style={[{ color: Colors.brandDim, fontSize: 12 }]}>Rider rating</Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 16 }]}>
          Ride History
        </Text>
        <InfoRow label="Total Rides"  value={RIDER.totalRides} />
        <InfoRow label="Total Spent"  value={`$${RIDER.totalSpent.toFixed(2)}`} accent />
        <InfoRow label="Avg per Ride" value={`$${(RIDER.totalSpent / RIDER.totalRides).toFixed(2)}`} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 12 }]}>
          Blockchain Identity
        </Text>
        <Text style={[{ color: colors.textSub, fontSize: 13, lineHeight: 20, marginBottom: 12 }]}>
          Your ride history and rating are permanently stored on Polygon. You own your data.
        </Text>
        <InfoRow label="Network" value="Polygon Mainnet" />
        <InfoRow
          label="Address"
          value={`${RIDER.address.slice(0,10)}...${RIDER.address.slice(-6)}`}
          accent
        />
        <TouchableOpacity
          style={[styles.polygonBtn, { borderColor: Colors.brand }]}
          onPress={() => Linking.openURL(`https://polygonscan.com/address/${RIDER.address}`)}
        >
          <Text style={[{ color: Colors.brand, fontSize: 13, fontWeight: "600" }]}>
            View on Polygonscan ↗
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.signOut, { borderColor: colors.border }]}
        onPress={() => navigation.navigate("Main")}
      >
        <Text style={[{ color: colors.textSub, fontSize: 14 }]}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  avatar:      { width: 80, height: 80, borderRadius: 40, alignItems: "center",
                 justifyContent: "center", borderWidth: 2, marginBottom: 12 },
  ratingCard:  { alignItems: "center", padding: 32, borderRadius: 16,
                 borderWidth: 1, marginBottom: 24 },
  section:     { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  infoRow:     { flexDirection: "row", justifyContent: "space-between",
                 paddingVertical: 10, borderBottomWidth: 1 },
  polygonBtn:  { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  signOut:     { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
