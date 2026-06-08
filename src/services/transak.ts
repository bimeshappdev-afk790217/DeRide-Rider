import { Linking } from "react-native";

const TRANSAK_API_KEY = process.env.EXPO_PUBLIC_TRANSAK_API_KEY;

export const openTransakOnRamp = async (walletAddress: string) => {
  const url =
    `https://global.transak.com?` +
    `apiKey=${TRANSAK_API_KEY}&` +
    `walletAddress=${walletAddress}&` +
    `cryptoCurrencyCode=POL&` +
    `network=polygon&` +
    `defaultFiatAmount=10&` +
    `fiatCurrency=INR&` +
    `disableWalletAddressForm=true`;
  await Linking.openURL(url);
};

export const openTransakOffRamp = async (walletAddress: string) => {
  const url =
    `https://global.transak.com?` +
    `apiKey=${TRANSAK_API_KEY}&` +
    `walletAddress=${walletAddress}&` +
    `cryptoCurrencyCode=POL&` +
    `network=polygon&` +
    `productsAvailed=SELL&` +
    `fiatCurrency=INR&` +
    `disableWalletAddressForm=true`;
  await Linking.openURL(url);
};
