import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { customerProfileService } from "../../services/customer-profile-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, genderSchema } from "../../lib/auth/schemas";
import {
  confirmLocationBodySchema,
  customerAddressDtoSchema,
  homeProfileSchema,
  homeSizeSchema,
  homeTypeSchema,
  meHomeProfileSchema,
  petTypeSchema,
} from "../../lib/api-schemas";

const confirmLocationResponseSchema = z.object({
  addressId: z.string().uuid(),
  isServiceable: z.boolean(),
  address: customerAddressDtoSchema,
});

const customerDetailsBodySchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  gender: z.enum(["male", "female", "other"]),
});

const customerDetailsResponseSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  gender: genderSchema,
  phoneNumber: z.string(),
  updatedAt: z.coerce.date(),
});

const optionalSelfieRef = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value) || value.includes("/")) return value;
    return undefined;
  });

const homeDetailsBodySchema = z.object({
  homeType: homeTypeSchema,
  homeSize: homeSizeSchema,
  floorNumber: z.number().int().min(0).max(200).optional(),
  adultsCount: z.number().int().min(0).max(30).default(0),
  childrenCount: z.number().int().min(0).max(30).default(0),
  seniorsCount: z.number().int().min(0).max(30).default(0),
  hasFemaleMember: z.boolean(),
  liveSelfieUrl: optionalSelfieRef,
  hasPets: z.boolean().default(false),
  petType: petTypeSchema.optional(),
  petCount: z.number().int().min(0).max(30).optional(),
});

function replyAddressError(reply: FastifyReply, err: unknown) {
  if (err instanceof Error && err.message === "ADDRESS_NOT_FOUND") {
    return reply.code(404).send({ error: err.message });
  }
  throw err;
}

export const customerProfileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/customer/addresses",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "List saved customer addresses (Home / Work chips)",
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(customerAddressDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => customerProfileService.listAddresses(request.auth!.id),
  );

  app.post(
    "/customer/location/confirm",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "Create or update a customer address from Places (Confirm Location)",
        description:
          "Accepts Places lat/lng plus optional street, locality, city, state, pincode, and formatted `address`. " +
          "`label` defaults to Home. Omit `addressId` to create a new address; send `addressId` to update that saved address. " +
          "The first address is marked default automatically. `line1`/`line2` remain accepted as aliases for street/locality.",
        security: [{ bearerAuth: [] }],
        body: confirmLocationBodySchema,
        response: { ...authedErrorResponses, 200: confirmLocationResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { address, isServiceable } = await customerProfileService.confirmLocation(
          request.auth!.id,
          request.body,
        );
        return { addressId: address.id, isServiceable, address };
      } catch (err) {
        return replyAddressError(reply, err);
      }
    },
  );

  app.post(
    "/customer/addresses/:addressId/default",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "Mark a saved address as the default home location",
        security: [{ bearerAuth: [] }],
        params: z.object({ addressId: z.string().uuid() }),
        response: { ...authedErrorResponses, 200: customerAddressDtoSchema },
      },
    },
    async (request, reply) => {
      try {
        return await customerProfileService.setDefaultAddress(request.auth!.id, request.params.addressId);
      } catch (err) {
        return replyAddressError(reply, err);
      }
    },
  );

  app.post(
    "/customer/profile",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "Save customer name, email, and gender",
        description: "Used during onboarding or profile edit. Overwrites existing values.",
        security: [{ bearerAuth: [] }],
        body: customerDetailsBodySchema,
        response: { ...authedErrorResponses, 200: customerDetailsResponseSchema },
      },
    },
    async (request) => customerProfileService.updateDetails(request.auth!.id, request.body),
  );

  app.get(
    "/customer/profile/home-details",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "Get the customer's home profile",
        security: [{ bearerAuth: [] }],
        response: { ...authedErrorResponses, 200: meHomeProfileSchema },
      },
    },
    async (request) => customerProfileService.getHomeDetails(request.auth!.id),
  );

  app.post(
    "/customer/profile/home-details",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Profile"],
        summary: "Set up the customer's home profile (Set Up Your Home)",
        description:
          "Home type, size, floor, occupants, and female-at-home. liveSelfieUrl and pets are optional and can be omitted.",
        security: [{ bearerAuth: [] }],
        body: homeDetailsBodySchema,
        response: { ...authedErrorResponses, 200: homeProfileSchema },
      },
    },
    async (request) => customerProfileService.setHomeDetails(request.auth!.id, request.body),
  );
};
