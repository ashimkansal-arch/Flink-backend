import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requireAnyPermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { optionalSearchQuerySchema } from "../../lib/pagination";
import {
  enrichRoleWithCatalog,
  listPermissionCatalog,
  listRoleCatalog,
  listScopeCatalog,
} from "../../lib/auth/access-catalog";
import { ACCESS_SCOPE_LEVELS } from "../../lib/auth/crm-roles";
import { orgTeamService } from "../../services/org-team-service";
import { accessPolicyService } from "../../services/access-policy-service";
import { adminRoleService } from "../../services/admin-role-service";

const ACCESS_READ = ["access:read", "access:*", "*"] as const;
const ACCESS_WRITE = ["access:write", "access:*", "policies:*", "*"] as const;
const AUDIT_READ = ["audit:read", "access:read", "access:*", "*"] as const;

const policyStatusSchema = z.enum(["active", "inactive", "draft"]);
const visibilityLevelSchema = z.enum([
  "global",
  "city",
  "team",
  "team_and_children",
  "scope",
  "assigned",
  "custom",
]);
const idParams = z.object({ id: z.string().uuid() });
const teamMemberParams = z.object({ id: z.string().uuid(), adminUserId: z.string().uuid() });

const writeErrors = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

function mapTeamError(message: string): { status: 400 | 404 | 409; error: string } | null {
  switch (message) {
    case "TEAM_NOT_FOUND":
    case "PARENT_TEAM_NOT_FOUND":
    case "TEAM_MEMBER_NOT_FOUND":
      return { status: 404, error: message };
    case "TEAM_CODE_EXISTS":
    case "TEAM_HAS_CHILDREN":
      return { status: 409, error: message };
    case "INVALID_PARENT_TEAM":
      return { status: 400, error: message };
    default:
      return null;
  }
}

function mapPolicyError(message: string): { status: 404 | 409; error: string } | null {
  if (message.endsWith("_NOT_FOUND")) return { status: 404, error: message };
  return null;
}

const orgTeamDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  parentTeamId: z.string().uuid().nullable(),
  parent: z.object({ id: z.string().uuid(), name: z.string(), code: z.string() }).nullable(),
  cityIds: z.array(z.string()),
  zoneIds: z.array(z.string()),
  status: z.enum(["active", "inactive"]),
  memberCount: z.number().int(),
  childCount: z.number().int(),
  members: z.array(
    z.object({
      id: z.string().uuid(),
      adminUserId: z.string().uuid(),
      isPrimary: z.boolean(),
      adminUser: z.object({
        id: z.string().uuid(),
        fullName: z.string().nullable(),
        email: z.string(),
        status: z.string(),
      }),
    }),
  ),
  policy: z
    .object({
      id: z.string().uuid(),
      visibilityPolicyId: z.string().uuid().nullable(),
      approvalPolicyId: z.string().uuid().nullable(),
      workflowPolicyId: z.string().uuid().nullable(),
      slaPolicyId: z.string().uuid().nullable(),
      visibilityPolicy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      approvalPolicy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      workflowPolicy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      slaPolicy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      overrides: z.unknown().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const accessRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Catalogs ───────────────────────────────────────────────────────────
  app.get(
    "/access/scopes",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List access scope levels",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              level: z.enum(ACCESS_SCOPE_LEVELS),
              label: z.string(),
              description: z.string(),
              example: z.string(),
            }),
          ),
          ...authedErrorResponses,
        },
      },
    },
    async () => listScopeCatalog(),
  );

  app.get(
    "/access/permissions",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List permission catalog",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(z.object({ key: z.string(), description: z.string() })),
          ...authedErrorResponses,
        },
      },
    },
    async () => listPermissionCatalog(),
  );

  app.get(
    "/access/role-catalog",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "Recommended CRM role definitions",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              roleName: z.string(),
              category: z.string(),
              description: z.string(),
              defaultScope: z.string(),
              permissions: z.array(z.string()),
            }),
          ),
          ...authedErrorResponses,
        },
      },
    },
    async () => listRoleCatalog(),
  );

  // ── Roles (wrap existing service) ──────────────────────────────────────
  app.get(
    "/access/roles",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List assignable CRM roles",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(z.any()), ...authedErrorResponses },
      },
    },
    async (request) => {
      const roles = await adminRoleService.list(request.query);
      return roles.map(enrichRoleWithCatalog);
    },
  );

  // ── Org Teams ──────────────────────────────────────────────────────────
  app.get(
    "/access/teams",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List organization teams",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(orgTeamDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => orgTeamService.list(request.query),
  );

  app.post(
    "/access/teams",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Create an organization team",
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          code: z.string().min(1).max(40),
          parentTeamId: z.string().uuid().nullable().optional(),
          cityIds: z.array(z.string()).optional(),
          zoneIds: z.array(z.string()).optional(),
          status: z.enum(["active", "inactive"]).optional(),
        }),
        response: { 201: orgTeamDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        const team = await orgTeamService.create(request.body);
        return reply.code(201).send(team);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/access/teams/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "Get an organization team",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 200: orgTeamDtoSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.getById(request.params.id);
      } catch (err) {
        if (err instanceof Error && err.message === "TEAM_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/access/teams/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Update an organization team",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          code: z.string().min(1).max(40).optional(),
          parentTeamId: z.string().uuid().nullable().optional(),
          cityIds: z.array(z.string()).optional(),
          zoneIds: z.array(z.string()).optional(),
          status: z.enum(["active", "inactive"]).optional(),
        }),
        response: { 200: orgTeamDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.update(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/teams/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Delete an organization team",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 204: z.null(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        await orgTeamService.remove(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/access/teams/:id/members",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Add a member to an organization team",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          adminUserId: z.string().uuid(),
          isPrimary: z.boolean().optional(),
        }),
        response: { 200: orgTeamDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.addMember(
          request.params.id,
          request.body.adminUserId,
          request.body.isPrimary ?? true,
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/teams/:id/members/:adminUserId",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Remove a member from an organization team",
        security: [{ bearerAuth: [] }],
        params: teamMemberParams,
        response: { 200: orgTeamDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.removeMember(
          request.params.id,
          request.params.adminUserId,
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/access/teams/:id/policy",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "Get team policy assignment",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 200: z.any().nullable(), ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.getPolicy(request.params.id);
      } catch (err) {
        if (err instanceof Error && err.message === "TEAM_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.put(
    "/access/teams/:id/policy",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Assign policies to a team",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          visibilityPolicyId: z.string().uuid().nullable().optional(),
          approvalPolicyId: z.string().uuid().nullable().optional(),
          workflowPolicyId: z.string().uuid().nullable().optional(),
          slaPolicyId: z.string().uuid().nullable().optional(),
          overrides: z.record(z.string(), z.unknown()).nullable().optional(),
        }),
        response: { 200: z.any(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await orgTeamService.upsertPolicy(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapTeamError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  // ── Visibility policies ────────────────────────────────────────────────
  const visibilityDto = z.object({
    id: z.string().uuid(),
    name: z.string(),
    level: visibilityLevelSchema,
    config: z.unknown().nullable(),
    status: policyStatusSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  });

  app.get(
    "/access/visibility-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List visibility policies",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(visibilityDto), ...authedErrorResponses },
      },
    },
    async (request) => accessPolicyService.listVisibility(request.query),
  );

  app.post(
    "/access/visibility-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Create a visibility policy",
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          level: visibilityLevelSchema,
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 201: visibilityDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      const row = await accessPolicyService.createVisibility(request.body);
      return reply.code(201).send(row);
    },
  );

  app.patch(
    "/access/visibility-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Update a visibility policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          level: visibilityLevelSchema.optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 200: visibilityDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await accessPolicyService.updateVisibility(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/visibility-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Delete a visibility policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 204: z.null(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        await accessPolicyService.removeVisibility(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  // ── Approval policies ──────────────────────────────────────────────────
  const approvalDto = z.object({
    id: z.string().uuid(),
    name: z.string(),
    actionKey: z.string(),
    thresholdPaise: z.string().nullable(),
    approverRoleNames: z.array(z.string()),
    escalationRoleNames: z.array(z.string()),
    config: z.unknown().nullable(),
    status: policyStatusSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  });

  app.get(
    "/access/approval-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List approval policies",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(approvalDto), ...authedErrorResponses },
      },
    },
    async (request) => accessPolicyService.listApproval(request.query),
  );

  app.post(
    "/access/approval-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Create an approval policy",
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          actionKey: z.string().min(1).max(80),
          thresholdPaise: z.union([z.string(), z.number()]).nullable().optional(),
          approverRoleNames: z.array(z.string()).optional(),
          escalationRoleNames: z.array(z.string()).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 201: approvalDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      const row = await accessPolicyService.createApproval(request.body);
      return reply.code(201).send(row);
    },
  );

  app.patch(
    "/access/approval-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Update an approval policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          actionKey: z.string().min(1).max(80).optional(),
          thresholdPaise: z.union([z.string(), z.number()]).nullable().optional(),
          approverRoleNames: z.array(z.string()).optional(),
          escalationRoleNames: z.array(z.string()).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 200: approvalDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await accessPolicyService.updateApproval(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/approval-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Delete an approval policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 204: z.null(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        await accessPolicyService.removeApproval(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  // ── Workflow policies ──────────────────────────────────────────────────
  const workflowDto = z.object({
    id: z.string().uuid(),
    name: z.string(),
    version: z.number().int(),
    steps: z.unknown(),
    transitions: z.unknown(),
    status: policyStatusSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  });

  app.get(
    "/access/workflow-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List workflow policies",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(workflowDto), ...authedErrorResponses },
      },
    },
    async (request) => accessPolicyService.listWorkflow(request.query),
  );

  app.post(
    "/access/workflow-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Create a workflow policy",
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          version: z.number().int().positive().optional(),
          steps: z.array(z.unknown()).optional(),
          transitions: z.array(z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 201: workflowDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      const row = await accessPolicyService.createWorkflow(request.body);
      return reply.code(201).send(row);
    },
  );

  app.patch(
    "/access/workflow-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Update a workflow policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          version: z.number().int().positive().optional(),
          steps: z.array(z.unknown()).optional(),
          transitions: z.array(z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 200: workflowDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await accessPolicyService.updateWorkflow(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/workflow-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Delete a workflow policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 204: z.null(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        await accessPolicyService.removeWorkflow(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  // ── SLA policies ───────────────────────────────────────────────────────
  const slaDto = z.object({
    id: z.string().uuid(),
    name: z.string(),
    metricKey: z.string(),
    targetMinutes: z.number().int(),
    escalateAfterMinutes: z.number().int().nullable(),
    escalationRoleNames: z.array(z.string()),
    config: z.unknown().nullable(),
    status: policyStatusSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  });

  app.get(
    "/access/sla-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List SLA policies",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(slaDto), ...authedErrorResponses },
      },
    },
    async (request) => accessPolicyService.listSla(request.query),
  );

  app.post(
    "/access/sla-policies",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Create an SLA policy",
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(120),
          metricKey: z.string().min(1).max(80),
          targetMinutes: z.number().int().positive(),
          escalateAfterMinutes: z.number().int().positive().nullable().optional(),
          escalationRoleNames: z.array(z.string()).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 201: slaDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      const row = await accessPolicyService.createSla(request.body);
      return reply.code(201).send(row);
    },
  );

  app.patch(
    "/access/sla-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Update an SLA policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          metricKey: z.string().min(1).max(80).optional(),
          targetMinutes: z.number().int().positive().optional(),
          escalateAfterMinutes: z.number().int().positive().nullable().optional(),
          escalationRoleNames: z.array(z.string()).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          status: policyStatusSchema.optional(),
        }),
        response: { 200: slaDto, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await accessPolicyService.updateSla(request.params.id, request.body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/access/sla-policies/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(ACCESS_WRITE)],
      schema: {
        tags: ["Access Control"],
        summary: "Delete an SLA policy",
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: { 204: z.null(), ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        await accessPolicyService.removeSla(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapPolicyError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  // ── Audit ──────────────────────────────────────────────────────────────
  app.get(
    "/access/audit",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(AUDIT_READ)],
      schema: {
        tags: ["Access Control"],
        summary: "List audit log entries",
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          q: z.string().optional(),
          action: z.string().optional(),
          entityType: z.string().optional(),
          actorId: z.string().uuid().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          limit: z.coerce.number().int().positive().max(200).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                actorType: z.string(),
                actorId: z.string().uuid().nullable(),
                actorName: z.string().nullable(),
                actorRole: z.string().nullable(),
                action: z.string(),
                entityType: z.string().nullable(),
                entityId: z.string().uuid().nullable(),
                metadata: z.unknown().nullable(),
                ipAddress: z.string().nullable(),
                createdAt: z.coerce.date(),
              }),
            ),
            total: z.number().int(),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => accessPolicyService.listAudit(request.query),
  );
};
