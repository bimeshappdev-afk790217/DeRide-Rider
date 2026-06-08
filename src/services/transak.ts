import { Linking } from 'react-native'

const TRANSAK_ENV = process.env.EXPO_PUBLIC_TRANSAK_ENV || 'staging'
const TRANSAK_BASE_URL = TRANSAK_ENV === 'production'
  ? 'https://global.transak.com'
  : 'https://global-stg.transak.com'

export const openTransakOnRamp = async (walletAddress: string) => {
  const url =
    `${TRANSAK_BASE_URL}?` +
    `apiKey=${process.env.EXPO_PUBLIC_TRANSAK_API_KEY}&` +
    `walletAddress=${walletAddress}&` +
    `cryptoCurrencyCode=POL&` +
    `network=polygon&` +
    `defaultFiatAmount=10&` +
    `disableWalletAddressForm=true`
  await Linking.openURL(url)
}

export const openTransakOffRamp = async (walletAddress: string) => {
  const url =
    `${TRANSAK_BASE_URL}?` +
    `apiKey=${process.env.EXPO_PUBLIC_TRANSAK_API_KEY}&` +
    `walletAddress=${walletAddress}&` +
    `cryptoCurrencyCode=POL&` +
    `network=polygon&` +
    `productsAvailed=SELL&` +
    `disableWalletAddressForm=true`
  await Linking.openURL(url)
}
