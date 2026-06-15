import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "ride_history_records";
const DEFAULT_CAP = 20;

export interface LocalRideRecord {
  rideId:          string;
  txHash?:         string;
  timestamp:       number;
  fareWei:         string;
  status:          5 | 6;
  counterparty:    string;
  offerMultiplier: number;
}

/** Saves a completed/cancelled ride. Skips silently if rideId already stored (first-write wins). */
export async function saveRideRecord(record: LocalRideRecord): Promise<void> {
  try {
    const cap = parseInt(process.env.EXPO_PUBLIC_HISTORY_CACHE_CAP ?? String(DEFAULT_CAP), 10);
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const records: LocalRideRecord[] = raw ? JSON.parse(raw) : [];
    if (records.some(r => r.rideId === record.rideId)) return;
    await AsyncStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([record, ...records].slice(0, cap)),
    );
  } catch {}
}

/** Returns all locally-stored ride records, newest first. */
export async function getLocalRideHistory(): Promise<LocalRideRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
