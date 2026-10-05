import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requireAnyPermission, requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  geofenceAdminDtoSchema,
  geofenceAdminListStatsSchema,
  geofenceCreateBodySchema,
  geofenceDeleteBodySchema,
  geofencePatchBodySchema,
  geofenceTypeCreateBodySchema,
  geofenceTypeDtoSchema,
} from "../../lib/api-schemas";
import { adminGeofenceService } from "../../services/admin-geofence-service";

const idParamsSchema = z.object({ id: z.string().uuid() });

const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  ZONE_NOT_FOUND: 404,
  TARGET_ZONE_NOT_FOUND: 404,
  INVALID_NAME: 400,
  INVALID_TYPE: 400,
  INVALID_ADDRESS: 400,
  INVALID_CENTER: 400,
  INVALID_RADIUS: 400,
  INVALID_POLYGON: 400,
  CANNOT_REASSIGN_TO_SELF: 400,
  TYPE_TAKEN: 409,
};

function mappedError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

export const adminGeofenceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/geofences",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:read")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "List geofence / coverage zones",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            items: z.array(geofenceAdminDtoSchema),
            stats: geofenceAdminListStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async () => adminGeofenceService.list(),
  );

  app.get(
    "/admin/geofence-types",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:read")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "List geofence zone types",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({ items: z.array(geofenceTypeDtoSchema) }),
          ...authedErrorResponses,
        },
      },
    },
    async () => adminGeofenceService.listTypes(),
  );

  app.post(
    "/admin/geofence-types",
    {
      preHandler: [
        requireAuth("admin"),
        requireAnyPermission(["geofences:create", "geofences:update"]),
      ],
      schema: {
        tags: ["Admin Geofences"],
        summary: "Create a geofence zone type",
        security: [{ bearerAuth: [] }],
        body: geofenceTypeCreateBodySchema,
        response: { 201: geofenceTypeDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const type = await adminGeofenceService.createType(request.body.name);
        return reply.code(201).send(type);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/geofences",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:create")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "Create a geofence zone (radius or polygon)",
        security: [{ bearerAuth: [] }],
        body: geofenceCreateBodySchema,
        response: { 201: geofenceAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const zone = await adminGeofenceService.create(request.body);
        return reply.code(201).send(zone);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.put(
    "/admin/geofences/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:update")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "Update a geofence zone (name, type, address, boundary)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: geofenceCreateBodySchema,
        response: { 200: geofenceAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminGeofenceService.update(request.params.id, request.body);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/geofences/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:update")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "Enable or disable a geofence zone",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: geofencePatchBodySchema,
        response: { 200: geofenceAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminGeofenceService.setActive(request.params.id, request.body.active);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/geofences/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("geofences:delete")],
      schema: {
        tags: ["Admin Geofences"],
        summary: "Delete a geofence zone and optionally reassign its workers",
        description:
          "Workers on the deleted zone are moved to reassignToZoneId, or left unassigned when omitted/null.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: geofenceDeleteBodySchema.optional().default({}),
        response: { 204: z.null(), ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminGeofenceService.remove(request.params.id, request.body?.reassignToZoneId);
        return reply.code(204).send(null);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};
