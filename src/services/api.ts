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
  fareWei:         string,
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
  const msg = JSON.stringify({
    type: "RIDE_REQUEST",
    rideId,
    rider:     riderWallet,
    pickupLat, pickupLng, destLat, destLng,
    fareUSD,
    fareWei,
    offerMultiplier,
  });

  // Retry up to 3 times on REPLACEMENT_UNDERPRICED, bumping gas 20 % each round.
  // Base is 150 % of suggested maxFeePerGas (not 130 %) so the tx beats any same-
  // nonce tx whose auto-pricing used the default 130 % multiplier.
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const nonce   = await provider.getTransactionCount(signer.address, "pending");
      const feeData = await provider.getFeeData();
      const bump    = 150n + BigInt(attempt * 20); // 150 %, 170 %, 190 %
      const maxFeePerGas         = feeData.maxFeePerGas!          * bump / 100n;
      const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas ?? 30_000_000_000n) * bump / 100n;

      const tx = await relay.postMessage(
        driverWallet,
        ethers.toUtf8Bytes(msg),
        { nonce, maxFeePerGas, maxPriorityFeePerGas },
      );
      await tx.wait();
      return rideId;
    } catch (e: any) {
      lastError = e;
      const isReplacement = e?.code === "REPLACEMENT_UNDERPRICED"
        || (e?.message ?? "").toLowerCase().includes("replacement");
      if (isReplacement && attempt < 2) {
        console.warn(`[RELAY] REPLACEMENT_UNDERPRICED (attempt ${attempt + 1}) — bumping gas and retrying`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export async function clearRelayMessage(privateKey: string): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);
    const signer   = new ethers.Wallet(privateKey, provider);
    const relay    = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, signer);
    const [exists] = await relay.hasMessage(await signer.getAddress());
    // Only skip if there is literally nothing in the slot (timestamp == 0).
    // Expired messages still occupy the slot and should be cleared — the contract
    // clearMessage() has no require checks, so this never reverts.
    if (!exists) return;
    const feeData      = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas! * 150n / 100n;
    const tx = await relay.clearMessage({ gasLimit: 300_000, maxFeePerGas });
    await tx.wait();
    console.log("[RELAY] clearMessage confirmed");
  } catch (e: any) {
    console.warn("[RELAY] clearMessage failed:", e.message);
  }
}

export async function pollForAcceptance(myWallet: string, privateKey?: string): Promise<{
  rideId: string;
  committedFareWei?: string;
  driverSig?: string;
  declined?: boolean;
} | null> {
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
    if (msg.type === "RIDE_DECLINED") {
      console.log("[RELAY] Driver declined ride:", msg.rideId?.slice(0, 10));
      if (privateKey) clearRelayMessage(privateKey);
      return { rideId: msg.rideId, declined: true };
    }
    if (msg.type !== "RIDE_ACCEPT") {
      if (privateKey) clearRelayMessage(privateKey);
      return null;
    }
    return {
      rideId:           msg.rideId,
      committedFareWei: msg.committedFareWei,
      driverSig:        msg.driverSig,
    };
  } catch {
    return null;
  }
}
