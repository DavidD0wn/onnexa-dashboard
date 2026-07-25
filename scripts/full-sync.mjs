// Compatibilidad con el nombre antiguo: usa el sincronizador central,
// sin credenciales incrustadas en este archivo.
if (!process.argv.some((arg) => arg.startsWith("--days="))) {
  process.argv.push("--days=90");
}
if (!process.argv.includes("--apply")) process.argv.push("--apply");
await import("./sync.mjs");
