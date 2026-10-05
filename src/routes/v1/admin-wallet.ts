import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { adminWalletRepository } from "../../repositories/admin-wallet-repository";

const earnerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  city: z.string(),
  jobs: z.number().int(),
  earningsPaise: z.number().int(),
});

export const adminWalletRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/wallet",
    {
      preHandler: requireAuth("admin"),
      schema: {
        tags: ["Admin Wallet"],
        summary: "Worker payout overview for today",
        description:
          "Today's captured worker earnings, pending payouts, captured payouts still on open jobs (escrow), and top earners.",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            todayEarningsPaise: z.number().int(),
            payoutsPendingPaise: z.number().int(),
            escrowPaise: z.number().int(),
            topEarners: z.array(earnerSchema),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async () => adminWalletRepository.getOverview(),
  );
};
