import { z } from "zod";
import { searchQuerySchema } from "./pagination";

type StatusList<T extends string> = T[];

/** Parse comma / repeated `status` query into a deduped allow-list. */
export function statusListQuerySchema<T extends string>(
  allowed: readonly T[],
  extra: z.ZodRawShape = {},
) {
  const allowedSet = new Set<string>(allowed);
  return searchQuerySchema
    .extend({
      status: z.union([z.string(), z.array(z.string())]).optional(),
      ...extra,
    })
    .transform((query) => {
      const raw = query.status;
      if (raw == null) {
        return { ...query, status: undefined as StatusList<T> | undefined };
      }
      const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((part) => part.split(","))
        .map((part) => part.trim().toLowerCase())
        .filter((part): part is T => allowedSet.has(part));
      return {
        ...query,
        status: parts.length ? ([...new Set(parts)] as StatusList<T>) : undefined,
      };
    });
}
