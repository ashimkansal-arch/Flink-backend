// Lazily read so secrets-manager values are visible (server.ts loads env before first use).
export function googleApiKey(): string | null {
  const key = process.env.GOOGLE_API_KEY?.trim();
  return key || null;
}
