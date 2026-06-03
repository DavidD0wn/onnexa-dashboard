import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // always fresh

export async function GET() {
  try {
    // Free API — no key required, updated every hour
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const r = data.rates as Record<string, number>;

    return NextResponse.json({
      base: "USD",
      rates: {
        USD: 1,
        MXN: Math.round(r.MXN * 100) / 100,
        COP: Math.round(r.COP),
      },
      updated: data.time_last_update_utc ?? null,
      fallback: false,
    });
  } catch {
    // Fallback rates if internet is unavailable
    return NextResponse.json({
      base: "USD",
      rates: {
        USD: 1,
        MXN: 17.5,
        COP: 4200,
      },
      updated: null,
      fallback: true,
    });
  }
}
