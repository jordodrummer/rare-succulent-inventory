// Catalog prices (plant_variants.price, order_details.price_each) are stored in
// dollars. Stripe amounts and shipping costs are in cents.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
