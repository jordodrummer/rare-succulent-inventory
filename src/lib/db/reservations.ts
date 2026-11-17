import { getServiceSupabase } from "../supabase/server";
import Stripe from "stripe";
import { getStripe } from "../stripe/client";
import type { Order } from "../types";
import { getOrderItems } from "./order-items";
import { getExpiredPendingOrders, transitionOrderStatus } from "./orders";

type ReservationItem = {
  variant_id: number;
  quantity: number;
};

/**
 * Atomically reserve inventory for a list of items.
 * Uses PostgreSQL rpc for atomicity: only reserves if quantity - reserved >= requested.
 * Returns true if all items were reserved, false if any failed (and rolls back all).
 */
export async function reserveInventory(items: ReservationItem[]): Promise<boolean> {
  const supabase = getServiceSupabase();
  const reserved: ReservationItem[] = [];

  for (const item of items) {
    const { data: result, error: rpcError } = await supabase.rpc("reserve_variant", {
      p_variant_id: item.variant_id,
      p_quantity: item.quantity,
    });

    if (rpcError || !result) {
      // Rollback previously reserved items
      for (const prev of reserved) {
        await supabase.rpc("release_variant", {
          p_variant_id: prev.variant_id,
          p_quantity: prev.quantity,
        });
      }
      return false;
    }

    reserved.push(item);
  }

  return true;
}

/**
 * Release holds by item list. Used when checkout fails after reserving but
 * before the order and all of its items exist, so there is no complete order
 * to release from.
 */
export async function releaseItems(items: ReservationItem[]): Promise<void> {
  const supabase = getServiceSupabase();

  for (const item of items) {
    const { error } = await supabase.rpc("release_variant", {
      p_variant_id: item.variant_id,
      p_quantity: item.quantity,
    });
    if (error) {
      console.error(`Could not release ${item.quantity} of variant ${item.variant_id}:`, error);
    }
  }
}

/**
 * Release reserved inventory for an order's items.
 */
export async function releaseReservation(orderId: number): Promise<void> {
  const items = await getOrderItems(orderId);
  await releaseItems(
    items
      .filter((item) => item.variant_id !== null)
      .map((item) => ({ variant_id: item.variant_id!, quantity: item.quantity }))
  );
}

/**
 * On payment success: decrement both inventory and reserved for the order's items.
 */
export async function confirmReservation(orderId: number): Promise<void> {
  const supabase = getServiceSupabase();
  const items = await getOrderItems(orderId);

  for (const item of items) {
    if (item.variant_id) {
      const { error } = await supabase.rpc("confirm_variant_sale", {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
      });
      if (error) {
        console.error(`Could not record the sale of variant ${item.variant_id} for order ${orderId}:`, error);
      }
    }
  }
}

// A live key cannot see a test-mode PaymentIntent, which is what a checkout
// started from local dev against the same database leaves behind. No real
// money can be taken on it, so its stock can be released without a cancel.
// A test key that cannot see a live PaymentIntent must leave the order alone.
function isUnseenTestIntent(err: unknown): boolean {
  const liveKey = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
  return liveKey && err instanceof Stripe.errors.StripeError && err.code === "resource_missing";
}

/**
 * Expire one pending order: cancel its PaymentIntent so it can no longer be
 * paid, then release its stock. Returns whether it was expired.
 */
export async function expireOrder(order: Pick<Order, "id" | "stripe_payment_intent_id">): Promise<boolean> {
  let paymentIntent: Stripe.PaymentIntent | null = null;
  if (order.stripe_payment_intent_id) {
    try {
      paymentIntent = await getStripe().paymentIntents.retrieve(order.stripe_payment_intent_id);
    } catch (err) {
      if (!isUnseenTestIntent(err)) throw err;
    }
  }

  if (paymentIntent) {
    if (paymentIntent.status === "succeeded") {
      // Paid, but the webhook has not confirmed it. Confirm it here instead
      // of expiring an order the customer was charged for.
      if (await transitionOrderStatus(order.id, "pending_payment", "confirmed")) {
        await confirmReservation(order.id);
      }
      return false;
    }
    if (paymentIntent.status === "processing" || paymentIntent.status === "requires_capture") {
      // Payment is in flight. Leave the order for the webhook or the next run.
      return false;
    }
    if (paymentIntent.status !== "canceled") {
      // Throws if the payment went through in the meantime, which leaves the
      // order pending for the webhook.
      await getStripe().paymentIntents.cancel(paymentIntent.id);
    }
  }

  if (!(await transitionOrderStatus(order.id, "pending_payment", "expired"))) {
    return false;
  }
  await releaseReservation(order.id);
  return true;
}

/**
 * Find and release expired pending_payment orders. With a budget it stops
 * starting new orders once the time is used up and leaves the rest to the
 * next run, so a caller on a request path is not held up by a backlog.
 */
export async function cleanupExpiredReservations(budgetMs?: number): Promise<number> {
  const deadline = budgetMs === undefined ? Infinity : Date.now() + budgetMs;
  const expired = await getExpiredPendingOrders();
  let cleaned = 0;

  for (const order of expired) {
    if (Date.now() > deadline) break;
    try {
      if (await expireOrder(order)) cleaned++;
    } catch (err) {
      console.error(`Could not expire order ${order.id}:`, err);
    }
  }

  return cleaned;
}
