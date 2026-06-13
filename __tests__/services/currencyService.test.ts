/**
 * RA-CX: Rider Currency Service Tests
 * Mirrors DA-CX — confirms math is correct in rider context.
 */
import {
  polToLocal, formatLocal, getCurrencySymbol,
  fetchForexRates, _resetForexCache,
} from '../../src/services/currencyService';

beforeEach(() => {
  _resetForexCache();
  (global as any).fetch = undefined;
});

// ── RA-CX-001 ─────────────────────────────────────────────────────────────────
test('RA-CX-001: polToLocal math — 1.5 POL @ $0.073/POL @ ₹85/USD = ₹9.3075', () => {
  expect(polToLocal(1.5, 0.073, 85)).toBeCloseTo(9.3075, 4);
});

// ── RA-CX-002 ─────────────────────────────────────────────────────────────────
test('RA-CX-002: formatLocal INR — 0 decimals, ₹ prefix', () => {
  expect(formatLocal(9.3225, 'INR')).toBe('₹9');
});

// ── RA-CX-003 ─────────────────────────────────────────────────────────────────
test('RA-CX-003: formatLocal USD — 2 decimals, $ prefix', () => {
  expect(formatLocal(1.25, 'USD')).toBe('$1.25');
});

// ── RA-CX-004 ─────────────────────────────────────────────────────────────────
test('RA-CX-004: formatLocal JPY — 0 decimals, ¥ prefix', () => {
  expect(formatLocal(1234.78, 'JPY')).toBe('¥1,235');
});

// ── RA-CX-005 ─────────────────────────────────────────────────────────────────
test('RA-CX-005: formatLocal EUR — 2 decimals, € prefix', () => {
  expect(formatLocal(3.456, 'EUR')).toBe('€3.46');
});

// ── RA-CX-006 ─────────────────────────────────────────────────────────────────
test('RA-CX-006: getCurrencySymbol returns correct symbol', () => {
  expect(getCurrencySymbol('INR')).toBe('₹');
  expect(getCurrencySymbol('GBP')).toBe('£');
  expect(getCurrencySymbol('AED')).toBe('د.إ');
  expect(getCurrencySymbol('XYZ')).toBe('XYZ');
});

// ── RA-CX-007 ─────────────────────────────────────────────────────────────────
test('RA-CX-007: fetchForexRates — valid response caches and returns rates', async () => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        result: 'success',
        rates: { USD: 1, EUR: 0.91, INR: 83.5, JPY: 149.0 },
      }),
    })
  );

  const rates = await fetchForexRates();
  expect(rates).not.toBeNull();
  expect(rates!['INR']).toBe(83.5);
  expect(rates!['EUR']).toBe(0.91);
  expect((global as any).fetch).toHaveBeenCalledTimes(1);
});

// ── RA-CX-008 ─────────────────────────────────────────────────────────────────
test('RA-CX-008: fetchForexRates — cache hit within TTL skips network call', async () => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { USD: 1, INR: 83.5 } }),
    })
  );

  await fetchForexRates();
  await fetchForexRates();
  expect((global as any).fetch).toHaveBeenCalledTimes(1);
});

// ── RA-CX-009 ─────────────────────────────────────────────────────────────────
test('RA-CX-009: fetchForexRates — force=true bypasses cache', async () => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { USD: 1 } }),
    })
  );

  await fetchForexRates(false);
  await fetchForexRates(true);
  expect((global as any).fetch).toHaveBeenCalledTimes(2);
});

// ── RA-CX-010 ─────────────────────────────────────────────────────────────────
test('RA-CX-010: fetchForexRates — network error returns null (graceful)', async () => {
  (global as any).fetch = jest.fn(() => Promise.reject(new Error('offline')));

  const rates = await fetchForexRates();
  expect(rates).toBeNull();
});

// ── RA-CX-011 ─────────────────────────────────────────────────────────────────
test('RA-CX-011: fetchForexRates — non-ok HTTP response returns null (no crash)', async () => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  );

  const rates = await fetchForexRates();
  expect(rates).toBeNull();
});

// ── RA-CX-012 ─────────────────────────────────────────────────────────────────
test('RA-CX-012: polToLocal cross-currency — 10 POL @ $0.073 across USD/INR/JPY tiers', () => {
  const polAmt   = 10;
  const polPrice = 0.073;

  expect(polToLocal(polAmt, polPrice, 1.0)).toBeCloseTo(0.73, 4);
  expect(polToLocal(polAmt, polPrice, 83)).toBeCloseTo(60.59, 1);
  expect(polToLocal(polAmt, polPrice, 149)).toBeCloseTo(108.77, 1);
});
