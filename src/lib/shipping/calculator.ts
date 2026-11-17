import type { ShippingConfig } from "../types";
import { getShippingProvider } from "./provider";

type CartVariant = {
  variant_id: number;
  variant_type: string;
  quantity: number;
  weight_lbs: number;
  weight_oz: number;
  shipping_override: number | null;
};

type ShippingBreakdown = {
  description: string;
  amount: number;
};

type ShippingResult = {
  breakdown: ShippingBreakdown[];
  total: number;
  // True when a real-time rate was needed but could not be obtained. The
  // total then leaves that part out, so it must not be charged as is.
  quoteFailed: boolean;
};

const DEFAULT_WEIGHT_OZ = 8;

export async function calculateShipping(
  items: CartVariant[],
  configs: ShippingConfig[],
  destinationZip: string
): Promise<ShippingResult> {
  const configMap = new Map(configs.map((c) => [c.variant_type, c]));
  const breakdown: ShippingBreakdown[] = [];
  let quoteFailed = false;

  // Items with shipping_override pay their override amount
  const overrideItems = items.filter((i) => i.shipping_override != null);
  for (const item of overrideItems) {
    const amount = item.shipping_override! * item.quantity;
    breakdown.push({
      description: `Shipping override (${item.variant_type.replace(/_/g, " ")}, qty ${item.quantity})`,
      amount,
    });
  }

  // Remaining items grouped by config method
  const remaining = items.filter((i) => i.shipping_override == null);

  // Flat rate items grouped by variant type
  const flatGroups = new Map<string, { config: ShippingConfig; totalQty: number }>();
  const realtimeItems: CartVariant[] = [];

  for (const item of remaining) {
    const config = configMap.get(item.variant_type as import("../types").VariantType);
    if (!config || config.method === "realtime") {
      realtimeItems.push(item);
    } else {
      const existing = flatGroups.get(item.variant_type);
      if (existing) {
        existing.totalQty += item.quantity;
      } else {
        flatGroups.set(item.variant_type, { config, totalQty: item.quantity });
      }
    }
  }

  // Calculate flat rate totals
  for (const [variantType, { config, totalQty }] of flatGroups) {
    const base = config.base_price ?? 0;
    const additional = config.additional_price ?? 0;
    const amount = base + additional * (totalQty - 1);
    breakdown.push({
      description: `${variantType.replace(/_/g, " ")} (${totalQty})`,
      amount,
    });
  }

  // Calculate realtime rates
  if (realtimeItems.length > 0) {
    const totalWeightOz = realtimeItems.reduce((sum, item) => {
      const itemWeight = item.weight_lbs * 16 + item.weight_oz;
      const weight = itemWeight > 0 ? itemWeight : DEFAULT_WEIGHT_OZ;
      return sum + weight * item.quantity;
    }, 0);

    const originZip = process.env.ORIGIN_ZIP;
    if (!originZip) {
      quoteFailed = true;
      breakdown.push({ description: "Real-time shipping (origin ZIP not configured)", amount: 0 });
    } else {
      try {
        const provider = getShippingProvider();
        const rates = await provider.getRates({
          origin_zip: originZip,
          destination_zip: destinationZip,
          weight_oz: totalWeightOz,
        });

        if (rates.length > 0) {
          const cheapest = rates[0];
          breakdown.push({
            description: `${cheapest.service} (${cheapest.estimated_days} days)`,
            amount: cheapest.rate,
          });
        } else {
          quoteFailed = true;
          breakdown.push({ description: "No USPS rates available", amount: 0 });
        }
      } catch {
        quoteFailed = true;
        breakdown.push({ description: "Real-time rates unavailable, please try again", amount: 0 });
      }
    }
  }

  const total = breakdown.reduce((sum, b) => sum + b.amount, 0);
  return { breakdown, total, quoteFailed };
}
