import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "ride_history_ids";
const MAX_STORED  = 200;

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

/** Returns stored rideIds, newest first. */
export async function getStoredRideIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
