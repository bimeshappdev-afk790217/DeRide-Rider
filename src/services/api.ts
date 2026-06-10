import { ethers } from "ethers";
import * as Crypto from "expo-crypto";

const ALCHEMY_URL   = process.env.EXPO_PUBLIC_ALCHEMY_URL         ?? "";
const MESSAGE_RELAY = process.env.EXPO_PUBLIC_MESSAGE_RELAY_ADDRESS ?? "";

const RELAY_ABI = [
  "function postMessage(address to, bytes calldata data) external",
  "function hasMessage(address wallet) external view returns (bool exists, bool expired)",
  "function getMessage(address wallet) external view returns (address from, bytes memory data, uint256 timestamp, bool expired)",
  "function clearMessage() external",
];

export async function generateRideId(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  return "0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function postRideRequest(
  driverWallet:    string,
  riderWallet:     string,
  privateKey:      string,
  pickupLat:       number,
  pickupLng:       number,
  destLat:         number,
  destLng:         number,
  fareUSD:         number,
  offerMultiplier: number,
  rideId?:         string,
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
  const signer   = new ethers.Wallet(privateKey, provider);
  const relay    = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, signer);

  if (!rideId) {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    rideId = "0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const msg    = JSON.stringify({
    type: "RIDE_REQUEST",
    rideId,
    rider:     riderWallet,
    pickupLat, pickupLng, destLat, destLng,
    fareUSD,
    offerMultiplier,
  });

  const nonce        = await provider.getTransactionCount(signer.address, "pending");
  const feeData      = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas! * 130n / 100n;

  const tx = await relay.postMessage(driverWallet, ethers.toUtf8Bytes(msg), { nonce, maxFeePerGas });
  await tx.wait();
  return rideId;
}

export async function clearRelayMessage(privateKey: string): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
    const signer   = new ethers.Wallet(privateKey, provider);
    const relay    = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, signer);
    const [exists] = await relay.hasMessage(await signer.getAddress());
    if (!exists) return;
    const tx = await relay.clearMessage({ gasLimit: 100_000 });
    await tx.wait();
    console.log("[RELAY] clearMessage confirmed");
  } catch (e: any) {
    console.warn("[RELAY] clearMessage failed:", e.message);
  }
}

export async function pollForAcceptance(myWallet: string, privateKey?: string): Promise<{ rideId: string } | null> {
  try {
    const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
    const relay    = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, provider);
    const [exists, expired] = await relay.hasMessage(myWallet);
    if (!exists || expired) return null;
    const [, dataBytes, timestamp] = await relay.getMessage(myWallet);
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (ageSeconds > 300) {
      console.log("[RELAY] Acceptance message stale (" + ageSeconds + "s old) — clearing");
      if (privateKey) clearRelayMessage(privateKey);
      return null;
    }
    const msg = JSON.parse(ethers.toUtf8String(dataBytes));
    if (msg.type !== "RIDE_ACCEPT") {
      if (privateKey) clearRelayMessage(privateKey);
      return null;
    }
    return { rideId: msg.rideId };
  } catch {
    return null;
  }
}
