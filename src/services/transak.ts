import { Linking } from 'react-native'
import { getLocales } from 'expo-localization'

const TRANSAK_ENV = process.env.EXPO_PUBLIC_TRANSAK_ENV || 'staging'
const TRANSAK_BASE_URL = TRANSAK_ENV === 'production'
  ? 'https://global.transak.com'
  : 'https://global-stg.transak.com'

const getLocalCurrency = (): string => {
  const locale = getLocales()[0]
  const currencyMap: Record<string, string> = {
    'IN': 'INR',
    'US': 'USD',
    'GB': 'GBP',
    'EU': 'EUR',
    'AU': 'AUD',
    'CA': 'CAD',
    'SG': 'SGD',
    'AE': 'AED',
  }
  const country = locale.regionCode || 'US'
  return currencyMap[country] || 'USD'
}

export const openTransakOnRamp = async (walletAddress: string) => {
  const url =
    `${TRANSAK_BASE_URL}?` +
    `apiKey=${process.env.EXPO_PUBLIC_TRANSAK_API_KEY}&` +
    `walletAddress=${walletAddress}&` +
    `cryptoCurrencyCode=POL&` +
    `network=polygon&` +
    `defaultFiatAmount=10&` +
    `fiatCurrency=${getLocalCurrency()}&` +
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
    `fiatCurrency=${getLocalCurrency()}&` +
    `disableWalletAddressForm=true`
  await Linking.openURL(url)
}
