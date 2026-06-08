import { WebView } from 'react-native-webview'
import { Modal, View, TouchableOpacity, Text, StyleSheet } from 'react-native'

export default function TransakWebView({
  url,
  onClose,
  onSuccess
}: {
  url: string
  onClose: () => void
  onSuccess?: (txId: string) => void
}) {
  return (
    <Modal visible={true} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>✕ Close</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Add Money</Text>
          <View style={{ width: 60 }} />
        </View>
        <WebView
          source={{ uri: url }}
          sharedCookiesEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          onNavigationStateChange={(state) => {
            if (
              state.url.includes('transak.com/order') ||
              state.url.includes('status=SUCCESS') ||
              state.url.includes('COMPLETED')
            ) {
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
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#111',
  },
  close: { color: 'white', fontSize: 16, width: 60 },
  title: { color: 'white', fontSize: 16, fontWeight: 'bold' },
})
