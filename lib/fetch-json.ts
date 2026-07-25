/**
 * Reads JSON responses without throwing when a request is interrupted and the
 * browser receives an empty or incomplete body.
 */
export async function fetchJsonSafe<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(input, init);
    const body = await response.text();

    if (!response.ok || !body.trim()) return null;

    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
