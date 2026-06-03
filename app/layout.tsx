import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeProvider } from "@/lib/theme";
import { FiltersProvider } from "@/lib/filters";
import { CurrencyProvider } from "@/lib/currency";
import { AppLoader } from "@/components/AppLoader";

export const metadata: Metadata = {
  title: "Onnexa Command Center",
  description: "Dashboard financiero para Glowmmi y Balancea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full" suppressHydrationWarning>
      <body className="h-full" suppressHydrationWarning>
        <ThemeProvider>
          <FiltersProvider>
            <CurrencyProvider>
              <AppLoader>
                <div className="flex h-full">
                  <Sidebar />
                  <main className="flex-1 min-h-screen overflow-x-hidden" style={{ marginLeft: "var(--sidebar-w)", background: "var(--bg)" }}>
                    {children}
                  </main>
                </div>
              </AppLoader>
            </CurrencyProvider>
          </FiltersProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
