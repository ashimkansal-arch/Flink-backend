import Stripe from "stripe";
import { stripe, stripeWebhookSecret } from "../lib/stripe";

// Stripe amounts are integers in the currency's smallest unit — for INR that's paise, which is
// exactly what *_paise columns already store, so no conversion is needed here.
const CURRENCY = "inr";

// The index signature is what makes these assignable to Stripe's MetadataParam
// (Record<string, string>) below — every field here is already a string, so it costs nothing.
export interface BookingPaymentIntentMetadata {
  [key: string]: string;
  purpose: "booking_payment";
  bookingId: string;
  paymentId: string;
  customerId: string;
}

export const paymentService = {
  async createBookingPaymentIntent(amountPaise: bigint, metadata: BookingPaymentIntentMetadata) {
    return stripe().paymentIntents.create({
      amount: Number(amountPaise),
      currency: CURRENCY,
      metadata,
    });
  },

  // Verifies the signature against the *raw* request bytes (request.rawBody, see app.ts) —
  // Stripe's signature is computed over the exact bytes it sent, not a re-serialized JSON object.
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return stripe().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
  },
};
