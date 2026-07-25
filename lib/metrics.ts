export type ProfitInput = {
  netRevenue: number;
  cogs?: number | null;
  shippingCost?: number | null;
  fees?: number | null;
  handlingFees?: number | null;
  taxes?: number | null;
  otherCosts?: number | null;
  adSpend?: number | null;
  chargebacks?: number | null;
};

const n = (value: number | null | undefined): number =>
  Number.isFinite(value) ? Number(value) : 0;

export function calculateProfit(input: ProfitInput): {
  totalCosts: number;
  netProfit: number;
  netMargin: number;
} {
  const totalCosts =
    n(input.cogs) +
    n(input.shippingCost) +
    n(input.fees) +
    n(input.handlingFees) +
    n(input.taxes) +
    n(input.otherCosts) +
    n(input.adSpend) +
    n(input.chargebacks);
  const netRevenue = n(input.netRevenue);
  const netProfit = netRevenue - totalCosts;
  const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  return { totalCosts, netProfit, netMargin };
}
