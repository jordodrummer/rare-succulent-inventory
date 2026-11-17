import { getServiceSupabase } from "../supabase/server";
import type { Order, OrderStatus } from "../types";

export async function getOrders(): Promise<Order[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*");

  if (error) throw error;
  return data ?? [];
}

export async function getOrderById(id: number): Promise<Order | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function createOrder(customerId: number): Promise<Order> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .insert({ customer_id: customerId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateOrderStatus(id: number, status: string): Promise<Order | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .update({ status, updated_on: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

/**
 * Move an order to a new status only if it is still in the expected one.
 * Returns whether this call made the change, so the webhook and the expiry
 * cleanup cannot both act on the same order.
 */
export async function transitionOrderStatus(id: number, from: OrderStatus, to: OrderStatus): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: to, updated_on: new Date().toISOString() })
    .eq("id", id)
    .eq("status", from)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function deleteOrder(id: number): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "deleted", updated_on: new Date().toISOString() })
    .eq("id", id)
    .select();

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

type CreateCheckoutOrderParams = {
  customer_id?: number;
  guest_name?: string;
  guest_email?: string;
  stripe_payment_intent_id: string;
  shipping_cost: number;
  expires_at: string;
  shipping_address_street: string;
  shipping_address_city: string;
  shipping_address_state: string;
  shipping_address_zip: string;
};

export async function createCheckoutOrder(params: CreateCheckoutOrderParams): Promise<Order> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: params.customer_id ?? null,
      guest_name: params.guest_name ?? null,
      guest_email: params.guest_email ?? null,
      stripe_payment_intent_id: params.stripe_payment_intent_id,
      shipping_cost: params.shipping_cost,
      expires_at: params.expires_at,
      shipping_address_street: params.shipping_address_street,
      shipping_address_city: params.shipping_address_city,
      shipping_address_state: params.shipping_address_state,
      shipping_address_zip: params.shipping_address_zip,
      status: "pending_payment",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOrderByPaymentIntent(paymentIntentId: string): Promise<Order | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getOrderForConfirmation(id: number): Promise<{
  id: number;
  status: string;
  stripe_payment_intent_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  shipping_cost: number | null;
  shipping_address_street: string | null;
  shipping_address_city: string | null;
  shipping_address_state: string | null;
  shipping_address_zip: string | null;
  created_on: Date;
} | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, stripe_payment_intent_id, guest_name, guest_email, shipping_cost, shipping_address_street, shipping_address_city, shipping_address_state, shipping_address_zip, created_on")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function updateOrderShipping(id: number, shippingCost: number, paymentIntentId: string): Promise<Order | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .update({
      shipping_cost: shippingCost,
      stripe_payment_intent_id: paymentIntentId,
      updated_on: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getExpiredPendingOrders(): Promise<Order[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "pending_payment")
    .lt("expires_at", new Date().toISOString());

  if (error) throw error;
  return data ?? [];
}
