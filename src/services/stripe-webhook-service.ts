import type Stripe from "stripe";
import { db } from "../lib/prisma";
import { paymentRepository } from "../repositories/payment-repository";
import { bookingRepository } from "../repositories/booking-repository";
import { notificationService } from "./notification-service";
import type { BookingPaymentIntentMetadata } from "./payment-service";

export const stripeWebhookService = {
  async handleEvent(event: Stripe.Event): Promise<void> {
    if (event.type !== "payment_intent.succeeded") return;

    const intent = event.data.object as Stripe.PaymentIntent;
    const metadata = intent.metadata as unknown as BookingPaymentIntentMetadata;

    if (metadata.purpose === "booking_payment") {
      await this.handleBookingPaymentSucceeded(metadata);
    }
  },

  // Idempotent on Payment.status: Stripe redelivers webhooks (at-least-once), and a booking's
  // payment can only be captured once. Skipping when it's already `captured` is what makes a
  // retried/duplicate delivery a no-op instead of double-crediting the provider payout.
  async handleBookingPaymentSucceeded(metadata: BookingPaymentIntentMetadata): Promise<void> {
    const payment = await db.payment.findUnique({ where: { id: metadata.paymentId } });
    if (!payment || payment.status !== "pending") return;

    await db.$transaction(async (tx) => {
      await paymentRepository.markCaptured(payment.id, tx);
      await bookingRepository.updateStatus(metadata.bookingId, "confirmed", tx);
    });

    notificationService.enqueue({
      recipientType: "customer",
      recipientId: metadata.customerId,
      channel: "push",
      templateKey: "booking.payment_confirmed",
      payload: { bookingId: metadata.bookingId },
    });
  },
};
