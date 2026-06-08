import React from "react";
import { Modal, View, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";

export default function PaymentWebView({
  url,
  onClose,
  onSuccess,
}: {
  url: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  return (
    <Modal visible={true} animationType="slide">
      <View style={{ flex: 1 }}>
        <TouchableOpacity
          onPress={onClose}
          style={{ padding: 16, backgroundColor: "#000", alignItems: "flex-end" }}
        >
          <Text style={{ color: "white" }}>✕ Close</Text>
        </TouchableOpacity>
        <WebView
          source={{ uri: url }}
          sharedCookiesEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          onNavigationStateChange={(state) => {
            if (state.url.includes("success") || state.url.includes("completed")) {
              onSuccess?.();
              onClose();
            }
          }}
        />
      </View>
    </Modal>
  );
}
