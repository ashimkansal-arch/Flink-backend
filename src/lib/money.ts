// `*_paise` columns are Prisma BigInt (see schema.prisma's translation notes) — JSON has no
// BigInt type, and Fastify's serializer throws on one rather than silently stringifying it. Paise
// amounts are always well under Number.MAX_SAFE_INTEGER (2^53), so a plain number is exact and
// safe here; this is the one conversion point every route response passes money through.
export function paise(value: bigint): number {
  return Number(value);
}
