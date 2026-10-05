import "dotenv/config";
import { faker } from "@faker-js/faker";
import { db } from "../src/lib/prisma";
import { generateReferralCode } from "../src/lib/referral-code";
import { seedReferenceData } from "./reference-data";

const USER_COUNT = 20;
const PROVIDER_COUNT = 10;

// Disposable fake data for local dev only — reference data (RBAC/catalog, seeded first via
// seedReferenceData()) is idempotent and shared across environments; this wipes and re-creates
// only the User/ServiceProvider rows, so it never touches reference tables.
async function seedDisposableData() {
  await db.user.deleteMany();
  await db.serviceProvider.deleteMany();

  const users = await Promise.all(
    Array.from({ length: USER_COUNT }).map(async (_, i) =>
      db.user.create({
        data: {
          phoneNumber: `+9190000${String(i).padStart(5, "0")}`,
          fullName: faker.person.fullName(),
          email: faker.internet.email().toLowerCase(),
          isPhoneVerified: true,
          referralCode: await generateReferralCode("customer"),
        },
      }),
    ),
  );

  const providers = await Promise.all(
    Array.from({ length: PROVIDER_COUNT }).map(async (_, i) =>
      db.serviceProvider.create({
        data: {
          phoneNumber: `+9180000${String(i).padStart(5, "0")}`,
          referralCode: await generateReferralCode("provider"),
          fullName: faker.person.fullName(),
          onboardingStatus: "active",
          status: "active",
          isAvailable: true,
        },
      }),
    ),
  );

  console.log(`Seeded ${users.length} users, ${providers.length} providers.`);
}

async function main() {
  await seedReferenceData();
  await seedDisposableData();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
