import { z } from "zod";
import { genderSchema } from "./auth/schemas";
import { ROLE_CATEGORIES } from "./auth/crm-roles";

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const adminAddressBodySchema = z.object({
  country: z.string().min(1).max(80).optional(),
  state: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  address1: z.string().max(200).optional(),
  address2: z.string().max(200).nullable().optional(),
  pincode: z.string().max(10).optional(),
});

const accessScopeLevelSchema = z.enum([
  "global",
  "business_unit",
  "city",
  "zone",
  "team",
  "assigned",
  "self",
]);

/** Shared create body for /admin/users and /teams/members */
export const createAdminUserBodySchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  phoneNumber: z.string().min(8).max(15),
  role: z.string().min(1),
  categoryId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  address: adminAddressBodySchema.optional(),
  scopeLevel: accessScopeLevelSchema.optional(),
  scopeBusinessUnit: z.string().max(80).nullable().optional(),
  scopeCityIds: z.array(z.string().min(1)).optional(),
  scopeZoneIds: z.array(z.string().min(1)).optional(),
});

/** Shared update body for /admin/users and /teams/members */
export const updateAdminUserBodySchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phoneNumber: z.string().min(8).max(15).optional(),
  role: z.string().min(1).optional(),
  status: z.enum(["pending", "active", "disabled"]).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  transferToId: z.string().uuid().optional(),
  address: adminAddressBodySchema.optional(),
  scopeLevel: accessScopeLevelSchema.optional(),
  scopeBusinessUnit: z.string().max(80).nullable().optional(),
  scopeCityIds: z.array(z.string().min(1)).optional(),
  scopeZoneIds: z.array(z.string().min(1)).optional(),
});

export const transferTeamBodySchema = updateAdminUserBodySchema.pick({ transferToId: true });

export const createSupervisorBodySchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  phoneNumber: z.string().min(8).max(15),
  categoryId: z.string().uuid(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const updateSupervisorBodySchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(8).max(15).optional(),
  categoryId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
});

export const adminAddressDtoSchema = z.object({
  country: z.string(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  address1: z.string().nullable(),
  address2: z.string().nullable(),
  pincode: z.string().nullable(),
});

export const adminRefSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string().email(),
});

export type AdminAddressRecord = {
  country: string;
  state: string | null;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
};

export type AdminAddressInput = {
  country?: string;
  state?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  pincode?: string;
};

export function toAdminAddressDto(address: AdminAddressRecord | null | undefined) {
  if (!address) return null;
  return {
    country: address.country,
    state: address.state,
    city: address.city,
    address1: address.addressLine1,
    address2: address.addressLine2,
    pincode: address.pincode,
  };
}

export function mapAdminAddressBody(
  address?: {
    country?: string;
    state?: string;
    city?: string;
    address1?: string;
    address2?: string | null;
    pincode?: string;
  },
): AdminAddressInput | undefined {
  if (!address) return undefined;
  return {
    country: address.country?.trim() || "India",
    state: address.state?.trim(),
    city: address.city?.trim(),
    addressLine1: address.address1?.trim(),
    addressLine2: address.address2?.trim() ?? null,
    pincode: address.pincode?.trim(),
  };
}

export function toAdminRefDto(admin: { id: string; fullName: string | null; email: string } | null | undefined) {
  if (!admin) return null;
  return { id: admin.id, fullName: admin.fullName, email: admin.email };
}

export const homeTypeSchema = z.enum(["apartment", "independent_house", "villa", "studio"]);
export const homeSizeSchema = z.enum(["bhk_1", "bhk_2", "bhk_3", "bhk_4_plus"]);
export const petTypeSchema = z.enum(["dog", "cat", "bird", "fish", "other"]);

/** Confirm-location body: Places lat/lng plus optional street/city/state/pincode. `line1`/`line2` are aliases. */
const optionalLine = (max: number) => z.string().trim().max(max).optional();

export const confirmLocationBodySchema = z.object({
  label: optionalLine(30),
  street: optionalLine(200),
  line1: optionalLine(200),
  locality: optionalLine(120),
  line2: optionalLine(120),
  /** Full formatted Places string, e.g. "42, Palm Avenue, Koramangala, Bengaluru, Karnataka 560034". */
  address: optionalLine(500),
  city: optionalLine(80),
  state: optionalLine(80),
  pincode: optionalLine(10),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressId: z.string().uuid().optional(),
});

export type ConfirmLocationBody = z.infer<typeof confirmLocationBodySchema>;

export const customerAddressDtoSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  street: z.string(),
  locality: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  formattedAddress: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean(),
  isServiceable: z.boolean(),
  createdAt: z.coerce.date(),
});

export type CustomerAddressRecord = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  isServiceable: boolean;
  createdAt: Date;
};

export function toCustomerAddressDto(address: CustomerAddressRecord) {
  return {
    id: address.id,
    label: address.label,
    street: address.line1,
    locality: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    formattedAddress: address.formattedAddress,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    isServiceable: address.isServiceable,
    createdAt: address.createdAt,
  };
}

export function normalizeConfirmLocationBody(body: ConfirmLocationBody) {
  const street = body.street || body.line1 || body.address || "";
  const locality = body.locality || body.line2 || undefined;
  const formattedAddress =
    body.address || [street, locality, body.city, body.state, body.pincode].filter(Boolean).join(", ") || undefined;

  return {
    label: body.label || "Home",
    line1: street,
    line2: locality,
    city: body.city || undefined,
    state: body.state || undefined,
    pincode: body.pincode || undefined,
    formattedAddress,
    latitude: body.latitude,
    longitude: body.longitude,
  };
}

export const catalogCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  includedTasks: z.array(z.string()),
  excludedTasks: z.array(z.string()),
});

/** Category or subcategory node; categoryId is the parent when present. */
export const catalogServiceSchema = catalogCategorySchema.extend({
  categoryId: z.string().uuid().nullable(),
  pricePaise: z.number().int().nullable(),
  sessionMinutes: z.number().int().nullable(),
});

export const catalogServiceSortSchema = z.enum(["popular", "high_to_low", "low_to_high"]);
export type CatalogServiceSort = z.infer<typeof catalogServiceSortSchema>;

export const categoryRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const catalogPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  pricePaise: z.number().int(),
  includedTasks: z.array(z.string()),
  excludedTasks: z.array(z.string()),
  services: z.array(categoryRefSchema),
});

export const catalogPlansResponseSchema = z.object({
  service: catalogServiceSchema,
  plans: z.array(catalogPlanSchema),
});

export const recommendedPackageSchema = catalogPlanSchema.extend({
  matchCount: z.number().int(),
  matchedServiceIds: z.array(z.string().uuid()),
  missingServiceIds: z.array(z.string().uuid()),
  extraServiceIds: z.array(z.string().uuid()),
});

export const servicePackageDtoSchema = catalogPlanSchema.extend({
  isActive: z.boolean(),
  displayOrder: z.number().int(),
});

export const servicePackageBodySchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).nullable().optional(),
  pricePaise: z.number().int().positive(),
  includedTasks: z.array(z.string().min(1).max(120)).optional(),
  excludedTasks: z.array(z.string().min(1).max(120)).optional(),
  serviceIds: z.array(z.string().uuid()).min(1),
  durationMinutes: z.number().int().min(15).max(24 * 60).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(2_147_483_647).optional(),
});

export const servicePackageUpdateBodySchema = servicePackageBodySchema
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one field is required",
  });

export const servicePackageListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
});

export const coverageZoneSchema = z
  .object({
    id: z.string().uuid(),
    zoneName: z.string(),
    city: z.string().nullable(),
    isActive: z.boolean(),
    launchedAt: z.coerce.date().nullable(),
  })
  .nullable();

export const geofenceLatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export const geofenceAdminDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  boundaryMode: z.enum(["radius", "polygon"]),
  city: z.string().nullable(),
  state: z.string().nullable(),
  address: z.string().nullable(),
  center: geofenceLatLngSchema.nullable(),
  radiusKm: z.number().nullable(),
  radiusMeters: z.number().int().nullable(),
  polygon: z.array(geofenceLatLngSchema).nullable(),
  pointsCount: z.number().int(),
  active: z.boolean(),
  workerCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const geofenceAdminListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
});

export const categoryAdminListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  subcategories: z.number().int(),
});

export const subcategoryAdminListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  mostSelling: z.number().int(),
});

export const geofenceCreateBodySchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().trim().min(1).max(80),
  boundaryMode: z.enum(["radius", "polygon"]),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  address: z.string().min(1).max(500),
  center: geofenceLatLngSchema,
  radiusKm: z.number().positive().optional(),
  radiusMeters: z.number().int().positive().optional(),
  polygon: z.array(geofenceLatLngSchema).optional(),
  active: z.boolean().optional(),
});

export const geofencePatchBodySchema = z.object({
  active: z.boolean(),
});

export const geofenceDeleteBodySchema = z.object({
  reassignToZoneId: z.string().uuid().nullable().optional(),
});

export const geofenceTypeDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.coerce.date(),
});

export const geofenceTypeCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const supervisorRefSchema = z
  .object({
    id: z.string().uuid(),
    fullName: z.string(),
    email: z.string(),
    phoneNumber: z.string(),
    category: categoryRefSchema,
  })
  .nullable();

export const actorStatusSchema = z.enum(["active", "inactive", "suspended", "deleted"]);

export const adminUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  status: z.enum(["pending", "active", "disabled"]),
  role: z.string(),
  permissions: z.array(z.string()),
  passwordResetRequired: z.boolean(),
  lastLoginAt: z.coerce.date().nullable(),
  address: adminAddressDtoSchema.nullable(),
  scopeLevel: z.enum(["global", "business_unit", "city", "zone", "team", "assigned", "self"]),
  scopeBusinessUnit: z.string().nullable(),
  scopeCityIds: z.array(z.string()),
  scopeZoneIds: z.array(z.string()),
  category: categoryRefSchema.nullable(),
  assignedTo: adminRefSchema.nullable(),
  manager: adminRefSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const supervisorDtoSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
  role: z.literal("supervisor"),
  status: actorStatusSchema,
  passwordResetRequired: z.boolean(),
  category: categoryRefSchema,
  createdBy: z.string().uuid(),
  assignedTo: adminRefSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const adminUserListItemSchema = adminUserDtoSchema.extend({
  teamCount: z.number().int(),
  directTeamCount: z.number().int(),
  hasTeamToTransfer: z.boolean(),
});

export const adminUserListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  disabled: z.number().int(),
  pending: z.number().int(),
});

export const supervisorListItemSchema = supervisorDtoSchema.extend({
  teamCount: z.number().int(),
});

export const providerOnboardingStatusSchema = z.enum([
  "registered",
  "profile_complete",
  "docs_submitted",
  "background_check",
  "training",
  "active",
  "rejected",
  "suspended",
]);

export const providerDeviceSchema = z.object({
  deviceId: z.string().min(1).max(120),
  deviceName: z.string().min(1).max(120),
});

export const providerKycDocumentTypeSchema = z.enum(["id_proof", "address_proof"]);
export const verificationStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const offlineRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const providerOfflineRequestSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  reason: z.string(),
  status: offlineRequestStatusSchema,
  requestedLat: z.number().nullable(),
  requestedLong: z.number().nullable(),
  reviewedByAdminId: z.string().uuid().nullable(),
  reviewedAt: z.coerce.date().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const providerOfflineRequestQueueItemSchema = providerOfflineRequestSchema.extend({
  provider: z.object({
    id: z.string().uuid(),
    fullName: z.string().nullable(),
    phoneNumber: z.string(),
    email: z.string().nullable(),
    status: z.string(),
    isAvailable: z.boolean(),
  }),
});

export const providerKycDocumentSchema = z.object({
  id: z.string().uuid(),
  documentType: providerKycDocumentTypeSchema,
  verificationStatus: verificationStatusSchema,
  rejectionReason: z.string().nullable(),
  uploadedAt: z.coerce.date(),
  reviewedAt: z.coerce.date().nullable(),
  downloadUrl: z.string().min(1),
});

export const providerKycListSchema = z.object({
  requiredDocumentTypes: z.array(providerKycDocumentTypeSchema),
  kycVerified: z.boolean(),
  documents: z.array(providerKycDocumentSchema),
});

export const providerKycUploadResponseSchema = z.object({
  document: providerKycDocumentSchema,
  kycVerified: z.boolean(),
});

export const providerKycReviewResponseSchema = z.object({
  document: providerKycDocumentSchema,
  kycVerified: z.boolean(),
});

export const providerKycQueueItemSchema = providerKycDocumentSchema.extend({
  provider: z.object({
    id: z.string().uuid(),
    fullName: z.string().nullable(),
    phoneNumber: z.string(),
    email: z.string().nullable(),
    status: actorStatusSchema,
  }),
});

export const supervisorProviderKycSchema = providerKycListSchema.extend({
  provider: z.object({
    id: z.string().uuid(),
    fullName: z.string().nullable(),
    phoneNumber: z.string(),
    email: z.string().nullable(),
  }),
});

export const providerManagerRefSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  role: z.string(),
});

export const providerAdminDtoSchema = z.object({
  id: z.string().uuid(),
  phoneNumber: z.string(),
  fullName: z.string().nullable(),
  gender: genderSchema,
  email: z.string().nullable(),
  profilePhotoUrl: z.string().nullable(),
  bio: z.string().nullable(),
  onboardingStatus: providerOnboardingStatusSchema,
  serviceCategories: z.array(z.string()),
  status: actorStatusSchema,
  device: providerDeviceSchema.nullable(),
  isAvailable: z.boolean(),
  coverageZone: coverageZoneSchema,
  city: z.string().nullable(),
  avgRating: z.number(),
  totalJobsCompleted: z.number().int(),
  todayEarningsPaise: z.number().int(),
  availabilityStatus: z.enum(["online", "busy", "offline"]),
  kycDocumentsUploaded: z.boolean(),
  kycReviewPending: z.boolean(),
  kycVerified: z.boolean(),
  kycStatus: z.enum(["verified", "pending", "missing"]),
  managedBy: providerManagerRefSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const providerAdminListStatsSchema = z.object({
  online: z.number().int(),
  busy: z.number().int(),
  offline: z.number().int(),
  kycPending: z.number().int(),
});

export const adminUserCreatedStatsSchema = z.object({
  members: z.object({
    total: z.number().int(),
    roles: z.array(z.object({ role: z.string(), count: z.number().int() })),
  }),
  supervisors: z.object({ total: z.number().int() }),
  workers: providerAdminListStatsSchema.extend({ total: z.number().int() }),
});

export const homeProfileSchema = z.object({
  id: z.string().uuid(),
  homeType: homeTypeSchema.nullable(),
  homeSize: homeSizeSchema.nullable(),
  floorNumber: z.number().int().nullable(),
  adultsCount: z.number().int(),
  childrenCount: z.number().int(),
  seniorsCount: z.number().int(),
  hasFemaleMember: z.boolean(),
  liveSelfieUrl: z.string().nullable(),
  hasPets: z.boolean(),
  petType: petTypeSchema.nullable(),
  petCount: z.number().int().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const meHomeProfileSchema = homeProfileSchema.nullable();

export const meCustomerResponseSchema = z.object({
  type: z.literal("customer"),
  id: z.string().uuid(),
  phoneNumber: z.string(),
  fullName: z.string().nullable(),
  gender: genderSchema,
  email: z.string().nullable(),
  profilePhotoUrl: z.string().nullable(),
  status: z.enum(["active", "blocked", "deleted"]),
  isPhoneVerified: z.boolean(),
  referralCode: z.string(),
  walletBalancePaise: z.string(),
  totalBookings: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  homeProfile: meHomeProfileSchema,
  homeAddress: customerAddressDtoSchema.nullable(),
  /** True when the customer has saved a full name. */
  isProfileComplete: z.boolean(),
  /** True when a default home address has been saved. */
  hasHomeLocation: z.boolean(),
  /** True when Set Up Your Home has home type and size. */
  isHomeSetupComplete: z.boolean(),
});

/** CRM directory listing for app customers (User role=customer). */
export const customerAdminDtoSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneNumber: z.string(),
  email: z.string().nullable(),
  gender: genderSchema,
  status: z.enum(["active", "blocked"]),
  isPhoneVerified: z.boolean(),
  walletBalancePaise: z.number().int(),
  referralCode: z.string().nullable(),
  city: z.string().nullable(),
  bookingCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const mapPointSchema = z.object({
  id: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  status: z.string(),
  label: z.string(),
});

export const customerAdminListStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  blocked: z.number().int(),
  verified: z.number().int(),
});

export const updateCustomerStatusBodySchema = z.object({
  status: z.enum(["active", "blocked"]),
});

export const bookingAdminListStatsSchema = z.object({
  total: z.number().int(),
  assigned: z.number().int(),
  inProgress: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
});

const reviewPersonSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneNumber: z.string(),
});

export const reviewAdminDtoSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  customer: reviewPersonSchema,
  worker: reviewPersonSchema,
});

export const reviewAdminListStatsSchema = z.object({
  total: z.number().int(),
  avgRating: z.number(),
});

export const couponAdminDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  discountType: z.enum(["percent", "flat"]),
  percentOff: z.number().int().nullable(),
  amountOffPaise: z.number().int().nullable(),
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  isActive: z.boolean(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const couponAdminListStatsSchema = z.object({
  active: z.number().int(),
  total: z.number().int(),
});

export const meProviderResponseSchema = z.object({
  type: z.literal("provider"),
  id: z.string().uuid(),
  phoneNumber: z.string(),
  fullName: z.string().nullable(),
  gender: genderSchema,
  email: z.string().nullable(),
  profilePhotoUrl: z.string().nullable(),
  status: actorStatusSchema,
  referralCode: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  kycVerified: z.boolean(),
  kycStatus: z.enum(["approved", "pending", "rejected", "not_submitted"]),
  kycRejectionReason: z.string().nullable(),
  availabilityStatus: z.enum(["online", "offline"]),
  serviceCategories: z.array(categoryRefSchema),
  stats: z.object({
    totalJobsCompleted: z.number().int(),
    totalEarnedPaise: z.number().int(),
    thisWeek: z.object({
      startDate: z.string(),
      endDate: z.string(),
      scheduled: z.number().int(),
      inProgress: z.number().int(),
      completed: z.number().int(),
      earnedPaise: z.number().int(),
    }),
  }),
});

export const adminRoleModuleRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  isActive: z.boolean(),
  sectionName: z.string().nullable(),
});

export const adminRoleDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  roleName: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  isAdmin: z.boolean(),
  isReserved: z.boolean(),
  permissions: z.array(z.string()),
  modules: z.array(adminRoleModuleRefSchema),
  userCount: z.number().int(),
});

export const sidebarModuleSchema = z.object({
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  icon: z.string(),
});

export const sidebarSectionSchema = z.object({
  sectionName: z.string(),
  sectionSlug: z.string(),
  modules: z.array(sidebarModuleSchema),
});

export const meAdminResponseSchema = z.object({
  type: z.literal("admin"),
  id: z.string().uuid(),
  role: z.string(),
  fullName: z.string().nullable(),
  email: z.string().email(),
  phoneNumber: z.string().nullable(),
  passwordResetRequired: z.boolean(),
    permissions: z.array(z.string()),
    status: z.null(),
  /** CRM role category (platform, operations, …) — not a ServiceCategory. */
  category: z.enum(ROLE_CATEGORIES).nullable(),
  createdBy: z.null(),
  /** True when this role is an Admin: they only see their own tree (children/grandchildren). */
  isAdmin: z.boolean(),
  sidebar: z.array(sidebarSectionSchema),
  /** Role names this admin may list/create on Manage team members. `null` means every role. */
  managedTeamRoles: z.array(z.string()).nullable(),
});

export const meSupervisorResponseSchema = z.object({
  type: z.literal("supervisor"),
  id: z.string().uuid(),
  role: z.null(),
  fullName: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
  passwordResetRequired: z.boolean(),
  permissions: z.array(z.string()),
  status: actorStatusSchema,
  category: categoryRefSchema,
  createdBy: z.string().uuid(),
});

export const legalSupportFaqSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
});

export const legalSupportContentSchema = z.object({
  termsOfService: z.string(),
  privacyPolicy: z.string(),
  refundPolicy: z.string(),
  cancellationPolicy: z.string(),
  pricingAndPayment: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  faqs: z.array(legalSupportFaqSchema),
  updatedAt: z.coerce.date(),
});

/** Public legal & support content for the apps, plus the admin-set worker job hours. */
export const legalSupportPublicSchema = legalSupportContentSchema.extend({
  jobHours: z.object({
    start: z.string().describe("IST, HH:mm"),
    end: z.string().describe("IST, HH:mm; earlier than start = overnight"),
    timezone: z.literal("Asia/Kolkata"),
    allDay: z.boolean().describe("start equals end: jobs can be booked at any time"),
    displayText: z.string().describe("e.g. 9:00 AM – 8:00 PM"),
  }),
});

export const meResponseSchema = z.union([
  meCustomerResponseSchema,
  meProviderResponseSchema,
  meAdminResponseSchema,
  meSupervisorResponseSchema,
]);

export const profilePhotoUploadResponseSchema = z.object({
  profilePhotoUrl: z.string(),
});

/** Stored value is an S3 object key (no host) or an external URL. */
export const catalogIconUploadResponseSchema = z.object({
  iconUrl: z.string(),
  iconDisplayUrl: z.string().nullable(),
});

const sessionChecklistItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  done: z.boolean(),
  status: z.enum(["done", "in_progress", "pending"]),
});

export const bookingSessionSchema = z.object({
  timer: z.object({
    startedAt: z.string(),
    durationMinutes: z.number().int(),
    elapsedSeconds: z.number().int().nonnegative(),
    remainingSeconds: z.number().int().nonnegative(),
    overtimeSeconds: z.number().int().nonnegative(),
    overtimeRatePaise: z.number().int().nonnegative(),
    expired: z.boolean(),
    serverTime: z.string(),
  }),
  checklist: z.array(sessionChecklistItemSchema),
});

export const updateChecklistBodySchema = z.object({
  itemId: z.string().uuid(),
  done: z.boolean(),
});

/** A real IST calendar date, `YYYY-MM-DD`. */
export const istDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "not a real date");
