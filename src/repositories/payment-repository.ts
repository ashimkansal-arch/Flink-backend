import { Prisma } from "../generated/prisma/client";
import { db, readDb } from "../lib/prisma";
import { PaymentMethod, PaymentStatus } from "../generated/prisma/enums";

export interface CreatePaymentInput {
  bookingId: string;
  customerId: string;
  stripePaymentIntentId?: string;
  amountPaise: bigint;
  platformFeePaise: bigint;
  providerPayoutPaise: bigint;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  capturedAt?: Date;
}

export const paymentRepository = {
  create(data: CreatePaymentInput, tx: Prisma.TransactionClient = db) {
    return tx.payment.create({ data });
  },

  findByStripePaymentIntentId(id: string) {
    return readDb.payment.findFirst({ where: { stripePaymentIntentId: id } });
  },

  markCaptured(id: string, tx: Prisma.TransactionClient = db) {
    return tx.payment.update({ where: { id }, data: { status: "captured", capturedAt: new Date() } });
  },
};
