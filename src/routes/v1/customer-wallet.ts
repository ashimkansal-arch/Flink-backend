import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { walletService } from "../../services/wallet-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { paise } from "../../lib/money";

const walletTransactionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["credit", "debit"]),
  source: z.enum(["referral", "refund", "support_credit", "booking_payment", "topup"]),
  amountPaise: z.number().int(),
  balanceAfterPaise: z.number().int(),
  createdAt: z.string(),
});

const walletResponseSchema = z.object({
  balancePaise: z.number().int(),
  transactions: z.array(walletTransactionSchema),
});

type WalletTransaction = Awaited<ReturnType<typeof walletService.getWallet>>["transactions"][number];

function toTransactionDto(txn: WalletTransaction) {
  return {
    id: txn.id,
    type: txn.type,
    source: txn.source,
    amountPaise: paise(txn.amountPaise),
    balanceAfterPaise: paise(txn.balanceAfterPaise),
    createdAt: txn.createdAt.toISOString(),
  };
}

export const customerWalletRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/customer/wallet",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Wallet"],
        summary: "Get wallet balance and recent transactions",
        security: [{ bearerAuth: [] }],
        response: { ...authedErrorResponses, 200: walletResponseSchema },
      },
    },
    async (request) => {
      const wallet = await walletService.getWallet(request.auth!.id);
      return {
        balancePaise: paise(wallet.balancePaise),
        transactions: wallet.transactions.map(toTransactionDto),
      };
    },
  );

  app.post(
    "/customer/wallet/topup",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Wallet"],
        summary: "Credit the wallet immediately (payment gateway not wired yet)",
        security: [{ bearerAuth: [] }],
        body: z.object({ amountPaise: z.number().int().positive() }),
        response: {
          ...authedErrorResponses,
          201: z.object({
            balancePaise: z.number().int(),
            transaction: walletTransactionSchema,
          }),
        },
      },
    },
    async (request, reply) => {
      const transaction = await walletService.topup(request.auth!.id, BigInt(request.body.amountPaise));
      return reply.code(201).send({
        balancePaise: paise(transaction.balanceAfterPaise),
        transaction: toTransactionDto(transaction),
      });
    },
  );
};
