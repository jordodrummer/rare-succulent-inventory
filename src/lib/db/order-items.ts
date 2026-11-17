import { getServiceSupabase } from "../supabase/server";
import type { OrderDetail } from "../types";

export async function getOrderItems(orderId: number): Promise<OrderDetail[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("order_details")
    .select("*")
    .eq("order_id", orderId);

  if (error) throw error;
  return data ?? [];
}

export async function createOrderItem(
  orderId: number,
  plantId: number,
  variantId: number,
  priceEach: number,
  quantity: number
): Promise<OrderDetail> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("order_details")
    .insert({
      order_id: orderId,
      plant_id: plantId,
      variant_id: variantId,
      price_each: priceEach,
      quantity,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Insert all of an order's items in one statement, so the order ends up with
 * every item or none.
 */
export async function createOrderItems(
  orderId: number,
  items: { plant_id: number; variant_id: number; price_each: number; quantity: number }[]
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("order_details")
    .insert(items.map((item) => ({ order_id: orderId, ...item })));

  if (error) throw error;
}

export async function deleteOrderItem(id: number): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { error, count } = await supabase
    .from("order_details")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw error;
  return (count ?? 0) > 0;
}
