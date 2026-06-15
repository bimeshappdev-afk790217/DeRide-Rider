// Set EXPO_PUBLIC_* env vars before any module is loaded
process.env.EXPO_PUBLIC_ALCHEMY_URL                = 'https://mock-alchemy-url';
process.env.EXPO_PUBLIC_RIDE_ESCROW_ADDRESS         = '0x0000000000000000000000000000000000000001';
process.env.EXPO_PUBLIC_DRIVER_AVAILABILITY_ADDRESS  = '0x0000000000000000000000000000000000000005';
process.env.EXPO_PUBLIC_NODE_REGISTRY_ADDRESS        = '0x0000000000000000000000000000000000000004';
process.env.EXPO_PUBLIC_MESSAGE_RELAY_ADDRESS        = '0x0000000000000000000000000000000000000006';

import 'react-native';

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Location
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 39.7589, longitude: -84.1916, accuracy: 5, timestamp: Date.now() },
    timestamp: Date.now(),
  })),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  Accuracy: { High: 5, Balanced: 3 },
}));

// Expo Crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(() => Promise.resolve(new Uint8Array(32).fill(1))),
}));

// Expo Updates
jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(() => Promise.resolve()),
  reloadAsync: jest.fn(() => Promise.resolve()),
}));

// Expo Notifications
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Expo Device
jest.mock('expo-device', () => ({
  isDevice: false,
}));

// Expo Localization
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', regionCode: 'US' }]),
}));

// Expo Web Browser
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve()),
}));

// ThemeContext
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: '#000',
      surface: '#111',
      surfaceAlt: '#1a1a1a',
      text: '#fff',
      textSub: '#aaa',
      textMuted: '#666',
      border: '#333',
    },
    isDark: true,
  }),
}));

// api service mock
jest.mock('../src/services/api', () => ({
  postRideRequest: jest.fn(() => Promise.resolve('0x' + '1'.repeat(64))),
  pollForAcceptance: jest.fn(() => Promise.resolve(null)),
  clearRelayMessage: jest.fn(() => Promise.resolve()),
  generateRideId: jest.fn(() => Promise.resolve('0x' + '1'.repeat(64))),
}));

// transak service mock
jest.mock('../src/services/transak', () => ({
  getTransakOnRampUrl: jest.fn((addr: string) =>
    `https://global.transak.com/?cryptoCurrencyCode=MATIC&walletAddress=${addr}`
  ),
  getTransakOffRampUrl: jest.fn((addr: string) =>
    `https://global.transak.com/?type=SELL&walletAddress=${addr}`
  ),
}));

// WebRTCGPS
jest.mock('../src/services/WebRTCGPS', () => ({
  WebRTCGPSAnswerer: jest.fn().mockImplementation(() => ({
    onGPSUpdate: null,
    onConnected: null,
    onDisconnected: null,
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(),
  })),
}));

// TransakWebView component
jest.mock('../src/components/TransakWebView', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({ onClose, onSuccess }: any) =>
      React.createElement(View, { testID: 'transak-webview' },
        React.createElement(TouchableOpacity, { testID: 'transak-close', onPress: onClose },
          React.createElement(Text, null, 'Close')
        ),
        React.createElement(TouchableOpacity, { testID: 'transak-success', onPress: onSuccess },
          React.createElement(Text, null, 'Success')
        ),
      ),
  };
});

// MapView — use forwardRef so mapRef.current gets an object with fitToCoordinates.
// mockMapRefMethods is exposed on global so individual tests can make fitToCoordinates throw.
(global as any).mockMapRefMethods = {
  fitToCoordinates: jest.fn(),
  animateToRegion: jest.fn(),
  fitToElements: jest.fn(),
};
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => (global as any).mockMapRefMethods);
    return React.createElement(View, { testID: 'map-view', ...props });
  });
  MockMapView.displayName = 'MockMapView';
  MockMapView.Marker   = (props: any) => React.createElement(View, { testID: props.title || 'marker', ...props });
  MockMapView.Polyline = (props: any) => React.createElement(View, { testID: 'polyline', ...props });
  const MockUrlTile    = (props: any) => React.createElement(View, { testID: props.testID || 'url-tile', ...props });
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMapView.Marker,
    Polyline: MockMapView.Polyline,
    MapUrlTile: MockUrlTile,
    UrlTile: MockUrlTile,
    PROVIDER_GOOGLE: 'google',
    PROVIDER_DEFAULT: undefined,
  };
});

// react-native-webrtc
jest.mock('react-native-webrtc', () => ({}));

// react-native-get-random-values
jest.mock('react-native-get-random-values', () => ({}));

// Global fetch mock — can be overridden per-test
(global as any).fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
);

// Global WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({ code: 1000, reason: '' }); }
  simulateOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  simulateMessage(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  simulateError() { this.onerror?.(new Error('connection failed')); }
}
(global as any).WebSocket = MockWebSocket;
(global as any).MockWebSocket = MockWebSocket;

// Alert mock — react-native 0.81
const mockAlert = {
  alert: jest.fn(),
  prompt: jest.fn(),
};
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  __esModule: true,
  default: mockAlert,
}));
(global as any).mockAlert = mockAlert;
