-- Migration: Stripe checkout support
-- Date: 2026-04-05
-- Revised 2026-11-16, before it was ever applied: the three functions now
-- ignore a zero or negative quantity. Safe to run more than once.

-- Part 1: Schema changes

-- Add reserved column to plant_variants for inventory holds
ALTER TABLE plant_variants ADD COLUMN IF NOT EXISTS reserved INTEGER DEFAULT 0;

-- Add checkout fields to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_street TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_city TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_zip TEXT;

-- Part 2: RPC functions for atomic inventory operations

-- Reserve inventory: atomically increment reserved if stock available
CREATE OR REPLACE FUNCTION reserve_variant(p_variant_id INTEGER, p_quantity INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN FALSE;
  END IF;
  UPDATE plant_variants
  SET reserved = reserved + p_quantity
  WHERE id = p_variant_id
    AND inventory - reserved >= p_quantity;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Release reservation: decrement reserved
CREATE OR REPLACE FUNCTION release_variant(p_variant_id INTEGER, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN;
  END IF;
  UPDATE plant_variants
  SET reserved = GREATEST(reserved - p_quantity, 0)
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql;

-- Confirm sale: decrement both inventory and reserved
CREATE OR REPLACE FUNCTION confirm_variant_sale(p_variant_id INTEGER, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN;
  END IF;
  UPDATE plant_variants
  SET inventory = inventory - p_quantity,
      reserved = GREATEST(reserved - p_quantity, 0)
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql;
