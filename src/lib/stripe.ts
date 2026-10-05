import Stripe from "stripe";

// Lazily read the key (server.ts guarantees process.env is fully populated — including any
// secrets-manager values — before this module's first use), matching the accessSecret()/
// refreshSecret() pattern in src/lib/auth/jwt.ts rather than reading process.env at import time.
let client: Stripe | undefined;

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  }
  return client;
}

export function stripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET as string;
}
