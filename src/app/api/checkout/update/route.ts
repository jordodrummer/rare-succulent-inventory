import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getShippingConfig } from "@/lib/db/shipping";
import { calculateShipping } from "@/lib/shipping/calculator";
import { getOrderById } from "@/lib/db/orders";
import { getOrderItems } from "@/lib/db/order-items";
import { dollarsToCents } from "@/lib/money";

type UpdateBody = {
  order_id: number;
  shipping_address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
};

export async function POST(request: Request) {
  try {
    const body: UpdateBody = await request.json();
    const { order_id, shipping_address } = body;

    if (!order_id || !shipping_address?.zip) {
      return NextResponse.json({ error: "order_id and shipping_address are required" }, { status: 400 });
    }
    if (!/^\d{5}$/.test(shipping_address.zip)) {
      return NextResponse.json({ error: "Invalid ZIP code" }, { status: 400 });
    }

    const order = await getOrderById(order_id);
    if (!order || order.status !== "pending_payment") {
      return NextResponse.json({ error: "Order not found or not pending" }, { status: 404 });
    }

    const orderItems = await getOrderItems(order_id);
    const variantIds = orderItems.map((i) => i.variant_id).filter((id): id is number => id !== null);

    const supabase = getServiceSupabase();
    const { data: variants, error } = await supabase
      .from("plant_variants")
      .select("id, variant_type, weight_lbs, weight_oz, shipping_override")
      .in("id", variantIds);

    if (error) throw error;

    const variantMap = new Map((variants ?? []).map((v) => [v.id, v]));

    const cartVariants = orderItems
      .filter((item) => item.variant_id && variantMap.has(item.variant_id))
      .map((item) => {
        const v = variantMap.get(item.variant_id!)!;
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
    const shippingResult = await calculateShipping(cartVariants, configs, shipping_address.zip);
    if (shippingResult.quoteFailed) {
      return NextResponse.json(
        { error: "We could not get a shipping rate right now. Please try again." },
        { status: 503 }
      );
    }
    const shippingCost = shippingResult.total;

    const itemsTotal = orderItems.reduce((sum, i) => sum + dollarsToCents(i.price_each) * i.quantity, 0);
    const totalAmount = itemsTotal + shippingCost;

    const stripe = getStripe();
    await stripe.paymentIntents.update(order.stripe_payment_intent_id!, {
      amount: totalAmount,
    });

    await supabase
      .from("orders")
      .update({
        shipping_cost: shippingCost,
        shipping_address_street: shipping_address.street,
        shipping_address_city: shipping_address.city,
        shipping_address_state: shipping_address.state,
        shipping_address_zip: shipping_address.zip,
        updated_on: new Date().toISOString(),
      })
      .eq("id", order_id);

    return NextResponse.json({
      shipping_cost: shippingCost,
      total: totalAmount,
      shipping_breakdown: shippingResult.breakdown,
    });
  } catch (err) {
    console.error("Checkout update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
