/**
 * RA-W: Wallet Setup Tests (4 tests)
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { makeContractMock, makeProviderMock } from '../mocks/blockchain';

const mockContract = makeContractMock();
const mockProvider = makeProviderMock();

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const WalletMock = Object.assign(
    jest.fn((key: string) => ({
      address: '0x' + 'a'.repeat(40),
      privateKey: key,
      connect: jest.fn().mockReturnThis(),
    })),
    {
      createRandom: jest.fn(() => ({
        address: '0x' + 'a'.repeat(40),
        privateKey: '0x' + 'b'.repeat(64),
        connect: jest.fn().mockReturnThis(),
      })),
    }
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
    solidityPackedKeccak256: actual.solidityPackedKeccak256,
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
    solidityPackedKeccak256: actual.solidityPackedKeccak256,
  };
});

import { RegisterScreen } from '../../src/screens/RegisterScreen';

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  // Default: wallet has NO balance so it goes to "fund" step
  mockProvider.getBalance.mockResolvedValue(0n);
});

// ── RA-W-001 ─────────────────────────────────────────────────────────────────
test('RA-W-001: Fresh install shows registration form', async () => {
  const { queryByPlaceholderText, queryByText } = await render(
    <RegisterScreen onRegistered={jest.fn()} />
  );
  await waitFor(() => {
    expect(
      queryByPlaceholderText('Enter your first name') ||
      queryByText(/Start Riding/i) ||
      queryByText(/Welcome to DeRide/i)
    ).toBeTruthy();
  });
});

// ── RA-W-002 ─────────────────────────────────────────────────────────────────
test('RA-W-002: Register creates wallet and saves address', async () => {
  const { getByPlaceholderText, getByText } = await render(
    <RegisterScreen onRegistered={jest.fn()} />
  );
  await waitFor(() => getByPlaceholderText('Enter your first name'));

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter your first name'), 'Alice');
    fireEvent.changeText(getByPlaceholderText('+1 (555) 000-0000'), '5551234567');
  });
  await act(async () => {
    fireEvent.press(getByText(/Start Riding/i));
  });

  await waitFor(() => {
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'rider_wallet_address',
      expect.stringMatching(/^0x/)
    );
  });
});

// ── RA-W-003 ─────────────────────────────────────────────────────────────────
test('RA-W-003: Register saves private key in SecureStore', async () => {
  const { getByPlaceholderText, getByText } = await render(
    <RegisterScreen onRegistered={jest.fn()} />
  );
  await waitFor(() => getByPlaceholderText('Enter your first name'));

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter your first name'), 'Alice');
    fireEvent.changeText(getByPlaceholderText('+1 (555) 000-0000'), '5551234567');
  });
  await act(async () => {
    fireEvent.press(getByText(/Start Riding/i));
  });

  await waitFor(() => {
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'rider_wallet_key',
      expect.stringMatching(/^0x/)
    );
  });
});

// ── RA-W-004 ─────────────────────────────────────────────────────────────────
test('RA-W-004: Sufficient balance calls onRegistered', async () => {
  mockProvider.getBalance.mockResolvedValue(BigInt('20000000000000000')); // 0.02 POL
  const onRegistered = jest.fn();
  const { getByPlaceholderText, getByText } = await render(
    <RegisterScreen onRegistered={onRegistered} />
  );
  await waitFor(() => getByPlaceholderText('Enter your first name'));

  await act(async () => {
    fireEvent.changeText(getByPlaceholderText('Enter your first name'), 'Alice');
    fireEvent.changeText(getByPlaceholderText('+1 (555) 000-0000'), '5551234567');
  });
  await act(async () => {
    fireEvent.press(getByText(/Start Riding/i));
  });

  await waitFor(() => {
    expect(onRegistered).toHaveBeenCalled();
  });
});
