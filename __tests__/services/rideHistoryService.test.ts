/**
 * SVC-RH: rideHistoryService unit tests (local self-recording model)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveRideRecord, getLocalRideHistory, LocalRideRecord } from '../../src/services/rideHistoryService';

const makeRecord = (n: number, status: 5 | 6 = 5): LocalRideRecord => ({
  rideId:          '0x' + String(n).padStart(64, '0'),
  timestamp:       1_000_000 + n,
  fareWei:         String(BigInt(n) * BigInt(1e18)),
  status,
  counterparty:    '0x' + 'a'.repeat(40),
  offerMultiplier: 100,
});

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

// ── SVC-RH-001 ─────────────────────────────────────────────────────────────────
test('SVC-RH-001: saveRideRecord persists the record to AsyncStorage', async () => {
  const rec = makeRecord(1);
  await saveRideRecord(rec);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'ride_history_records',
    JSON.stringify([rec]),
  );
});

// ── SVC-RH-002 ─────────────────────────────────────────────────────────────────
test('SVC-RH-002: getLocalRideHistory returns [] when storage is empty', async () => {
  const result = await getLocalRideHistory();
  expect(result).toEqual([]);
});

// ── SVC-RH-003 ─────────────────────────────────────────────────────────────────
test('SVC-RH-003: getLocalRideHistory returns stored records', async () => {
  const records = [makeRecord(2), makeRecord(1)];
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(records));
  const result = await getLocalRideHistory();
  expect(result).toEqual(records);
});

// ── SVC-RH-004 ─────────────────────────────────────────────────────────────────
test('SVC-RH-004: saveRideRecord prepends — newest first', async () => {
  const rec1 = makeRecord(1);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([rec1]));
  const rec2 = makeRecord(2);
  await saveRideRecord(rec2);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'ride_history_records',
    JSON.stringify([rec2, rec1]),
  );
});

// ── SVC-RH-005 ─────────────────────────────────────────────────────────────────
test('SVC-RH-005: dedup — same rideId not stored twice (first-write wins)', async () => {
  const rec = makeRecord(1);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([rec]));
  await saveRideRecord({ ...rec, txHash: '0xabc' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

// ── SVC-RH-006 ─────────────────────────────────────────────────────────────────
test('SVC-RH-006: cap trims to EXPO_PUBLIC_HISTORY_CACHE_CAP (keeps newest)', async () => {
  process.env.EXPO_PUBLIC_HISTORY_CACHE_CAP = '3';
  const existing = [makeRecord(3), makeRecord(2), makeRecord(1)];
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existing));
  const rec4 = makeRecord(4);
  await saveRideRecord(rec4);
  const saved: LocalRideRecord[] = JSON.parse(
    (AsyncStorage.setItem as jest.Mock).mock.calls[0][1],
  );
  expect(saved).toHaveLength(3);
  expect(saved[0].rideId).toBe(rec4.rideId);
  delete process.env.EXPO_PUBLIC_HISTORY_CACHE_CAP;
});

// ── SVC-RH-007 ─────────────────────────────────────────────────────────────────
test('SVC-RH-007: Cancelled ride (status=6) is stored correctly', async () => {
  const rec = makeRecord(1, 6);
  await saveRideRecord(rec);
  const saved: LocalRideRecord[] = JSON.parse(
    (AsyncStorage.setItem as jest.Mock).mock.calls[0][1],
  );
  expect(saved[0].status).toBe(6);
});

// ── SVC-RH-008 ─────────────────────────────────────────────────────────────────
test('SVC-RH-008: optional txHash is preserved when provided', async () => {
  const rec = makeRecord(1);
  const recWithHash = { ...rec, txHash: '0xdeadbeef' };
  await saveRideRecord(recWithHash);
  const saved: LocalRideRecord[] = JSON.parse(
    (AsyncStorage.setItem as jest.Mock).mock.calls[0][1],
  );
  expect(saved[0].txHash).toBe('0xdeadbeef');
});
