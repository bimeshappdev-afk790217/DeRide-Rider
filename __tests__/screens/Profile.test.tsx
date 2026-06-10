/**
 * RA-W-002/003 profile: wallet address and balance display
 * (RA-W-001 and RA-W-004 are in Register.test.tsx)
 * These also serve as RA-W-002 and RA-W-003 profile sub-tests.
 *
 * Actually these do not map directly to RA-W test IDs (those are covered in Register.test.tsx).
 * This file tests the ProfileScreen for balance/address display which is referenced in TEST_PLAN.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeContractMock, makeProviderMock } from '../mocks/blockchain';

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
  };
});

import { ProfileScreen } from '../../src/screens/ProfileScreen';

const WALLET_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const NAV = { navigate: jest.fn(), goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    const data: Record<string, string | null> = {
      rider_wallet_address: WALLET_ADDR,
      rider_name: 'Alice',
      rider_total_rides: '5',
    };
    return Promise.resolve(data[key] ?? null);
  });
  mockProvider.getBalance.mockResolvedValue(BigInt('2000000000000000000'));
  // Mock CoinGecko price fetch
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ 'matic-network': { usd: 0.50 } }),
    })
  );
});

// ── RA-P-001 ─────────────────────────────────────────────────────────────────
test('RA-P-001: Shows truncated wallet address', async () => {
  const { queryByText } = await render(<ProfileScreen navigation={NAV} />);
  await waitFor(() => {
    // Address shown as ${addr.slice(0,10)}...${addr.slice(-6)}
    expect(queryByText('0x12345678...345678')).toBeTruthy();
  });
});

// ── RA-P-002 ─────────────────────────────────────────────────────────────────
test('RA-P-002: Shows balance in POL', async () => {
  const { queryByText } = await render(<ProfileScreen navigation={NAV} />);
  await waitFor(() => {
    expect(queryByText(/2\.0000 POL/)).toBeTruthy();
  });
});

// ── RA-P-003 ─────────────────────────────────────────────────────────────────
test('RA-P-003: Shows rider name', async () => {
  const { queryByText } = await render(<ProfileScreen navigation={NAV} />);
  await waitFor(() => {
    expect(queryByText('Alice')).toBeTruthy();
  });
});

// ── RA-P-004 ─────────────────────────────────────────────────────────────────
test('RA-P-004: Shows total rides count', async () => {
  const { queryByText } = await render(<ProfileScreen navigation={NAV} />);
  await waitFor(() => {
    expect(queryByText('5')).toBeTruthy();
  });
});
