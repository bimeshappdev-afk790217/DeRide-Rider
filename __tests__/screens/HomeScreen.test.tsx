/**
 * RA-H: Home Screen Tests (9 tests)
 * RA-DS: Driver Search Tests (12 tests)
 * RA-O: Offer Selection Tests (10 tests)
 * RA-MP: Map Provider Fallback Tests (4 tests)
 * RA-B22: Destination Selection Crash Fix (3 tests)
 */
import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { makeContractMock, makeProviderMock } from '../mocks/blockchain';

// Controllable map-provider mock — lets tests flip HAS_GOOGLE_MAPS_KEY per test.
// 'mock' prefix is required for Jest to allow reference inside the hoisted jest.mock factory.
let mockHasGoogleKey = false;
jest.mock('../../src/services/mapProvider', () => ({
  get HAS_GOOGLE_MAPS_KEY() { return mockHasGoogleKey; },
  OSM_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
}));

const mockContract = makeContractMock();
const mockProvider = makeProviderMock();

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const WalletMock = Object.assign(
    jest.fn((k: string) => ({ address: '0x' + 'a'.repeat(40), privateKey: k, connect: jest.fn().mockReturnThis() })),
    { createRandom: jest.fn() }
  );
  const ContractMock = jest.fn(() => mockContract);
  const ProviderMock = jest.fn(() => mockProvider);
  const ethersNS = {
    ...actual.ethers,
    Contract: ContractMock,
    JsonRpcProvider: ProviderMock,
    Wallet: WalletMock,
    formatEther: actual.formatEther,
    parseEther: actual.parseEther,
    ZeroAddress: actual.ZeroAddress,
    ZeroHash: '0x' + '0'.repeat(64),
    AbiCoder: actual.AbiCoder,
    Interface: actual.Interface,
    keccak256: actual.keccak256,
    toUtf8Bytes: actual.toUtf8Bytes,
    isAddress: actual.isAddress,
  };
  return {
    ...actual,
    ethers: ethersNS,
    Contract: ContractMock,
    JsonRpcProvider: ProviderMock,
    Wallet: WalletMock,
    formatEther: actual.formatEther,
    parseEther: actual.parseEther,
    ZeroAddress: actual.ZeroAddress,
    ZeroHash: '0x' + '0'.repeat(64),
    AbiCoder: actual.AbiCoder,
    Interface: actual.Interface,
    keccak256: actual.keccak256,
    toUtf8Bytes: actual.toUtf8Bytes,
    isAddress: actual.isAddress,
  };
});

import { HomeScreen } from '../../src/screens/HomeScreen';

const NAV = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
const RIDER_ADDR = '0x' + 'a'.repeat(40);

const makeDriver = (overrides: any = {}) => ({
  address: '0xDriver' + 'a'.repeat(35),
  lat: 39.76,
  lng: -84.2,
  vehicle: '2021 Toyota Camry',
  rating: 4.92,
  eta: 4,
  distanceMi: '1.1',
  fareUSD: 3.25,
  etaMinutes: 4,
  distanceKm: 1.8,
  ...overrides,
});

const makeSearchResponse = (drivers: any[], fareUSD = 3.25, distKm = 2.0, offers?: any[]) => ({
  ok: true,
  drivers,
  nodeAddress: '0x' + 'b'.repeat(40),
  fare: {
    estimatedUSD: fareUSD,
    distanceKm: distKm,
    offers: offers ?? [
      { multiplier: 100, label: 'Standard',      fareUSD: fareUSD,         fareWei: '0' },
      { multiplier: 125, label: 'Rush +25%',     fareUSD: fareUSD * 1.25,  fareWei: '0' },
      { multiplier: 150, label: 'Priority +50%', fareUSD: fareUSD * 1.5,   fareWei: '0' },
      { multiplier: 200, label: 'Emergency 2×',  fareUSD: fareUSD * 2.0,   fareWei: '0' },
    ],
  },
});

function setupDefaultMocks() {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(key === 'rider_wallet_address' ? RIDER_ADDR : null)
  );
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('0x' + 'c'.repeat(64));
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: 39.7589, longitude: -84.1916, accuracy: 5, timestamp: Date.now() },
    timestamp: Date.now(),
  });

  // Default fetch: Nominatim reverse geocode + NodeRegistry returns no nodes → fall to hardcoded
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ address: { country_code: 'us' } }),
      });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ routes: [] }),
      });
    }
    // Default matching server response
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ drivers: [] }),
    });
  });

  // NodeRegistry returns no nodes, so it falls back to hardcoded server
  mockContract.getNodes.mockResolvedValue([]);
}

function setupSearchWithDrivers(drivers: any[], fareUSD = 3.25) {
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ address: { country_code: 'us' } }),
      });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ routes: [] }),
      });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeSearchResponse(drivers, fareUSD)),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

async function renderAndSearch(drivers: any[], fareUSD = 3.25) {
  // Use a recent destination so tapping it calls searchDrivers() with lat/lng coords.
  // submitEditing without suggestions has no coords and alerts "Select a destination" instead.
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Destination', address: 'Test Destination, Dayton, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse(drivers, fareUSD)) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const result = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); }); // wait for location + recent dests

  // Tap the recent dest — calls searchDrivers(item.address, { lat: 39.79, lng: -84.22 })
  await act(async () => {
    fireEvent.press(result.getByText('Test Destination'));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); }); // wait for search to complete
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasGoogleKey = false; // default: no Google key → OSM path
  setupDefaultMocks();
});

// ══════════════════════════════════════════════════════════════════
// RA-H: Home Screen Tests
// ══════════════════════════════════════════════════════════════════

// ── RA-H-001 ─────────────────────────────────────────────────────────────────
test('RA-H-001: GPS permission denied → shows location error', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  // Both "⚠ Location disabled" and "Please enable location to find drivers" render simultaneously,
  // so queryByText with a regex matching both would throw "Found multiple elements".
  // Use queryAllByText instead.
  const { queryAllByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await waitFor(() => {
    expect(queryAllByText(/Location disabled|Please enable location/i).length).toBeGreaterThan(0);
  });
});

// ── RA-H-002 ─────────────────────────────────────────────────────────────────
test('RA-H-002: GPS available → shows coordinates in header', async () => {
  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await waitFor(() => {
    // Header shows lat/lng formatted as "39.759°, -84.192°"
    expect(queryByText(/39\.7\d+°/)).toBeTruthy();
  });
});

// ── RA-H-003 ─────────────────────────────────────────────────────────────────
test('RA-H-003: Typing in destination triggers autocomplete', async () => {
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { display_name: 'Dayton Mall, OH', lat: '39.69', lon: '-84.18', name: 'Dayton Mall', address: {} },
        ]),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { getByPlaceholderText, queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter destination'), 'Dayton');
  });
  // Wait for debounce + fetch
  await act(async () => { await new Promise(r => setTimeout(r, 700)); });

  await waitFor(() => {
    expect(queryByText(/Dayton Mall/i)).toBeTruthy();
  });
});

// ── RA-H-004 ─────────────────────────────────────────────────────────────────
test('RA-H-004: Autocomplete call includes country code bias', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  (global as any).fetch = fetchMock;

  const { getByPlaceholderText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 300)); });

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter destination'), 'Airport');
  });
  await act(async () => { await new Promise(r => setTimeout(r, 700)); });

  const searchCall = fetchMock.mock.calls.find((c: string[]) =>
    c[0].includes('nominatim.openstreetmap.org/search')
  );
  expect(searchCall).toBeTruthy();
  expect(searchCall![0]).toContain('countrycodes=us');
});

// ── RA-H-005 ─────────────────────────────────────────────────────────────────
test('RA-H-005: Autocomplete results show distance from rider', async () => {
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { display_name: 'Downtown Dayton', lat: '39.76', lon: '-84.19', name: 'Downtown Dayton', address: {} },
        ]),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { getByPlaceholderText, queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter destination'), 'Downtown');
  });
  await act(async () => { await new Promise(r => setTimeout(r, 700)); });

  await waitFor(() => {
    // Should show distance like "0.0 mi" or "nearby"
    expect(
      queryByText(/\d+\.\d+ mi/) || queryByText(/nearby/)
    ).toBeTruthy();
  });
});

// ── RA-H-006 ─────────────────────────────────────────────────────────────────
test('RA-H-006: Route info shown after destination selected (OSRM)', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Dayton Airport', address: 'Dayton Airport, OH', lat: 39.90, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          routes: [{
            distance: 8370,
            duration: 720,
            geometry: { coordinates: [[-84.19, 39.75], [-84.20, 39.80]] },
          }],
        }),
      });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse([makeDriver()])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => {
    fireEvent.press(queryByText('Dayton Airport')!);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  await waitFor(() => {
    expect(queryByText(/miles.*min/i) || queryByText(/\d+\.\d+ miles/)).toBeTruthy();
  });
});

// ── RA-H-007 ─────────────────────────────────────────────────────────────────
test('RA-H-007: Shows route distance and ETA from OSRM', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Place', address: 'Test Place, OH', lat: 39.90, lng: -84.30, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          routes: [{
            distance: 8370,  // 8.37 km → ~5.2 mi
            duration: 780,   // 780s → 13 min
            geometry: { coordinates: [[-84.19, 39.75], [-84.20, 39.80]] },
          }],
        }),
      });
    }
    if (url.includes('/riders')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse([makeDriver()])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => {
    fireEvent.press(queryByText('Test Place')!);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  await waitFor(() => {
    expect(queryByText(/5\.2 miles.*13 min/i)).toBeTruthy();
  });
});

// ── RA-H-008 ─────────────────────────────────────────────────────────────────
test('RA-H-008: Route distance shown in miles', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Far Away', address: 'Far Away, OH', lat: 40.00, lng: -84.50, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          routes: [{
            distance: 16000,
            duration: 1200,
            geometry: { coordinates: [[-84.19, 39.75], [-84.30, 39.90]] },
          }],
        }),
      });
    }
    if (url.includes('/riders')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse([makeDriver()])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  await act(async () => {
    fireEvent.press(queryByText('Far Away')!);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  await waitFor(() => {
    expect(queryByText(/miles/i)).toBeTruthy();
  });
});

// ── RA-H-009 ─────────────────────────────────────────────────────────────────
test('RA-H-009: Recent destinations shown when search empty', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Home', address: '123 Main St', lat: 39.77, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await waitFor(() => {
    expect(queryByText('Home')).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// RA-DS: Driver Search Tests
// ══════════════════════════════════════════════════════════════════

// ── RA-DS-001 ─────────────────────────────────────────────────────────────────
test('RA-DS-001: No drivers anywhere → shows empty state + retry', async () => {
  // Explicitly empty both server AND blockchain — tests the true "nobody anywhere" case
  mockContract.getAvailableDrivers.mockResolvedValue([]);
  const { queryByText } = await renderAndSearch([]);
  await waitFor(() => {
    expect(queryByText(/No drivers available nearby/i)).toBeTruthy();
    expect(queryByText(/Retry/i)).toBeTruthy();
  });
});

// ── RA-DS-002 ─────────────────────────────────────────────────────────────────
test('RA-DS-002: 1 driver → shows "Limited availability"', async () => {
  const { queryByText } = await renderAndSearch([makeDriver()]);
  await waitFor(() => {
    expect(queryByText(/Limited availability/i)).toBeTruthy();
  });
});

// ── RA-DS-003 ─────────────────────────────────────────────────────────────────
test('RA-DS-003: 3 drivers → shows "Good availability"', async () => {
  const drivers = [makeDriver(), makeDriver({ address: '0x' + 'b'.repeat(40) }), makeDriver({ address: '0x' + 'c'.repeat(40) })];
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText(/Good availability/i)).toBeTruthy();
  });
});

// ── RA-DS-004 ─────────────────────────────────────────────────────────────────
test('RA-DS-004: 7 drivers → shows "High availability"', async () => {
  const drivers = Array.from({ length: 7 }, (_, i) =>
    makeDriver({ address: '0x' + i.toString().padStart(40, '0') })
  );
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText(/High availability/i)).toBeTruthy();
  });
});

// ── RA-DS-005 ─────────────────────────────────────────────────────────────────
test('RA-DS-005: Shows exactly the number of drivers returned', async () => {
  const drivers = Array.from({ length: 5 }, (_, i) =>
    makeDriver({ address: '0x' + i.toString().padStart(40, '0'), vehicle: `Car ${i}` })
  );
  const { queryAllByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    // Each driver card shows "🚗" emoji — 5 of them
    const vehicleTexts = queryAllByText(/Car \d/);
    expect(vehicleTexts.length).toBe(5);
  });
});

// ── RA-DS-006 ─────────────────────────────────────────────────────────────────
test('RA-DS-006: Shows driver vehicle on card', async () => {
  const drivers = [makeDriver({ vehicle: '2020 Toyota Camry' })];
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText('2020 Toyota Camry')).toBeTruthy();
  });
});

// ── RA-DS-007 ─────────────────────────────────────────────────────────────────
test('RA-DS-007: Shows driver rating on card', async () => {
  const drivers = [makeDriver({ rating: 4.92 })];
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText(/4\.92/)).toBeTruthy();
  });
});

// ── RA-DS-008 ─────────────────────────────────────────────────────────────────
test('RA-DS-008: Shows distance to driver in miles', async () => {
  const drivers = [makeDriver({ distanceMi: '1.8', distanceKm: 2.9 })];
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText(/1\.8 mi away/)).toBeTruthy();
  });
});

// ── RA-DS-009 ─────────────────────────────────────────────────────────────────
test('RA-DS-009: Shows ETA in minutes on card', async () => {
  const drivers = [makeDriver({ eta: 4 })];
  const { queryByText } = await renderAndSearch(drivers);
  await waitFor(() => {
    expect(queryByText('4 min')).toBeTruthy();
  });
});

// ── RA-DS-010 ─────────────────────────────────────────────────────────────────
test('RA-DS-010: Shows fare in USD on card', async () => {
  const drivers = [makeDriver({ fareUSD: 6.50 })];
  const { queryByText } = await renderAndSearch(drivers, 6.50);
  await waitFor(() => {
    expect(queryByText(/\$6\.5/)).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// RA-O: Offer Selection Tests
// ══════════════════════════════════════════════════════════════════

async function renderWithOfferSheet(fareUSD = 5.00) {
  const drivers = [makeDriver({ fareUSD })];

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Destination', address: 'Test Destination, Dayton, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse(drivers, fareUSD)) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const result = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => {
    fireEvent.press(result.getByText('Test Destination'));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });

  // Tap the first driver card to open the offer sheet
  await waitFor(() => result.getByText('2021 Toyota Camry'));
  await act(async () => {
    fireEvent.press(result.getByText('2021 Toyota Camry'));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 100)); });

  return result;
}

// ── RA-O-001 ─────────────────────────────────────────────────────────────────
test('RA-O-001: Tap driver → shows offer bottom sheet', async () => {
  const { queryByText } = await renderWithOfferSheet();
  await waitFor(() => {
    expect(queryByText('Choose Your Offer')).toBeTruthy();
  });
});

// ── RA-O-002 ─────────────────────────────────────────────────────────────────
test('RA-O-002: Standard shows base fare', async () => {
  // "$5.00" appears in both the Standard offer row and the Confirm button — use queryAllByText
  const { queryAllByText } = await renderWithOfferSheet(5.00);
  await waitFor(() => {
    expect(queryAllByText(/\$5\.00/).length).toBeGreaterThan(0);
  });
});

// ── RA-O-003 ─────────────────────────────────────────────────────────────────
test('RA-O-003: Rush +25% shows $6.25', async () => {
  const { queryByText } = await renderWithOfferSheet(5.00);
  await waitFor(() => {
    expect(queryByText(/\$6\.25/)).toBeTruthy();
  });
});

// ── RA-O-004 ─────────────────────────────────────────────────────────────────
test('RA-O-004: Priority +50% shows $7.50', async () => {
  const { queryByText } = await renderWithOfferSheet(5.00);
  await waitFor(() => {
    expect(queryByText(/\$7\.50/)).toBeTruthy();
  });
});

// ── RA-O-005 ─────────────────────────────────────────────────────────────────
test('RA-O-005: Emergency 2× shows $10.00', async () => {
  const { queryByText } = await renderWithOfferSheet(5.00);
  await waitFor(() => {
    expect(queryByText(/\$10\.00/)).toBeTruthy();
  });
});

// ── RA-O-006 ─────────────────────────────────────────────────────────────────
test('RA-O-006: Priority shows penalty warning text', async () => {
  // "⚠ Penalty if driver rejects" appears for both Priority and Emergency rows — use queryAllByText
  const { queryAllByText } = await renderWithOfferSheet();
  await waitFor(() => {
    expect(queryAllByText(/Penalty if driver rejects/i).length).toBeGreaterThan(0);
  });
});

// ── RA-O-007 ─────────────────────────────────────────────────────────────────
test('RA-O-007: Sub-text explains penalty applies to Priority and Emergency', async () => {
  const { queryByText } = await renderWithOfferSheet();
  await waitFor(() => {
    expect(queryByText(/penalty applies if driver rejects Priority or Emergency/i)).toBeTruthy();
  });
});

// ── RA-O-008 ─────────────────────────────────────────────────────────────────
test('RA-O-008: Emergency 2× label shown in offer sheet', async () => {
  const { queryByText } = await renderWithOfferSheet();
  await waitFor(() => {
    expect(queryByText('Emergency 2×')).toBeTruthy();
  });
});

// ── RA-O-009 ─────────────────────────────────────────────────────────────────
test('RA-O-009: No "Driver may decline" text in offer sheet', async () => {
  const { queryByText } = await renderWithOfferSheet();
  await waitFor(() => {
    expect(queryByText('Choose Your Offer')).toBeTruthy();
  });
  expect((queryByText as any)(/Driver may decline/i)).toBeFalsy();
});

// ── RA-O-010 ─────────────────────────────────────────────────────────────────
test('RA-O-010: Fare amounts calculated correctly at $3.25 base', async () => {
  const drivers = [makeDriver({ fareUSD: 3.25 })];

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Dest', address: 'Test Dest, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse(drivers, 3.25)) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const result = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  await act(async () => { fireEvent.press(result.getByText('Test Dest')); });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });

  await waitFor(() => result.getByText('2021 Toyota Camry'));
  await act(async () => { fireEvent.press(result.getByText('2021 Toyota Camry')); });
  await act(async () => { await new Promise(r => setTimeout(r, 100)); });

  await waitFor(() => {
    // "$3.25" appears in Standard row + Confirm button — use queryAllByText
    expect(result.queryAllByText(/\$3\.25/).length).toBeGreaterThan(0);
    // Rush 1.25×: $4.0625 → "$4.06" (unique — confirm button shows Standard)
    expect(result.queryByText(/\$4\.06/)).toBeTruthy();
    // Priority 1.5×: $4.875 → "$4.88"
    expect(result.queryByText(/\$4\.88/)).toBeTruthy();
    // Emergency 2×: $6.50
    expect(result.queryByText(/\$6\.50/)).toBeTruthy();
  });
});

// ── RA-DS-011 ─────────────────────────────────────────────────────────────────
test('RA-DS-011: Matching server unreachable → rider falls back to blockchain getAvailableDrivers', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Destination', address: 'Test Destination, Dayton, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });

  // All matching-server URLs throw — simulates server unreachable (path A: .catch fires)
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    return Promise.reject(new Error('Network error: server unreachable'));
  });

  const blockchainDriver = {
    wallet: '0xBlockchain1111111111111111111111111111111',
    lat: 39760000,
    lng: -84200000,
    vehicle: 'Honda Civic Blockchain',
    rating: 492,
  };
  mockContract.getAvailableDrivers.mockResolvedValue([blockchainDriver]);

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  await act(async () => { fireEvent.press(queryByText('Test Destination')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 600)); });

  // Blockchain fallback must have been consulted
  expect(mockContract.getAvailableDrivers).toHaveBeenCalled();
  // Blockchain driver renders in the UI
  await waitFor(() => {
    expect(queryByText(/Honda Civic Blockchain/i)).toBeTruthy();
  }, { timeout: 4000 });
});

// ── RA-DS-012 ─────────────────────────────────────────────────────────────────
test('RA-DS-012: Server returns empty drivers → rider falls back to blockchain getAvailableDrivers', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Test Destination', address: 'Test Destination, Dayton, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });

  // Server responds but returns empty drivers array (path B: .then else branch fires)
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ drivers: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const blockchainDriver = {
    wallet: '0xBlockchain2222222222222222222222222222222',
    lat: 39760000,
    lng: -84200000,
    vehicle: 'Kia EV6 Blockchain',
    rating: 488,
  };
  mockContract.getAvailableDrivers.mockResolvedValue([blockchainDriver]);

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  await act(async () => { fireEvent.press(queryByText('Test Destination')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 600)); });

  // Blockchain fallback must have been consulted
  expect(mockContract.getAvailableDrivers).toHaveBeenCalled();
  // Blockchain driver renders in the UI
  await waitFor(() => {
    expect(queryByText(/Kia EV6 Blockchain/i)).toBeTruthy();
  }, { timeout: 4000 });
});

// ══════════════════════════════════════════════════════════════════
// RA-RC: Rider Active Ride Recovery Tests
// ══════════════════════════════════════════════════════════════════

const RIDE_ID_RC = '0x' + 'e'.repeat(64);

// ── RA-RC-001 ─────────────────────────────────────────────────────────────────
test('RA-RC-001: rider_active_ride_id + non-terminal on-chain → navigate to RideProgress', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
    if (k === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (k === 'rider_active_ride_id') return Promise.resolve(RIDE_ID_RC);
    return Promise.resolve(null);
  });
  mockContract.getRideStatus.mockResolvedValue(1n); // InProgress — non-terminal

  await render(<HomeScreen navigation={NAV} />);

  await waitFor(() => {
    expect(NAV.navigate).toHaveBeenCalledWith('RideProgress', { resumedRideId: RIDE_ID_RC });
  }, { timeout: 5000 });
});

// ── RA-RC-002 ─────────────────────────────────────────────────────────────────
test('RA-RC-002: rider_active_ride_id + Completed on-chain (s=5) → clear storage, no navigation', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
    if (k === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (k === 'rider_active_ride_id') return Promise.resolve(RIDE_ID_RC);
    return Promise.resolve(null);
  });
  mockContract.getRideStatus.mockResolvedValue(5n); // Completed

  await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('rider_active_ride_id');
  expect(NAV.navigate).not.toHaveBeenCalledWith('RideProgress', expect.anything());
});

// ── RA-RC-003 ─────────────────────────────────────────────────────────────────
test('RA-RC-003: No persisted rider_active_ride_id → no RideProgress navigation on launch', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
    if (k === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    return Promise.resolve(null); // no rider_active_ride_id
  });

  await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  expect(NAV.navigate).not.toHaveBeenCalledWith('RideProgress', expect.anything());
});

// ══════════════════════════════════════════════════════════════════
// RA-MP: Map Provider Fallback Tests
// ══════════════════════════════════════════════════════════════════

function setupSearchDestMocks(destName: string, lat: number, lng: number, drivers: any[] = []) {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: destName, address: `${destName}, OH`, lat, lng, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse(drivers)) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ── RA-MP-001 ─────────────────────────────────────────────────────────────────
test('RA-MP-001: No Google key → OSM UrlTile rendered, map renders without crash', async () => {
  // mockHasGoogleKey is false (set in beforeEach) — OSM path
  setupSearchDestMocks('MP Test', 39.80, -84.20);

  const { queryByTestId, queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  // Tap destination to trigger searching=true → MapView + UrlTile mount
  await act(async () => { fireEvent.press(queryByText('MP Test')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });

  // map-view is mounted
  expect(queryByTestId('map-view')).toBeTruthy();
  // OSM tile overlay is rendered (no Google key → keyless path)
  await waitFor(() => expect(queryByTestId('osm-url-tile')).toBeTruthy());
});

// ── RA-MP-002 ─────────────────────────────────────────────────────────────────
test('RA-MP-002: Google key present → no OSM UrlTile, Google mapType used', async () => {
  mockHasGoogleKey = true; // key present → Google path
  setupSearchDestMocks('MP Google Test', 39.80, -84.20, [makeDriver()]);

  const { queryByTestId, queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => { fireEvent.press(queryByText('MP Google Test')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });

  // map-view is mounted
  expect(queryByTestId('map-view')).toBeTruthy();
  // OSM tile is NOT rendered (key present → Google tiles)
  expect(queryByTestId('osm-url-tile')).toBeFalsy();
});

// ── RA-MP-003 ─────────────────────────────────────────────────────────────────
test('RA-MP-003: No key → fitToCoordinates never called, bounding region set directly in JS', async () => {
  // In OSM mode (no Google key), fitToCoordinates is skipped entirely — the native
  // call would crash because the GoogleMap object is in auth-failed state and JS
  // try-catch cannot catch async native thread exceptions.
  const mapMethods = (global as any).mockMapRefMethods;
  mapMethods.fitToCoordinates.mockClear();

  setupSearchDestMocks('MP Fallback', 39.90, -84.30);

  const { queryByTestId, queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => { fireEvent.press(queryByText('MP Fallback')!); });
  // Wait past 350ms (the old setTimeout threshold) to confirm fitToCoordinates is still not called
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  // App still renders — map visible
  expect(queryByTestId('map-view')).toBeTruthy();
  // OSM tile rendered (no key path)
  expect(queryByTestId('osm-url-tile')).toBeTruthy();
  // fitToCoordinates was NOT called — crash path completely avoided
  expect(mapMethods.fitToCoordinates).not.toHaveBeenCalled();
});

// ── RA-MP-004 ─────────────────────────────────────────────────────────────────
test('RA-MP-004: No key path — destination select works end-to-end (B.2.2 stays fixed)', async () => {
  setupSearchDestMocks('MP E2E', 39.80, -84.20, [makeDriver()]);

  const { queryByText, queryByTestId } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  // No crash — destination can be selected, drivers rendered, OSM tile active
  await act(async () => { fireEvent.press(queryByText('MP E2E')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  await waitFor(() => {
    expect(queryByText('2021 Toyota Camry')).toBeTruthy();
    expect(queryByTestId('osm-url-tile')).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// RA-B22: Destination Selection Crash Fix (B.2.2)
// ══════════════════════════════════════════════════════════════════

// ── RA-B22-001 ─────────────────────────────────────────────────────────────────
test('RA-B22-001: No API key (OSM mode) → fitToCoordinates never called → destination select survives, UI functional', async () => {
  // Root-cause fix: when HAS_GOOGLE_MAPS_KEY is false, the useEffect skips the
  // fitToCoordinates native call entirely. The native GoogleMap is in auth-failed
  // state (no key in AndroidManifest) and the async Java exception it would throw
  // cannot be caught by a JS try-catch. Skipping the call eliminates the crash path.
  const mapMethods = (global as any).mockMapRefMethods;
  mapMethods.fitToCoordinates.mockClear();

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Crash Test Dest', address: 'Crash Test, OH', lat: 39.80, lng: -84.20, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders/waiting')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/riders/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse([makeDriver()])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  // Tap destination — triggers setSearching(true) → MapView mounts
  await act(async () => { fireEvent.press(queryByText('Crash Test Dest')!); });
  // Wait well past the old 350ms fitToCoordinates threshold
  await act(async () => { await new Promise(r => setTimeout(r, 500)); });

  // fitToCoordinates was never called (OSM path skips the native call)
  expect(mapMethods.fitToCoordinates).not.toHaveBeenCalled();
  // App is still functional — drivers shown
  await waitFor(() => {
    expect(queryByText('2021 Toyota Camry')).toBeTruthy();
  });
});

// ── RA-B22-002 ─────────────────────────────────────────────────────────────────
test('RA-B22-002: Both matching server and contract fail → IIFE .catch() prevents unhandled rejection, shows empty state', async () => {
  // Simulates: matching server unreachable AND blockchain contract throws.
  // Without the .catch() on the async IIFE, this creates an unhandled promise rejection
  // that crashes the Hermes runtime on Android production builds.
  mockContract.getNodes.mockRejectedValue(new Error('NodeRegistry RPC timeout'));
  mockContract.getAvailableDrivers.mockRejectedValue(new Error('getAvailableDrivers: call revert'));

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Fallback Test', address: 'Fallback, OH', lat: 39.79, lng: -84.22, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    // Server also fails
    return Promise.reject(new Error('ECONNREFUSED'));
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });

  await act(async () => { fireEvent.press(queryByText('Fallback Test')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 800)); });

  // App survived — shows empty state, not a crash
  await waitFor(() => {
    expect(queryByText(/No drivers available nearby/i)).toBeTruthy();
    expect(queryByText(/Retry/i)).toBeTruthy();
  });
});

// ── RA-B22-003 ─────────────────────────────────────────────────────────────────
test('RA-B22-003: Google key present → fitToCoordinates called with correct coords after destination select', async () => {
  mockHasGoogleKey = true; // Google Maps path — fitToCoordinates IS called
  const mapMethods = (global as any).mockMapRefMethods;
  mapMethods.fitToCoordinates.mockClear();

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (key === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Fit Test Dest', address: 'Fit Test, OH', lat: 39.90, lng: -84.30, savedAt: Date.now() },
    ]));
    return Promise.resolve(null);
  });
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('nominatim.openstreetmap.org/reverse')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: { country_code: 'us' } }) });
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('router.project-osrm.org')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [] }) });
    }
    if (url.includes('/riders')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSearchResponse([makeDriver()])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  const { queryByText } = await render(<HomeScreen navigation={NAV} />);
  await act(async () => { await new Promise(r => setTimeout(r, 200)); }); // wait for riderLoc

  await act(async () => { fireEvent.press(queryByText('Fit Test Dest')!); });
  await act(async () => { await new Promise(r => setTimeout(r, 500)); }); // past the 350ms timeout

  // fitToCoordinates was called with rider coords + destination coords
  expect(mapMethods.fitToCoordinates).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }),
    ]),
    expect.objectContaining({ animated: true })
  );
  const [[coords]] = mapMethods.fitToCoordinates.mock.calls;
  // Second coord is the destination (lat: 39.90, lng: -84.30)
  expect(coords[1]).toEqual(expect.objectContaining({ latitude: 39.90, longitude: -84.30 }));
});

// ── RA-B7-001 ─────────────────────────────────────────────────────────────────
test('RA-B7-001: Recent destinations are sorted nearest-first regardless of storage order', async () => {
  // Rider at (39.76, -84.19)
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: 39.76, longitude: -84.19, accuracy: 5, timestamp: Date.now() },
    timestamp: Date.now(),
  });

  // Stored newest-first: Far, Medium, Near — so un-sorted display order would show Far first
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
    if (k === 'rider_wallet_address') return Promise.resolve(RIDER_ADDR);
    if (k === 'recent_destinations') return Promise.resolve(JSON.stringify([
      { name: 'Far Dest',    address: 'Far, City',  lat: 40.76, lng: -84.19, savedAt: Date.now() },         // ~111 km
      { name: 'Medium Dest', address: 'Med, City',  lat: 39.86, lng: -84.19, savedAt: Date.now() - 1000 },  // ~11 km
      { name: 'Near Dest',   address: 'Near, City', lat: 39.78, lng: -84.19, savedAt: Date.now() - 2000 },  // ~2 km
    ]));
    return Promise.resolve(null);
  });

  const { getByTestId } = await render(<HomeScreen navigation={NAV} />);

  // waitFor retries until riderLoc state is set and the proximity sort re-renders.
  // After sort: Near (2 km) → Medium (11 km) → Far (111 km)
  await waitFor(() => {
    expect(within(getByTestId('recent-dest-0')).getByText('Near Dest')).toBeTruthy();
    expect(within(getByTestId('recent-dest-1')).getByText('Medium Dest')).toBeTruthy();
    expect(within(getByTestId('recent-dest-2')).getByText('Far Dest')).toBeTruthy();
  }, { timeout: 3000 });
});
