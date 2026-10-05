import "dotenv/config";
import { db } from "../src/lib/prisma";
import { PERMISSIONS } from "../src/lib/auth/permission-catalog";
import { CRM_ROLE_DEFINITIONS, roleDisplayLabel } from "../src/lib/auth/crm-roles";

// Idempotent (upsert-based) — safe to run in every environment, including staging/production.
// Disposable fake data (sample users/providers) lives in seed.ts instead, which calls this first.

const ROLES: Record<string, { description: string; permissions: string[] }> = {
  super_admin: { description: "Full platform control", permissions: ["*"] },
  ...Object.fromEntries(
    CRM_ROLE_DEFINITIONS.map((role) => [
      role.roleName,
      { description: role.description, permissions: role.permissions },
    ]),
  ),
  // Legacy operational roles kept for existing installs
  supervisor: {
    description: "Legacy admin-role supervisor (prefer Partner roles + Supervisor entity)",
    permissions: ["admins:read", "bookings:read", "providers:*", "assignments:*"],
  },
  ops_manager: {
    description: "Legacy ops manager (prefer city_manager / zone_manager)",
    permissions: ["bookings:*", "providers:*", "assignments:*"],
  },
};

const SERVICE_CATEGORIES = [
  {
    slug: "sweeping",
    name: "Sweeping",
    includedTasks: ["Floor sweeping", "Dusting"],
    excludedTasks: ["Deep cleaning"],
    plans: [
      { name: "Basic", slug: "sweeping-basic", durationMinutes: 60, pricePaise: 9900n },
      { name: "Standard", slug: "sweeping-standard", durationMinutes: 120, pricePaise: 17900n },
      { name: "Premium", slug: "sweeping-premium", durationMinutes: 180, pricePaise: 24900n },
    ],
    addons: [{ name: "Others", pricePaise: 4900n, requiresTextInput: true }],
  },
  {
    slug: "bathroom-cleaning",
    name: "Bathroom Cleaning",
    includedTasks: ["Tile scrubbing", "Fixture cleaning"],
    excludedTasks: [],
    plans: [
      { name: "Basic", slug: "bathroom-cleaning-basic", durationMinutes: 60, pricePaise: 9900n },
      { name: "Standard", slug: "bathroom-cleaning-standard", durationMinutes: 120, pricePaise: 17900n },
    ],
    addons: [],
  },
  {
    slug: "laundry",
    name: "Laundry",
    includedTasks: ["Washing", "Folding"],
    excludedTasks: ["Dry cleaning"],
    plans: [{ name: "Basic", slug: "laundry-basic", durationMinutes: 60, pricePaise: 9900n }],
    addons: [],
  },
] as const;

const COVERAGE_ZONES = [
  { zoneName: "South Delhi", city: "Delhi" },
  { zoneName: "Koramangala", city: "Bangalore" },
] as const;

async function seedRbac() {
  const permissionIdByKey = new Map<string, string>();
  for (const permission of PERMISSIONS) {
    const row = await db.adminPermission.upsert({
      where: { permissionKey: permission.key },
      update: { description: permission.description },
      create: { permissionKey: permission.key, description: permission.description },
    });
    permissionIdByKey.set(permission.key, row.id);
  }

  for (const [roleName, config] of Object.entries(ROLES)) {
    const role = await db.adminRole.upsert({
      where: { roleName },
      update: { description: config.description, name: roleDisplayLabel(roleName) },
      create: { roleName, name: roleDisplayLabel(roleName), description: config.description },
    });

    for (const key of config.permissions) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) continue;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}

async function seedCatalog() {
  for (const category of SERVICE_CATEGORIES) {
    const row = await db.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        includedTasks: [...category.includedTasks],
        excludedTasks: [...category.excludedTasks],
      },
      create: {
        slug: category.slug,
        name: category.name,
        includedTasks: [...category.includedTasks],
        excludedTasks: [...category.excludedTasks],
      },
    });

    for (const plan of category.plans) {
      await db.servicePlan.upsert({
        where: { slug: plan.slug },
        update: {
          name: plan.name,
          durationMinutes: plan.durationMinutes,
          pricePaise: plan.pricePaise,
          includedTasks: [...category.includedTasks],
          excludedTasks: [...category.excludedTasks],
        },
        create: {
          name: plan.name,
          slug: plan.slug,
          durationMinutes: plan.durationMinutes,
          pricePaise: plan.pricePaise,
          includedTasks: [...category.includedTasks],
          excludedTasks: [...category.excludedTasks],
          services: { create: [{ categoryId: row.id }] },
        },
      });
    }

    for (const addon of category.addons) {
      const existing = await db.serviceAddon.findFirst({ where: { categoryId: row.id, name: addon.name } });
      if (!existing) {
        await db.serviceAddon.create({ data: { categoryId: row.id, ...addon } });
      }
    }
  }

  for (const zone of COVERAGE_ZONES) {
    const existing = await db.coverageZone.findFirst({ where: { zoneName: zone.zoneName } });
    if (!existing) {
      await db.coverageZone.create({ data: zone });
    }
  }
}

export async function seedReferenceData() {
  await seedRbac();
  await seedCatalog();
  console.log("Reference data seeded.");
}

// Only auto-run (and disconnect) when this file is executed directly (`npm run db:seed:reference`)
// — not when seed.ts imports seedReferenceData() and needs the connection to stay open.
if (require.main === module) {
  seedReferenceData()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
