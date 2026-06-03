"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

export type CurrencyCode = "USD" | "MXN" | "COP";

export const CURRENCY_INFO: Record<
  CurrencyCode,
  { label: string; flag: string; locale: string; decimals: number }
> = {
  USD: { label: "Dólar USD",   flag: "🇺🇸", locale: "en-US",  decimals: 2 },
  MXN: { label: "Peso MX",    flag: "🇲🇽", locale: "es-MX",  decimals: 0 },
  COP: { label: "Peso CO",    flag: "🇨🇴", locale: "es-CO",  decimals: 0 },
};

interface CurrencyCtx {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  rates: Record<string, number>;
  ratesLoaded: boolean;
  ratesFallback: boolean;
  updatedAt: string | null;
  /** Convert a USD amount to the selected currency */
  convert: (usd: number) => number;
  /** Format a USD amount in the selected currency */
  fmtC: (usd: number) => string;
  /** Show the live rate label, e.g. "1 USD = $4,200 COP" */
  rateLabel: string;
}

const CurrencyContext = createContext<CurrencyCtx>({
  currency: "USD",
  setCurrency: () => {},
  rates: { USD: 1, MXN: 17.5, COP: 4200 },
  ratesLoaded: false,
  ratesFallback: false,
  updatedAt: null,
  convert: (v) => v,
  fmtC: (v) => `$${v.toFixed(2)}`,
  rateLabel: "",
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    if (typeof window === "undefined") return "USD";
    return (localStorage.getItem("onnexa_currency") as CurrencyCode) ?? "USD";
  });

  const setCurrency = (c: CurrencyCode) => {
    localStorage.setItem("onnexa_currency", c);
    setCurrencyState(c);
  };
  const [rates, setRates] = useState<Record<string, number>>({
    USD: 1,
    MXN: 17.5,
    COP: 4200,
  });
  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [ratesFallback, setRatesFallback] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/exchange-rates")
      .then((r) => r.json())
      .then((d) => {
        setRates(d.rates ?? rates);
        setRatesFallback(d.fallback ?? false);
        setUpdatedAt(d.updated ?? null);
        setRatesLoaded(true);
      })
      .catch(() => {
        setRatesFallback(true);
        setRatesLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const convert = (usd: number) => usd * (rates[currency] ?? 1);

  const fmtC = (usd: number) => {
    const converted = convert(usd);
    const info = CURRENCY_INFO[currency];
    return new Intl.NumberFormat(info.locale, {
      style: "currency",
      currency,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(converted);
  };

  const rate = rates[currency] ?? 1;
  const rateLabel =
    currency === "USD"
      ? ""
      : `1 USD = ${new Intl.NumberFormat("es-CO", {
          minimumFractionDigits: currency === "MXN" ? 2 : 0,
          maximumFractionDigits: currency === "MXN" ? 2 : 0,
        }).format(rate)} ${currency}`;

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        ratesLoaded,
        ratesFallback,
        updatedAt,
        convert,
        fmtC,
        rateLabel,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
