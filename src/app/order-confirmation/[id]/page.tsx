import Link from "next/link";
import ClearCartOnMount from "./clear-cart";
import { notFound } from "next/navigation";
import { getOrderForConfirmation } from "@/lib/db/orders";
import { getOrderItems } from "@/lib/db/order-items";
import { expireOrder } from "@/lib/db/reservations";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dollarsToCents } from "@/lib/money";
import { getPaymentIntentForSecret } from "@/lib/stripe/order-access";
import { Button } from "@/components/ui/button";

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment_intent_client_secret?: string | string[] }>;
};

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();

  // Stripe adds the client secret to the return URL. Without it this page
  // would show a name, email and address to anyone who guesses an order id.
  const { payment_intent_client_secret: clientSecret } = await searchParams;
  const order = await getOrderForConfirmation(orderId);
  const paymentIntent = order
    ? await getPaymentIntentForSecret(order.stripe_payment_intent_id, clientSecret)
    : null;
  if (!order || !paymentIntent) notFound();

  const paid = paymentIntent.status === "succeeded";
  if (!paid && paymentIntent.status !== "processing") {
    // The order still holds its stock. Expire it now, otherwise the customer's
    // retry from the cart is refused because of their own hold.
    if (paymentIntent.status === "requires_payment_method" || paymentIntent.status === "canceled") {
      try {
        await expireOrder(order);
      } catch (err) {
        console.error(`Could not release order ${order.id} after a failed payment:`, err);
      }
    }
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <h1 className="text-3xl font-bold mb-2">Payment not completed</h1>
        <p className="text-muted-foreground mb-8">
          Your payment did not go through and you have not been charged. Your cart is still saved.
        </p>
        <Button render={<Link href="/cart" />} variant="outline">
          Back to Cart
        </Button>
      </div>
    );
  }

  const items = await getOrderItems(orderId);

  // Fetch plant names for display
  const supabase = getServiceSupabase();
  const plantIds = [...new Set(items.map((i) => i.plant_id))];
  const { data: plants } = await supabase
    .from("plants")
    .select("id, cultivar_name")
    .in("id", plantIds);

  const plantMap = new Map((plants ?? []).map((p) => [p.id, p.cultivar_name]));

  const itemsTotal = items.reduce((sum, i) => sum + dollarsToCents(i.price_each) * i.quantity, 0);
  const shippingCost = order.shipping_cost ?? 0;
  const total = itemsTotal + shippingCost;

  return (
    <div className="max-w-lg mx-auto py-16 text-center">
      <ClearCartOnMount />
      <h1 className="text-3xl font-bold mb-2">{paid ? "Order Confirmed!" : "Payment Processing"}</h1>
      <p className="text-muted-foreground mb-8">
        Thank you{order.guest_name ? `, ${order.guest_name}` : ""}.{" "}
        {paid
          ? `Your order #${order.id} has been placed.`
          : `Your order #${order.id} will be confirmed as soon as your payment clears.`}
      </p>

      <div className="rounded-lg border p-6 text-left space-y-4 mb-8">
        <h2 className="font-semibold">Items</h2>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {plantMap.get(item.plant_id) ?? "Unknown"} x{item.quantity}
              </span>
              <span>{formatPrice(dollarsToCents(item.price_each) * item.quantity)}</span>
            </div>
          ))}
        </div>

        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatPrice(itemsTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span>{formatPrice(shippingCost)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>

        <div className="border-t pt-2">
          {order.shipping_address_street ? (
            <>
              <p className="text-sm text-muted-foreground mb-1">Shipping to:</p>
              <p className="text-sm">
                {order.shipping_address_street}<br />
                {order.shipping_address_city}, {order.shipping_address_state} {order.shipping_address_zip}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Local pickup</p>
          )}
        </div>

        {order.guest_email && (
          <p className="text-sm text-muted-foreground border-t pt-2">
            A receipt has been sent to {order.guest_email}.
          </p>
        )}
      </div>

      <Button render={<Link href="/products" />} variant="outline">
        Continue Shopping
      </Button>
    </div>
  );
}
