export const mockTx = { hash: '0xabc123', wait: jest.fn(() => Promise.resolve({ status: 1 })) };

export const makeContractMock = (overrides: Record<string, jest.Mock> = {}) => {
  const createRideMock = jest.fn(() => Promise.resolve(mockTx));
  return ({
  getBalance: jest.fn(() => Promise.resolve(BigInt('2000000000000000000'))),
  getRideStatus: jest.fn(() => Promise.resolve(0n)),
  createRide: createRideMock,
  "createRide(bytes32,address,address,bytes32,uint256,uint8)": createRideMock,
  "createRide(bytes32,address,address,bytes32,uint256,uint8,uint256,bytes)": createRideMock,
  confirmPickupByRider: jest.fn(() => Promise.resolve(mockTx)),
  confirmRide: jest.fn(() => Promise.resolve(mockTx)),
  disputeRide: jest.fn(() => Promise.resolve(mockTx)),
  escalateDispute: jest.fn(() => Promise.resolve(mockTx)),
  cancelRide: jest.fn(() => Promise.resolve(mockTx)),
  hasActiveRide: jest.fn(() => Promise.resolve(false)),
  getAvailableDrivers: jest.fn(() => Promise.resolve([])),
  isOnline: jest.fn(() => Promise.resolve(true)),
  getNodes: jest.fn(() => Promise.resolve([])),
  reportFailure: jest.fn(() => Promise.resolve(mockTx)),
  latestRoundData: jest.fn(() => Promise.resolve([
    1n,
    BigInt(50_000_000),  // $0.50 * 1e8
    BigInt(Math.floor(Date.now() / 1000) - 60),
    BigInt(Math.floor(Date.now() / 1000) - 60), // fresh
    1n,
  ])),
  hasMessage: jest.fn(() => Promise.resolve([false, false])),
  getMessage: jest.fn(() => Promise.resolve(['0x0', new Uint8Array(0), 0n])),
  clearMessage: jest.fn(() => Promise.resolve(mockTx)),
  postMessage: jest.fn(() => Promise.resolve(mockTx)),
  ...overrides,
  });
};

export const makeProviderMock = (overrides: Record<string, jest.Mock> = {}) => ({
  getBalance: jest.fn(() => Promise.resolve(BigInt('2000000000000000000'))),
  getNetwork: jest.fn(() => Promise.resolve({ chainId: 137n })),
  getFeeData: jest.fn(() => Promise.resolve({ maxFeePerGas: null })),
  getTransactionCount: jest.fn(() => Promise.resolve(1)),
  call: jest.fn(() => Promise.resolve('0x' + '0'.repeat(256))),
  ...overrides,
});
