import { WebView } from 'react-native-webview'
import { Modal, View, TouchableOpacity,
         Text, StyleSheet, Alert } from 'react-native'

export default function TransakWebView({
  url, onClose, onSuccess
}: {
  url: string
  onClose: () => void
  onSuccess?: (txId: string) => void
}) {
  return (
    <Modal visible={true} animationType="slide">
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Always visible close button - high z-index */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        <WebView
          source={{ uri: url }}
          sharedCookiesEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          style={{ marginTop: 0 }}
          onError={() => {
            Alert.alert(
              "Payment Unavailable",
              "Could not load payment page. Please try again.",
              [{ text: "Close", onPress: onClose }]
            )
          }}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 400) {
              Alert.alert(
                "Payment Error",
                "Payment page returned an error.",
                [{ text: "Close", onPress: onClose }]
              )
            }
          }}
          onNavigationStateChange={(state) => {
            if (state.url.includes('status=SUCCESS') ||
                state.url.includes('COMPLETED')) {
              onSuccess?.('')
              onClose()
            }
          }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data)
              if (data.status === 'COMPLETED' ||
                  data.event_id === 'TRANSAK_ORDER_SUCCESSFUL') {
                onSuccess?.(data.data?.transactionId || '')
                onClose()
              }
            } catch (e) {}
          }}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 16,
    zIndex: 999,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 20,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  }
})
