import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchParamSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .describe("Search term (partial match)");

export const optionalSearchQuerySchema = z.object({ q: searchParamSchema });

export const searchQuerySchema = paginationQuerySchema.extend({ q: searchParamSchema });

export const createdTeamGroupSchema = z.enum(["members", "supervisors", "workers"]);

/** Comma-separated or repeated query values → string[] */
const listParamSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value == null) return undefined;
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(","))
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length ? [...new Set(parts)] : undefined;
  });

const adminStatusSchema = z.enum(["pending", "active", "disabled"]);

/** Admin / team-member directory list filters (multi-value) */
export const adminUserListQuerySchema = searchQuerySchema
  .extend({
    role: listParamSchema,
    status: listParamSchema,
    state: listParamSchema,
    city: listParamSchema,
  })
  .transform((query) => {
    const statuses = query.status
      ?.map((s) => s.toLowerCase())
      .filter((s): s is z.infer<typeof adminStatusSchema> => adminStatusSchema.safeParse(s).success);
    return {
      ...query,
      status: statuses?.length ? statuses : undefined,
    };
  });

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type OptionalSearchQuery = z.infer<typeof optionalSearchQuerySchema>;

const customerStatusSchema = z.enum(["active", "blocked"]);

const optionalBooleanQuery = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => {
    if (value == null) return undefined;
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1";
  });

/** Customer directory list filters */
export const customerListQuerySchema = searchQuerySchema
  .extend({
    status: listParamSchema,
    isPhoneVerified: optionalBooleanQuery,
  })
  .transform((query) => {
    const statuses = query.status
      ?.map((s) => s.toLowerCase())
      .filter((s): s is z.infer<typeof customerStatusSchema> =>
        customerStatusSchema.safeParse(s).success,
      );
    return {
      ...query,
      status: statuses?.length ? statuses : undefined,
      isPhoneVerified: query.isPhoneVerified,
    };
  });

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

const providerAvailabilitySchema = z.enum(["online", "busy", "offline"]);
const providerKycListSchema = z.enum(["verified", "pending", "missing"]);

/** Admin worker/provider directory list filters */
export const providerAdminListQuerySchema = searchQuerySchema
  .extend({
    availability: listParamSchema,
    kyc: listParamSchema,
    city: listParamSchema,
    managedBy: listParamSchema,
    scope: z.enum(["all", "assigned"]).optional(),
  })
  .transform((query) => {
    const availability = query.availability
      ?.map((value) => value.toLowerCase())
      .filter((value): value is z.infer<typeof providerAvailabilitySchema> =>
        providerAvailabilitySchema.safeParse(value).success,
      );
    const kyc = query.kyc
      ?.map((value) => value.toLowerCase())
      .filter((value): value is z.infer<typeof providerKycListSchema> =>
        providerKycListSchema.safeParse(value).success,
      );
    const managedBy = query.managedBy?.filter((id) => z.string().uuid().safeParse(id).success);
    return {
      ...query,
      availability: availability?.length ? availability : undefined,
      kyc: kyc?.length ? kyc : undefined,
      city: query.city,
      managedBy: managedBy?.length ? managedBy : undefined,
    };
  });

export type ProviderAdminListQuery = z.infer<typeof providerAdminListQuerySchema>;

/** Org-tree team view: members, field supervisors, or workers under a CRM admin */
export const adminUserCreatedQuerySchema = searchQuerySchema
  .extend({
    group: createdTeamGroupSchema.default("members"),
    role: z.string().trim().min(1).optional(),
    availability: listParamSchema,
    kyc: listParamSchema,
  })
  .transform((query) => {
    const availability = query.availability
      ?.map((value) => value.toLowerCase())
      .filter((value): value is z.infer<typeof providerAvailabilitySchema> =>
        providerAvailabilitySchema.safeParse(value).success,
      );
    const kyc = query.kyc
      ?.map((value) => value.toLowerCase())
      .filter((value): value is z.infer<typeof providerKycListSchema> =>
        providerKycListSchema.safeParse(value).success,
      );
    return {
      ...query,
      availability: availability?.length ? availability : undefined,
      kyc: kyc?.length ? kyc : undefined,
    };
  });

export type AdminUserCreatedQuery = z.infer<typeof adminUserCreatedQuerySchema>;

export function paginationSkip(query: PaginationQuery) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export function paginatedResult<T>(items: T[], total: number, query: PaginationQuery) {
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 0,
  };
}

export function paginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });
}
