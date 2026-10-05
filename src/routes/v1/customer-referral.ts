import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { referralService } from "../../services/referral-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { paise } from "../../lib/money";

const referralSchema = z.object({
  id: z.string().uuid(),
  referredUser: z.object({ fullName: z.string().nullable(), phoneNumber: z.string() }).nullable(),
  bonusPaise: z.number().int(),
  status: z.enum(["pending", "credited", "expired"]),
  createdAt: z.string(),
});

const referralSummarySchema = z.object({
  referralCode: z.string().nullable(),
  referrals: z.array(referralSchema),
});

export const customerReferralRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/customer/referral",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Referral"],
        summary: "Get the customer's referral code and referral history",
        security: [{ bearerAuth: [] }],
        response: { ...authedErrorResponses, 200: referralSummarySchema },
      },
    },
    async (request) => {
      const summary = await referralService.getReferralSummary(request.auth!.id);
      return {
        referralCode: summary.referralCode,
        referrals: summary.referrals.map((referral) => ({
          id: referral.id,
          referredUser: referral.referred
            ? { fullName: referral.referred.fullName, phoneNumber: referral.referred.phoneNumber }
            : null,
          bonusPaise: paise(referral.bonusPaise),
          status: referral.status,
          createdAt: referral.createdAt.toISOString(),
        })),
      };
    },
  );
};
