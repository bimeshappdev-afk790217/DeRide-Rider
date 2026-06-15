/**
 * RA-B16: Rider ride history tests — AsyncStorage-based (no eth_getLogs)
 */

const mockGetRide = jest.fn();

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const ContractMock = jest.fn(() => ({ getRide: mockGetRide }));
  const ProviderMock = jest.fn(() => ({}));
  const ns = { ...actual.ethers, Contract: ContractMock, JsonRpcProvider: ProviderMock };
  return { ...actual, ethers: ns, Contract: ContractMock, JsonRpcProvider: ProviderMock };
});

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
  getStoredRideIds: jest.fn(),
  addRideToHistory: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RideHistoryScreen } from '../../src/screens/RideHistoryScreen';
import * as rideHistorySvc from '../../src/services/rideHistoryService';

const mockGetStoredRideIds = rideHistorySvc.getStoredRideIds as jest.Mock;

const NAV        = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
const RIDER_ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DRIVER_ADDR= '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW        = Math.floor(Date.now() / 1000);

// 19-element array matching the RideEscrow Ride struct
const makeFakeRide = (
  status: number,
  createdAt: number,
  fare = BigInt('1000000000000000000'), // 1 POL
  offerMultiplier = 100,
) => [
  RIDER_ADDR,                      // 0: rider
  DRIVER_ADDR,                     // 1: driver
  '0x' + '0'.repeat(40),           // 2: nodeAddress
  '0x' + '0'.repeat(40),           // 3: arbitrator
  fare,                            // 4: fare
  '0x' + '0'.repeat(64),           // 5: pinHash
  '0x' + '0'.repeat(64),           // 6: routeHash
  '0x' + '0'.repeat(64),           // 7: riderRouteHash
  0n,                              // 8: distanceKm
  0n,                              // 9: durationSecs
  BigInt(status),                  // 10: status
  BigInt(createdAt),               // 11: createdAt
  0n, 0n, 0n, 0n, 0n,             // 12-16
  BigInt(offerMultiplier),         // 17: offerMultiplier
  '0x' + '0'.repeat(40),           // 18: rideVerifier
];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
  mockGetStoredRideIds.mockResolvedValue([]);
  mockGetRide.mockResolvedValue(makeFakeRide(5, NOW - 3600));
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
test('RA-B16-001: reads ride IDs from rideHistoryService (AsyncStorage), not eth_getLogs', async () => {
  mockGetStoredRideIds.mockResolvedValue(['0x' + '1'.repeat(64)]);
  await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(mockGetStoredRideIds).toHaveBeenCalled(), { timeout: 4000 });
  expect(mockGetRide).toHaveBeenCalledWith('0x' + '1'.repeat(64));
});

// ── RA-B16-002 ─────────────────────────────────────────────────────────────────
test('RA-B16-002: only Completed (5) and Cancelled (6) rides shown; in-progress excluded', async () => {
  const rideCompleted  = '0x' + '1'.repeat(64);
  const rideCancelled  = '0x' + '2'.repeat(64);
  const rideInProgress = '0x' + '3'.repeat(64);

  mockGetStoredRideIds.mockResolvedValue([rideCompleted, rideCancelled, rideInProgress]);
  mockGetRide
    .mockResolvedValueOnce(makeFakeRide(5, NOW - 3600)) // Completed
    .mockResolvedValueOnce(makeFakeRide(6, NOW - 7200)) // Cancelled
    .mockResolvedValueOnce(makeFakeRide(1, NOW - 1800)); // InProgress — excluded

  const { getByTestId, queryByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-0')).toBeTruthy(), { timeout: 4000 });
  expect(getByTestId('history-item-1')).toBeTruthy();
  expect(queryByTestId('history-item-2')).toBeNull(); // in-progress excluded
});

// ── RA-B16-003 ─────────────────────────────────────────────────────────────────
test('RA-B16-003: rides displayed newest-first regardless of storage order', async () => {
  const olderRideId = '0x' + '1'.repeat(64);
  const newerRideId = '0x' + '2'.repeat(64);

  // Older stored first (storage order shouldn't matter)
  mockGetStoredRideIds.mockResolvedValue([olderRideId, newerRideId]);
  mockGetRide
    .mockResolvedValueOnce(makeFakeRide(5, NOW - 7200, BigInt('1000000000000000000')))  // older, 1 POL
    .mockResolvedValueOnce(makeFakeRide(5, NOW - 3600, BigInt('2000000000000000000'))); // newer, 2 POL

  const { getAllByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getAllByTestId(/^history-item-/).length).toBeGreaterThanOrEqual(2), { timeout: 4000 });

  // Newer ride (2 POL × $0.50 = $1.00) should be at index 0
  // $1.00 appears in both Fare and You paid columns for completed rides
  const items = getAllByTestId(/^history-item-/);
  expect(within(items[0]).getAllByText('$1.00').length).toBeGreaterThan(0);
});

// ── RA-B16-004 ─────────────────────────────────────────────────────────────────
test('RA-B16-004a: PAGE_SIZE=4 shows first 4 of 6 rides; load-more reveals the rest', async () => {
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
  const rideIds = Array.from({ length: 6 }, (_, i) => '0x' + String(i + 1).padStart(64, '0'));
  mockGetStoredRideIds.mockResolvedValue(rideIds);
  rideIds.forEach((_, i) => {
    mockGetRide.mockResolvedValueOnce(makeFakeRide(5, NOW - (i + 1) * 600));
  });

  const { getByTestId, queryByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-0')).toBeTruthy(), { timeout: 4000 });
  expect(getByTestId('history-item-3')).toBeTruthy();
  expect(queryByTestId('history-item-4')).toBeNull();
  expect(getByTestId('load-more-btn')).toBeTruthy();

  fireEvent.press(getByTestId('load-more-btn'));
  await waitFor(() => expect(getByTestId('history-item-4')).toBeTruthy(), { timeout: 2000 });
  expect(getByTestId('history-item-5')).toBeTruthy();
});

test('RA-B16-004b: PAGE_SIZE=10 shows all 6 rides without a load-more button', async () => {
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '10';
  const rideIds = Array.from({ length: 6 }, (_, i) => '0x' + String(i + 1).padStart(64, '0'));
  mockGetStoredRideIds.mockResolvedValue(rideIds);
  rideIds.forEach((_, i) => {
    mockGetRide.mockResolvedValueOnce(makeFakeRide(5, NOW - (i + 1) * 600));
  });

  const { getByTestId, queryByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-5')).toBeTruthy(), { timeout: 4000 });
  expect(queryByTestId('load-more-btn')).toBeNull();
  process.env.EXPO_PUBLIC_HISTORY_PAGE_SIZE = '4';
});

// ── RA-B16-005 ─────────────────────────────────────────────────────────────────
test('RA-B16-005: per-ride card shows local value as fare hero + POL muted; "Completed" status', async () => {
  // 1 POL fare: polUsdRate=0.5, forexRate=1.0 → $0.50
  mockGetStoredRideIds.mockResolvedValue(['0x' + '1'.repeat(64)]);
  mockGetRide.mockResolvedValue(makeFakeRide(5, NOW - 3600, BigInt('1000000000000000000')));

  const { getByTestId, getAllByText } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('history-item-0')).toBeTruthy(), { timeout: 4000 });

  expect(getByTestId('fare-local-hero')).toBeTruthy();
  // $0.50 appears in Fare + You paid columns
  expect(getAllByText('$0.50').length).toBeGreaterThanOrEqual(1);
  expect(getAllByText('1.0000 POL').length).toBeGreaterThanOrEqual(1);
  expect(getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
});

// ── RA-B16-006 ─────────────────────────────────────────────────────────────────
test('RA-B16-006: empty state rendered when no stored ride IDs', async () => {
  mockGetStoredRideIds.mockResolvedValue([]);
  const { getByTestId } = await render(<RideHistoryScreen navigation={NAV} />);
  await waitFor(() => expect(getByTestId('empty-state')).toBeTruthy(), { timeout: 4000 });
});
