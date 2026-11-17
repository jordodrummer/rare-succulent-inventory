import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { getOrderByPaymentIntent, transitionOrderStatus } from "@/lib/db/orders";
import { confirmReservation } from "@/lib/db/reservations";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // payment_intent.payment_failed is deliberately not handled: a declined card
  // leaves the PaymentIntent payable, so the order stays pending and the
  // customer can retry until it expires.
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const order = await getOrderByPaymentIntent(paymentIntent.id);

    if (!order) {
      console.error("No order found for PaymentIntent:", paymentIntent.id);
    } else if (order.status === "expired") {
      // Expiry cancels the PaymentIntent first, so this should not happen.
      // If it does, money was taken for an order whose stock was released.
      console.error(
        `PaymentIntent ${paymentIntent.id} succeeded for expired order ${order.id}. Refund or fulfil it by hand.`
      );
    } else if (await transitionOrderStatus(order.id, "pending_payment", "confirmed")) {
      // Only the call that wins the status change records the sale, so a
      // redelivered event cannot decrement inventory twice.
      await confirmReservation(order.id);
    }
  }

  return NextResponse.json({ received: true });
}
