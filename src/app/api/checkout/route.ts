import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getShippingConfig } from "@/lib/db/shipping";
import { calculateShipping } from "@/lib/shipping/calculator";
import { createCheckoutOrder, getOrderById, updateOrderStatus } from "@/lib/db/orders";
import { createOrderItems } from "@/lib/db/order-items";
import { cleanupExpiredReservations, expireOrder, releaseItems, reserveInventory } from "@/lib/db/reservations";
import { dollarsToCents } from "@/lib/money";
import { getPaymentIntentForSecret } from "@/lib/stripe/order-access";

type CheckoutItem = {
  variant_id: number;
  quantity: number;
};

type PreviousCheckout = {
  order_id: number;
  client_secret: string;
};

type CheckoutBody = {
  items: CheckoutItem[];
  previous?: PreviousCheckout;
  guest_name: string;
  guest_email: string;
  shipping_method?: "ship" | "pickup";
  shipping_address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
};

// Checkout makes several Stripe, Shippo and Supabase calls in a row. Give it
// room so the platform never kills it while stock is held.
export const maxDuration = 60;

// A customer who reloads or comes back from the payment step still holds stock
// under their earlier order. Expire that order so they are not blocked by
// their own hold. The client secret proves the order is theirs.
async function releasePreviousCheckout(previous: PreviousCheckout) {
  try {
    if (!Number.isInteger(previous?.order_id)) return;
    const order = await getOrderById(previous.order_id);
    if (!order || order.status !== "pending_payment") return;
    if (!(await getPaymentIntentForSecret(order.stripe_payment_intent_id, previous.client_secret))) return;
    await expireOrder(order);
  } catch (err) {
    console.error("Could not release the previous checkout:", err);
  }
}

// Give back everything a failed checkout took. Items are inserted in one
// statement and nothing can fail after that, so an order that reaches this
// point has no items for the expiry cleanup to release: the holds have to be
// released here. Each step is independent so one failure does not strand the rest.
async function undoCheckout(
  holds: { variant_id: number; quantity: number }[],
  paymentIntentId: string | null,
  orderId: number | null
) {
  if (orderId !== null) {
    try {
      await updateOrderStatus(orderId, "expired");
    } catch (err) {
      console.error(`Could not expire order ${orderId} after a failed checkout:`, err);
    }
  }

  try {
    await releaseItems(holds);
  } catch (err) {
    console.error("Could not release stock after a failed checkout:", err);
  }

  if (paymentIntentId !== null) {
    try {
      await getStripe().paymentIntents.cancel(paymentIntentId);
    } catch (err) {
      console.error(`Could not cancel PaymentIntent ${paymentIntentId}:`, err);
    }
  }
}

export async function POST(request: Request) {
  try {
    const body: CheckoutBody = await request.json();
    const { items, guest_name, guest_email, shipping_address } = body;
    const isPickup = body.shipping_method === "pickup";

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }
    // Quantities come from the client. A zero, negative or fractional quantity
    // would pass the stock check below and lower the total.
    for (const item of items) {
      if (!Number.isInteger(item?.variant_id) || !Number.isInteger(item?.quantity) || item.quantity < 1) {
        return NextResponse.json({ error: "Invalid cart item" }, { status: 400 });
      }
    }
    if (new Set(items.map((i) => i.variant_id)).size !== items.length) {
      return NextResponse.json({ error: "Duplicate cart item" }, { status: 400 });
    }
    if (typeof guest_name !== "string" || typeof guest_email !== "string" || !guest_name.trim() || !guest_email.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }
    if (guest_name.length > 200 || guest_email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
      return NextResponse.json({ error: "Invalid name or email" }, { status: 400 });
    }
    if (!isPickup) {
      if (!shipping_address?.street || !shipping_address?.city || !shipping_address?.state || !shipping_address?.zip) {
        return NextResponse.json({ error: "Complete shipping address is required" }, { status: 400 });
      }
      if (!/^\d{5}$/.test(shipping_address.zip)) {
        return NextResponse.json({ error: "Invalid ZIP code" }, { status: 400 });
      }
    }

    if (body.previous) {
      await releasePreviousCheckout(body.previous);
    }

    // The Vercel cron only runs once a day, so release stock held by abandoned
    // checkouts here, right before availability is checked. The budget keeps a
    // backlog from holding up this customer.
    try {
      await cleanupExpiredReservations(4000);
    } catch (err) {
      console.error("Reservation cleanup failed:", err);
    }

    // Fetch variant details for price verification and shipping calc
    const variantIds = items.map((i) => i.variant_id);
    const supabase = getServiceSupabase();
    const { data: variants, error: variantError } = await supabase
      .from("plant_variants")
      .select("id, plant_id, variant_type, price, inventory, reserved, weight_lbs, weight_oz, shipping_override")
      .in("id", variantIds);

    if (variantError) throw variantError;

    const variantMap = new Map((variants ?? []).map((v) => [v.id, v]));

    // Validate all variants exist and have sufficient stock
    for (const item of items) {
      const variant = variantMap.get(item.variant_id);
      if (!variant) {
        return NextResponse.json({ error: `Variant ${item.variant_id} not found` }, { status: 400 });
      }
      if (variant.inventory - variant.reserved < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for variant ${item.variant_id}` },
          { status: 409 }
        );
      }
    }

    // Calculate item total in cents (server-side, from DB prices in dollars)
    let itemsTotal = 0;
    for (const item of items) {
      const variant = variantMap.get(item.variant_id)!;
      itemsTotal += dollarsToCents(variant.price) * item.quantity;
    }

    // Calculate shipping (free for local pickup)
    let shippingCost = 0;
    let shippingBreakdown: { description: string; amount: number }[] = [];

    if (isPickup) {
      shippingBreakdown = [{ description: "Local pickup", amount: 0 }];
    } else {
      const cartVariants = items.map((item) => {
        const v = variantMap.get(item.variant_id)!;
        return {
          variant_id: v.id,
          variant_type: v.variant_type,
          quantity: item.quantity,
          weight_lbs: v.weight_lbs ?? 0,
          weight_oz: v.weight_oz ?? 0,
          shipping_override: v.shipping_override,
        };
      });

      const configs = await getShippingConfig();
      const shippingResult = await calculateShipping(cartVariants, configs, shipping_address!.zip);
      if (shippingResult.quoteFailed) {
        return NextResponse.json(
          { error: "We could not get a shipping rate right now. Please try again." },
          { status: 503 }
        );
      }
      shippingCost = shippingResult.total;
      shippingBreakdown = shippingResult.breakdown;
    }

    // Total in cents
    const totalAmount = itemsTotal + shippingCost;

    // Fails here, before any stock is held, if Stripe is not configured.
    const stripe = getStripe();

    // Reserve inventory only now, so a failed quote above never leaves a hold
    const holds = items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));
    const reserved = await reserveInventory(holds);
    if (!reserved) {
      return NextResponse.json(
        { error: "Could not reserve inventory. Some items may no longer be available." },
        { status: 409 }
      );
    }

    // From here on stock is held, so any failure has to give it back.
    let paymentIntentId: string | null = null;
    let orderId: number | null = null;

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: "usd",
        receipt_email: guest_email,
        metadata: {
          guest_name,
          guest_email,
        },
      });
      paymentIntentId = paymentIntent.id;

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const order = await createCheckoutOrder({
        guest_name,
        guest_email,
        stripe_payment_intent_id: paymentIntent.id,
        shipping_cost: shippingCost,
        expires_at: expiresAt,
        shipping_address_street: shipping_address?.street ?? "",
        shipping_address_city: shipping_address?.city ?? "",
        shipping_address_state: shipping_address?.state ?? "",
        shipping_address_zip: shipping_address?.zip ?? "",
      });
      orderId = order.id;

      await createOrderItems(
        order.id,
        items.map((item) => {
          const variant = variantMap.get(item.variant_id)!;
          return {
            plant_id: variant.plant_id,
            variant_id: item.variant_id,
            price_each: variant.price,
            quantity: item.quantity,
          };
        })
      );

      return NextResponse.json({
        client_secret: paymentIntent.client_secret,
        order_id: order.id,
        items_total: itemsTotal,
        shipping_cost: shippingCost,
        total: totalAmount,
        shipping_breakdown: shippingBreakdown,
      });
    } catch (err) {
      await undoCheckout(holds, paymentIntentId, orderId);
      throw err;
    }
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
