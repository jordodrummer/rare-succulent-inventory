import { timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { getStripe } from "./client";

/**
 * Order ids are sequential, so an id alone must not unlock an order. The
 * PaymentIntent client secret is known only to the browser that started the
 * checkout, and Stripe appends it to the return URL after payment.
 * Returns the PaymentIntent when the secret belongs to it, otherwise null.
 */
export async function getPaymentIntentForSecret(
  paymentIntentId: string | null,
  clientSecret: unknown
): Promise<Stripe.PaymentIntent | null> {
  if (!paymentIntentId || typeof clientSecret !== "string") return null;
  // Cheap shape check first, so guesses do not cost a Stripe API call.
  if (!clientSecret.startsWith(`${paymentIntentId}_secret_`)) return null;

  const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);
  if (!paymentIntent.client_secret) return null;

  const expected = Buffer.from(paymentIntent.client_secret);
  const given = Buffer.from(clientSecret);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  return paymentIntent;
}
