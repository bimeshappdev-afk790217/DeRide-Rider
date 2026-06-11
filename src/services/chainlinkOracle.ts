import { ethers } from "ethers";

const CHAINLINK_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0"; // MATIC/USD on Polygon mainnet
const FEED_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const STALENESS_MS = 2 * 60 * 60 * 1000; // 2h — heartbeat is ~1h, >2h means feed is stuck
const CACHE_TTL_MS = 5 * 60 * 1000;       // re-query the chain every 5 min
const FALLBACK_USD = 0.50;                 // matches polPrice.ts fallback

let cachedPrice: number = FALLBACK_USD;
let cacheTime:   number = 0;

// Reads POL/USD from the on-chain Chainlink feed via the Alchemy RPC.
// Never returns null. Falls back to the last good cached price, then $0.50.
export async function getPolUsdFromOracle(): Promise<number> {
  if (cacheTime > 0 && Date.now() - cacheTime < CACHE_TTL_MS) return cachedPrice;

  const alchemyUrl = process.env.EXPO_PUBLIC_ALCHEMY_URL ?? "";
  try {
    const provider = new ethers.JsonRpcProvider(alchemyUrl);
    const feed     = new ethers.Contract(CHAINLINK_FEED, FEED_ABI, provider);
    const [, answer, , updatedAt] = await feed.latestRoundData();

    const staleMs = Date.now() - Number(updatedAt) * 1000;
    if (staleMs > STALENESS_MS) {
      console.warn(`[ORACLE] Chainlink price stale (${Math.round(staleMs / 60000)}min) — using cached $${cachedPrice.toFixed(4)}`);
      return cachedPrice;
    }

    const price = Number(answer) / 1e8;
    if (price > 0) {
      cachedPrice = price;
      cacheTime   = Date.now();
      console.log(`[ORACLE] POL/USD: $${price.toFixed(4)} (Chainlink)`);
    }
    return price > 0 ? price : cachedPrice;
  } catch (e: any) {
    console.warn("[ORACLE] Chainlink read failed — using cached/fallback:", e?.message ?? e);
    return cachedPrice;
  }
}

// Pure-function fare verification. Returns true when the rider's committedFareWei
// is within tolerancePct% of what the driver expects from their session rate.
// Returns true (skip) when session rate or price is unknown — can't verify.
export function verifyFareWei(
  fareWei:         string,
  sessionRateCPM:  number,  // driver's on-chain cents/mile (sessionRateCentsPerMile)
  distMi:          number,
  offerMultiplier: number,  // 100 = 1×, 125 = 1.25×, …
  polPriceUsd:     number,
  tolerancePct:    number = 1,
): boolean {
  if (sessionRateCPM <= 0 || polPriceUsd <= 0) return true;
  const expectedUSD = (sessionRateCPM / 100) * distMi * (offerMultiplier / 100);
  const expectedWei = BigInt(Math.round((expectedUSD / polPriceUsd) * 1e18));
  const riderWei    = BigInt(fareWei);
  const lower = expectedWei * BigInt(100 - tolerancePct) / 100n;
  const upper = expectedWei * BigInt(100 + tolerancePct) / 100n;
  return riderWei >= lower && riderWei <= upper;
}

export function _resetCacheForTest(): void {
  cachedPrice = FALLBACK_USD;
  cacheTime   = 0;
}
