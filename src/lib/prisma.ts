import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Kept in sync with the defaults in src/config/env-schema.ts. server.ts guarantees process.env
// is fully populated (including any secrets-manager values) before this module is imported.
const poolMax = Number(process.env.DATABASE_POOL_MAX) || 10;
const writeUrl = process.env.DATABASE_URL;
const readUrl = process.env.DATABASE_READ_URL || writeUrl;

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: writeUrl, max: poolMax }),
});

// Reads and writes hit the same instance until a read replica exists. Repositories call
// `readDb` for reads and `db` for writes, so pointing DATABASE_READ_URL at a replica later is
// just an env var change — nothing outside this file needs to know.
export const readDb =
  readUrl === writeUrl
    ? db
    : new PrismaClient({ adapter: new PrismaPg({ connectionString: readUrl, max: poolMax }) });
