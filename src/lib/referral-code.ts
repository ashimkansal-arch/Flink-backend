import { db } from "./prisma";

export type ReferralAccount = "customer" | "provider";

/** Customers get FLK-C-002, FLK-C-003…; workers FLK-W-002, FLK-W-003… (at least 3 digits). */
const REFERRAL_CODES: Record<ReferralAccount, { prefix: string; sequence: string }> = {
  customer: { prefix: "FLK-C-", sequence: "customer_referral_code_seq" },
  provider: { prefix: "FLK-W-", sequence: "worker_referral_code_seq" },
};

export function formatReferralCode(account: ReferralAccount, n: number | bigint) {
  return `${REFERRAL_CODES[account].prefix}${String(n).padStart(3, "0")}`;
}

/**
 * The next referral code for a new account. Numbers come from a Postgres sequence per account
 * type, so concurrent sign-ups never get the same code (a failed sign-up may leave a gap).
 */
export async function generateReferralCode(account: ReferralAccount): Promise<string> {
  const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval(${REFERRAL_CODES[account].sequence}::regclass) AS n`;
  return formatReferralCode(account, row.n);
}
