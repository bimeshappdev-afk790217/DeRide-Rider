export const CURRENCIES = [
  { code: "USD", symbol: "$",    name: "US Dollar",          decimals: 2 },
  { code: "EUR", symbol: "€",    name: "Euro",               decimals: 2 },
  { code: "GBP", symbol: "£",    name: "British Pound",      decimals: 2 },
  { code: "INR", symbol: "₹",    name: "Indian Rupee",       decimals: 0 },
  { code: "JPY", symbol: "¥",    name: "Japanese Yen",       decimals: 0 },
  { code: "AUD", symbol: "A$",   name: "Australian Dollar",  decimals: 2 },
  { code: "CAD", symbol: "C$",   name: "Canadian Dollar",    decimals: 2 },
  { code: "BRL", symbol: "R$",   name: "Brazilian Real",     decimals: 2 },
  { code: "MXN", symbol: "MX$",  name: "Mexican Peso",       decimals: 0 },
  { code: "SGD", symbol: "S$",   name: "Singapore Dollar",   decimals: 2 },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham",         decimals: 2 },
  { code: "NGN", symbol: "₦",    name: "Nigerian Naira",     decimals: 0 },
  { code: "KES", symbol: "KSh",  name: "Kenyan Shilling",    decimals: 0 },
  { code: "ZAR", symbol: "R",    name: "South African Rand", decimals: 2 },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const FOREX_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_MS  = 5 * 60 * 1000; // 5 minutes

let _cachedRates: Record<string, number> | null = null;
let _cacheTime   = 0;

export async function fetchForexRates(force = false): Promise<Record<string, number> | null> {
  if (!force && _cachedRates && Date.now() - _cacheTime < CACHE_MS) {
    return _cachedRates;
  }
  try {
    const res = await fetch(FOREX_URL);
    if (!res.ok) return _cachedRates ?? null;
    const data = await res.json();
    if (data.result === "success" && data.rates) {
      _cachedRates = data.rates as Record<string, number>;
      _cacheTime   = Date.now();
      return _cachedRates;
    }
    return _cachedRates ?? null;
  } catch {
    return _cachedRates ?? null;
  }
}

/** polAmount × polUsdRate × usdToLocal = local display value */
export function polToLocal(polAmount: number, polUsdRate: number, usdToLocal: number): number {
  return polAmount * polUsdRate * usdToLocal;
}

export function formatLocal(amount: number, code: string): string {
  const cur = CURRENCIES.find(c => c.code === code);
  if (!cur) return `${amount.toFixed(2)} ${code}`;
  if (cur.decimals === 0) {
    return `${cur.symbol}${Math.round(amount).toLocaleString()}`;
  }
  return `${cur.symbol}${amount.toFixed(cur.decimals)}`;
}

export function getCurrencySymbol(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? code;
}

/** Test helper — resets module-level cache so tests get fresh fetch behaviour */
export function _resetForexCache(): void {
  _cachedRates = null;
  _cacheTime   = 0;
}
