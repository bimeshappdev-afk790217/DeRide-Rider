import AsyncStorage from "@react-native-async-storage/async-storage";
import { ethers } from "ethers";

const HISTORY_KEY = "ride_history_ids";
const MAX_STORED  = 200;

// PublicNode: free, no key, 10k-block range, history from ~88470000
const PUBLICNODE_URL  = "https://polygon-bor-rpc.publicnode.com";
const LOG_CHUNK       = 10_000;
const RIDE_CREATED_SIG = "RideCreated(bytes32,address,address,uint256)";
const TOPIC0 = ethers.id(RIDE_CREATED_SIG);

/** Call when a ride reaches a terminal state (Completed or Cancelled). */
export async function addRideToHistory(rideId: string): Promise<void> {
  try {
    const raw   = await AsyncStorage.getItem(HISTORY_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(rideId)) {
      await AsyncStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([rideId, ...ids].slice(0, MAX_STORED))
      );
    }
  } catch {}
}

/** Returns locally-stored rideIds (AsyncStorage cache), newest first. */
export async function getStoredRideIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Scans on-chain RideCreated events for the given wallet.
 * role "driver" filters topic[3]; role "rider" filters topic[2].
 * Newly discovered IDs are written back to AsyncStorage for caching.
 */
export async function scanChainForRideIds(
  walletAddr: string,
  role: "driver" | "rider",
  escrowAddr: string,
  startBlock: number,
): Promise<string[]> {
  try {
    const provider = new ethers.JsonRpcProvider(PUBLICNODE_URL);
    const latest   = Number(await provider.getBlockNumber());
    const padded   = "0x" + walletAddr.toLowerCase().slice(2).padStart(64, "0");

    // topic[1]=rideId, topic[2]=rider, topic[3]=driver
    const topics = role === "driver"
      ? [TOPIC0, null, null, padded]
      : [TOPIC0, null, padded, null];

    const rideIds: string[] = [];
    for (let from = startBlock; from <= latest; from += LOG_CHUNK) {
      const to = Math.min(from + LOG_CHUNK - 1, latest);
      try {
        const logs = await provider.getLogs({
          address: escrowAddr, topics, fromBlock: from, toBlock: to,
        });
        for (const log of logs) rideIds.push(log.topics[1]);
      } catch {}
    }

    // Cache newly found IDs
    if (rideIds.length > 0) {
      const raw  = await AsyncStorage.getItem(HISTORY_KEY);
      const stored: string[] = raw ? JSON.parse(raw) : [];
      const merged = [...new Set([...rideIds, ...stored])].slice(0, MAX_STORED);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    }

    return rideIds;
  } catch { return []; }
}
