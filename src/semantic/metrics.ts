// The semantic layer: every metric is defined once, here.
// An AI assistant can only ask for these metrics and dimensions, never write SQL.

export type Fact = "sales" | "ads";
export type Dimension = "day" | "week" | "month" | "market" | "channel" | "category" | "sku" | "ad_channel";
export type Filter = Partial<Record<"market" | "channel" | "category" | "sku" | "ad_channel", string>>;

export type MetricDef = {
  name: string;
  description: string;
  unit: "SEK" | "count" | "ratio";
  dimensions: Dimension[];
  // Either a base aggregate over one fact, or a ratio of two other metrics.
  base?: { fact: Fact; sql: string };
  ratio?: { numerator: string; denominator: string };
};

const TIME: Dimension[] = ["day", "week", "month"];
const SALES_DIMS: Dimension[] = [...TIME, "market", "channel", "category", "sku"];

export const METRICS: Record<string, MetricDef> = {
  revenue_sek: {
    name: "revenue_sek",
    description: "Net revenue in SEK: quantity × unit price minus line discounts. Excludes VAT and returns.",
    unit: "SEK",
    dimensions: SALES_DIMS,
    base: { fact: "sales", sql: "SUM(l.quantity * l.unit_price_sek - l.discount_sek)" },
  },
  orders: {
    name: "orders",
    description: "Number of distinct orders.",
    unit: "count",
    dimensions: SALES_DIMS,
    base: { fact: "sales", sql: "COUNT(DISTINCT o.order_id)" },
  },
  units: {
    name: "units",
    description: "Number of items sold (sum of quantity).",
    unit: "count",
    dimensions: SALES_DIMS,
    base: { fact: "sales", sql: "SUM(l.quantity)" },
  },
  aov_sek: {
    name: "aov_sek",
    description: "Average order value in SEK: revenue_sek / orders.",
    unit: "SEK",
    dimensions: [...TIME, "market", "channel"],
    ratio: { numerator: "revenue_sek", denominator: "orders" },
  },
  ad_spend_sek: {
    name: "ad_spend_sek",
    description: "Paid media spend in SEK.",
    unit: "SEK",
    dimensions: [...TIME, "market", "ad_channel"],
    base: { fact: "ads", sql: "SUM(a.spend_sek)" },
  },
  roas: {
    name: "roas",
    description: "Return on ad spend: revenue_sek / ad_spend_sek, all channels combined.",
    unit: "ratio",
    dimensions: [...TIME, "market"],
    ratio: { numerator: "revenue_sek", denominator: "ad_spend_sek" },
  },
};

export function getMetric(name: string): MetricDef {
  const m = METRICS[name];
  if (!m) throw new Error(`Unknown metric "${name}". Use list_metrics to see what exists.`);
  return m;
}
