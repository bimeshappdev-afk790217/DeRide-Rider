/**
 * OR: Oracle Tests (6 tests)
 */

const NOW_SEC = Math.floor(Date.now() / 1000);

// Stable answer from mock feed — $0.42/POL
const MOCK_ANSWER     = BigInt(42_000_000); // $0.42 * 1e8
const MOCK_UPDATED_AT = BigInt(NOW_SEC - 300); // 5 min ago — fresh

const mockLatestRoundData = jest.fn(() =>
  Promise.resolve([1n, MOCK_ANSWER, BigInt(NOW_SEC - 300), MOCK_UPDATED_AT, 1n])
);

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(() => ({})),
      Contract: jest.fn(() => ({ latestRoundData: mockLatestRoundData })),
    },
    JsonRpcProvider: jest.fn(() => ({})),
    Contract: jest.fn(() => ({ latestRoundData: mockLatestRoundData })),
  };
});

// Isolate module between tests so module-level cache doesn't leak
let oracle: typeof import('../../src/services/chainlinkOracle');

beforeEach(() => {
  jest.resetModules();
  mockLatestRoundData.mockClear();
  mockLatestRoundData.mockResolvedValue([1n, MOCK_ANSWER, BigInt(NOW_SEC - 300), MOCK_UPDATED_AT, 1n]);
  oracle = require('../../src/services/chainlinkOracle');
  oracle._resetCacheForTest();
});

// ── OR-001 ────────────────────────────────────────────────────────────────────
test('OR-001: returns parsed POL/USD price from on-chain feed', async () => {
  const price = await oracle.getPolUsdFromOracle();
  expect(price).toBeCloseTo(0.42, 5);
});

// ── OR-002 ────────────────────────────────────────────────────────────────────
test('OR-002: stale feed (>2h) returns cached fallback, not feed value', async () => {
  const STALE_AT = BigInt(NOW_SEC - 3 * 60 * 60); // 3h ago
  mockLatestRoundData.mockResolvedValueOnce([1n, BigInt(99_000_000), BigInt(STALE_AT), STALE_AT, 1n]);
  const price = await oracle.getPolUsdFromOracle();
  expect(price).toBe(0.50); // FALLBACK_USD, not $0.99 from stale feed
});

// ── OR-003 ────────────────────────────────────────────────────────────────────
test('OR-003: network failure returns cached/fallback, never throws', async () => {
  mockLatestRoundData.mockRejectedValueOnce(new Error('RPC timeout'));
  await expect(oracle.getPolUsdFromOracle()).resolves.toBe(0.50);
});

// ── OR-004 ────────────────────────────────────────────────────────────────────
test('OR-004: zero answer from feed returns cached fallback', async () => {
  mockLatestRoundData.mockResolvedValueOnce([1n, 0n, MOCK_UPDATED_AT, MOCK_UPDATED_AT, 1n]);
  const price = await oracle.getPolUsdFromOracle();
  expect(price).toBe(0.50);
});

// ── OR-005 ────────────────────────────────────────────────────────────────────
test('OR-005: second call within cache TTL returns cached value without re-querying', async () => {
  await oracle.getPolUsdFromOracle(); // primes cache
  await oracle.getPolUsdFromOracle(); // should use cache
  expect(mockLatestRoundData).toHaveBeenCalledTimes(1);
});

// ── OR-006 ────────────────────────────────────────────────────────────────────
describe('verifyFareWei', () => {
  // $1.80/mi × 9.13 mi × 1.0× = $16.43, at $0.42/POL
  const sessionRateCPM  = 180;
  const distMi          = 9.13;
  const offerMultiplier = 100;
  const polPriceUsd     = 0.42;
  const expectedUSD     = (180 / 100) * 9.13 * 1.0; // $16.434
  const expectedWei     = BigInt(Math.round((expectedUSD / polPriceUsd) * 1e18));

  test('OR-006a: fareWei exactly at expected → true', () => {
    expect(oracle.verifyFareWei(expectedWei.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd)).toBe(true);
  });

  test('OR-006b: fareWei +0.5% (within 1%) → true', () => {
    const hi = expectedWei * 1005n / 1000n;
    expect(oracle.verifyFareWei(hi.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd)).toBe(true);
  });

  test('OR-006c: fareWei −0.5% (within 1%) → true', () => {
    const lo = expectedWei * 995n / 1000n;
    expect(oracle.verifyFareWei(lo.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd)).toBe(true);
  });

  test('OR-006d: fareWei 10% too low (lowball) → false', () => {
    const lowball = expectedWei * 90n / 100n;
    expect(oracle.verifyFareWei(lowball.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd)).toBe(false);
  });

  test('OR-006e: fareWei 10% too high → false', () => {
    const high = expectedWei * 110n / 100n;
    expect(oracle.verifyFareWei(high.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd)).toBe(false);
  });

  test('OR-006f: sessionRateCPM = 0 (unknown) → true (skip verification)', () => {
    expect(oracle.verifyFareWei(expectedWei.toString(), 0, distMi, offerMultiplier, polPriceUsd)).toBe(true);
  });

  test('OR-006g: offerMultiplier 125 applied correctly', () => {
    const fareUSD125    = (180 / 100) * 9.13 * 1.25;
    const expectedWei125 = BigInt(Math.round((fareUSD125 / polPriceUsd) * 1e18));
    expect(oracle.verifyFareWei(expectedWei125.toString(), sessionRateCPM, distMi, 125, polPriceUsd)).toBe(true);
    // original (1×) fare should fail ±1% check against 1.25× expected
    expect(oracle.verifyFareWei(expectedWei.toString(), sessionRateCPM, distMi, 125, polPriceUsd)).toBe(false);
  });

  // ── Relay-path tolerance (±5%) ─────────────────────────────────────────────
  test('OR-006h: 2.5% deviation with tolerancePct=5 → true (within relay band)', () => {
    const drift = expectedWei * 1025n / 1000n; // +2.5%
    expect(oracle.verifyFareWei(drift.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd, 5)).toBe(true);
  });

  test('OR-006i: 6% deviation with tolerancePct=5 → false (outside relay band)', () => {
    const drift = expectedWei * 1060n / 1000n; // +6%
    expect(oracle.verifyFareWei(drift.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd, 5)).toBe(false);
  });

  test('OR-006j: exactly 5% deviation with tolerancePct=5 → true (boundary inclusive)', () => {
    const drift = expectedWei * 105n / 100n; // exactly +5%
    expect(oracle.verifyFareWei(drift.toString(), sessionRateCPM, distMi, offerMultiplier, polPriceUsd, 5)).toBe(true);
  });
});
