// Último intento matutino (11:00 a. m. Colombia). Comparte la reserva
// idempotente del reintento de las 10:00: nunca duplica un reporte enviado.
export const runtime = "nodejs";
export const maxDuration = 300;
export { GET } from "../reintento/route";
