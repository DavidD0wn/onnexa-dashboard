"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface Filters {
  days: number;
  brand: string;
  country: string;
  customFrom: string | null;
  customTo: string | null;
  isCustom: boolean;
  setDays: (d: number) => void;
  setBrand: (b: string) => void;
  setCountry: (c: string) => void;
  setCustomRange: (from: string, to: string) => void;
  clearCustomRange: () => void;
}

const FiltersContext = createContext<Filters>({
  days: 30, brand: "all", country: "all",
  customFrom: null, customTo: null, isCustom: false,
  setDays: () => {}, setBrand: () => {}, setCountry: () => {},
  setCustomRange: () => {}, clearCustomRange: () => {},
});

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [days, setDaysState] = useState(30);
  const [brand, setBrand]     = useState("all");
  const [country, setCountry] = useState("all");
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo]     = useState<string | null>(null);
  const [isCustom, setIsCustom]     = useState(false);

  const setDays = (d: number) => {
    setDaysState(d);
    setIsCustom(false);
    setCustomFrom(null);
    setCustomTo(null);
  };

  const setCustomRange = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setIsCustom(true);
  };

  const clearCustomRange = () => {
    setIsCustom(false);
    setCustomFrom(null);
    setCustomTo(null);
  };

  return (
    <FiltersContext.Provider value={{
      days, brand, country,
      customFrom, customTo, isCustom,
      setDays, setBrand, setCountry,
      setCustomRange, clearCustomRange,
    }}>
      {children}
    </FiltersContext.Provider>
  );
}

export const useFilters = () => useContext(FiltersContext);
