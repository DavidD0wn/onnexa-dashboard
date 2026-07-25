// Compatibilidad con el sincronizador histórico anterior. El trabajo real se
// hace por la API de Onnexa para compartir reintentos, transacciones y rollup.
if (!process.argv.some((arg) => arg.startsWith("--from="))) {
  process.argv.push("--from=2026-01-01");
}
if (!process.argv.includes("--only=meta")) process.argv.push("--only=meta");
if (!process.argv.includes("--apply")) process.argv.push("--apply");
await import("./sync.mjs");
