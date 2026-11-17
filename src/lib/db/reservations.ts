import { getServiceSupabase } from "../supabase/server";
import { getOrderItems } from "./order-items";
import { getExpiredPendingOrders, updateOrderStatus } from "./orders";

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
  const supabase = getServiceSupabase();
  const items = await getOrderItems(orderId);

  for (const item of items) {
    if (item.variant_id) {
      await supabase.rpc("release_variant", {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
      });
    }
  }
}

/**
 * On payment success: decrement both inventory and reserved for the order's items.
 */
export async function confirmReservation(orderId: number): Promise<void> {
  const supabase = getServiceSupabase();
  const items = await getOrderItems(orderId);

  for (const item of items) {
    if (item.variant_id) {
      await supabase.rpc("confirm_variant_sale", {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
      });
    }
  }
}

/**
 * Find and release all expired pending_payment orders.
 */
export async function cleanupExpiredReservations(): Promise<number> {
  const expired = await getExpiredPendingOrders();
  let cleaned = 0;

  for (const order of expired) {
    await releaseReservation(order.id);
    await updateOrderStatus(order.id, "expired");
    cleaned++;
  }

  return cleaned;
}
