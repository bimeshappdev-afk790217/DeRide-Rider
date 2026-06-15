/**
 * RA-B16: Rider ride history tests — local self-recording model
 */

jest.mock('../../src/services/currencyService', () => ({
  fetchForexRates: jest.fn().mockResolvedValue({ USD: 1.0 }),
  polToLocal: (pol: number, polUsd: number, rate: number) => pol * polUsd * rate,
  formatLocal: (amount: number, _code: string) => `$${amount.toFixed(2)}`,
  _resetForexCache: jest.fn(),
}));

jest.mock('../../src/services/chainlinkOracle', () => ({
  getPolUsdFromOracle: jest.fn().mockResolvedValue(0.5), // 1 POL = $0.50
}));

jest.mock('../../src/services/rideHistoryService', () => ({
  getLocalRideHistory: jest.fn(),
  saveRideRecord: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RideHistoryScreen } from '../../src/screens/RideHistoryScreen';
import * as rideHistorySvc from '../../src/services/rideHistoryService';
import { LocalRideRecord } from '../../src/services/rideHistoryService';

const mockGetLocalRideHistory = rideHistorySvc.getLocalRideHistory as jest.Mock;

const NAV        = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
const RIDER_ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DRIVER_ADDR= '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW        = Math.floor(Date.now() / 1000);

const makeRecord = (
  n: number,
  status: 5 | 6 = 5,
  fareWei = '1000000000000000000', // 1 POL
  timestamp = NOW - n * 3600,
  offerMultiplier = 100,
): LocalRideRecord => ({
  rideId:          '0x' + String(n).padStart(64, '0'),
  timestamp,
  fareWei,
  status,
  counterparty:    DRIVER_ADDR,
  offerMultiplier,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
  mockGetLocalRideHistory.mockResolvedValue([]);
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
    if (k === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (k === 'app_currency') return Promise.resolve('USD');
    return Promise.resolve(null);
  });
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE;
});

// ── RA-B16-001 ─────────────────────────────────────────────────────────────────
test('RA-B16-001: reads from getLocalRideHistory (no chain scan)', async () => {
  mockGetLocalRideHistory.mockResolvedValue([makeRecord(1)]);
  await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(mockGetLocalRideHistory).toHaveBeenCalledTimes(1), { timeout: 4000 });
});

// ── RA-B16-002 ─────────────────────────────────────────────────────────────────
test('RA-B16-002: Completed shows "Completed" badge; Cancelled shows "Cancelled" badge', async () => {
  mockGetLocalRideHistory.mockResolvedValue([
    makeRecord(1, 5),
    makeRecord(2, 6),
  ]);
  const { getAllByText } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => {
    expect(getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Cancelled').length).toBeGreaterThanOrEqual(1);
  }, { timeout: 4000 });
});

// ── RA-B16-003 ─────────────────────────────────────────────────────────────────
test('RA-B16-003: records displayed newest-first (service order preserved)', async () => {
  mockGetLocalRideHistory.mockResolvedValue([
    makeRecord(1, 5, '2000000000000000000', NOW - 3600),  // newer, 2 POL → $1.00
    makeRecord(2, 5, '1000000000000000000', NOW - 7200),  // older, 1 POL → $0.50
  ]);
  const { getAllByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getAllByTestId(/^history-item-/).length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
  const items = getAllByTestId(/^history-item-/);
  expect(within(items[0]).getAllByText('$1.00').length).toBeGreaterThan(0); // 2 POL × $0.50 = $1.00
});

// ── RA-B16-004a ────────────────────────────────────────────────────────────────
test('RA-B16-004a: PAGE_SIZE=4 shows first 4 of 6 rides; load-more reveals the rest', async () => {
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
  mockGetLocalRideHistory.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => makeRecord(i + 1, 5, '1000000000000000000', NOW - (i + 1) * 600)),
  );
  const { getByTestId, queryByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-0')).toBeTruthy(), { timeout: 4000 });
  expect(getByTestId('history-item-3')).toBeTruthy();
  expect(queryByTestId('history-item-4')).toBeNull();
  expect(getByTestId('load-more-btn')).toBeTruthy();

  fireEvent.press(getByTestId('load-more-btn'));
  await waitFor(() => expect(getByTestId('history-item-4')).toBeTruthy(), { timeout: 2000 });
  expect(getByTestId('history-item-5')).toBeTruthy();
});

// ── RA-B16-004b ────────────────────────────────────────────────────────────────
test('RA-B16-004b: PAGE_SIZE=10 shows all 6 rides without load-more', async () => {
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '10';
  mockGetLocalRideHistory.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => makeRecord(i + 1, 5, '1000000000000000000', NOW - (i + 1) * 600)),
  );
  const { getByTestId, queryByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-5')).toBeTruthy(), { timeout: 4000 });
  expect(queryByTestId('load-more-btn')).toBeNull();
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
});

// ── RA-B16-005 ─────────────────────────────────────────────────────────────────
test('RA-B16-005: fare display from fareWei — 1 POL at $0.50 shows $0.50', async () => {
  mockGetLocalRideHistory.mockResolvedValue([
    makeRecord(1, 5, '1000000000000000000'), // 1 POL
  ]);
  const { getByTestId, getAllByText } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-0')).toBeTruthy(), { timeout: 4000 });
  expect(getByTestId('fare-local-hero')).toBeTruthy();
  expect(getAllByText('$0.50').length).toBeGreaterThanOrEqual(1);
  expect(getAllByText('1.0000 POL').length).toBeGreaterThanOrEqual(1);
  expect(getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
});

// ── RA-B16-006 ─────────────────────────────────────────────────────────────────
test('RA-B16-006: empty state shows PolygonScan link with rider address', async () => {
  mockGetLocalRideHistory.mockResolvedValue([]);
  const { getByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('empty-state')).toBeTruthy(), { timeout: 4000 });
  expect(getByTestId('polygonscan-link')).toBeTruthy();
});
