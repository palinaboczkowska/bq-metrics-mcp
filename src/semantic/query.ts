import { z } from "zod";
import { type Dimension, type Filter, type MetricDef, getMetric, METRICS } from "./metrics.js";

export const MAX_DAYS = 400;
export const MAX_ROWS = 500;
const TIME_DIMS: Dimension[] = ["day", "week", "month"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const QuerySpec = z.object({
  metric: z.string(),
  group_by: z.array(z.enum(["day", "week", "month", "market", "channel", "category", "sku", "ad_channel"])).max(2).default([]),
  date_from: isoDate,
  date_to: isoDate,
  filters: z
    .object({
      market: z.string().optional(),
      channel: z.string().optional(),
      category: z.string().optional(),
      sku: z.string().optional(),
      ad_channel: z.string().optional(),
    })
    .default({}),
  limit: z.number().int().min(1).max(MAX_ROWS).default(100),
});
export type QuerySpec = z.infer<typeof QuerySpec>;

/** Checks a spec against the semantic layer and returns the metric. Throws a readable error. */
export function validate(spec: QuerySpec): MetricDef {
  const m = getMetric(spec.metric);
  for (const d of spec.group_by) {
    if (!m.dimensions.includes(d)) throw new Error(`"${m.name}" cannot be grouped by "${d}". Allowed: ${m.dimensions.join(", ")}.`);
  }
  if (spec.group_by.filter((d) => TIME_DIMS.includes(d)).length > 1) throw new Error("Use at most one time dimension (day, week or month).");
  for (const k of Object.keys(spec.filters) as (keyof Filter)[]) {
    if (spec.filters[k] !== undefined && !m.dimensions.includes(k)) throw new Error(`"${m.name}" cannot be filtered on "${k}".`);
  }
  const from = Date.parse(spec.date_from), to = Date.parse(spec.date_to);
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error("date_from must be on or before date_to.");
  if ((to - from) / 86_400_000 > MAX_DAYS) throw new Error(`Date range is limited to ${MAX_DAYS} days.`);
  return m;
}

// ---- SQL generation (BigQuery Standard SQL, parameterised) ----

type FactSql = { from: string; date: string; dims: Partial<Record<Dimension, string>> };

function facts(dataset: string): Record<"sales" | "ads", FactSql> {
  const t = (name: string) => `\`${dataset}.${name}\``;
  return {
    sales: {
      from: `${t("order_lines")} l JOIN ${t("orders")} o ON o.order_id = l.order_id JOIN ${t("products")} p ON p.sku = l.sku`,
      date: "o.order_date",
      dims: { market: "o.market", channel: "o.channel", category: "p.category", sku: "l.sku" },
    },
    ads: {
      from: `${t("ad_spend")} a`,
      date: "a.date",
      dims: { market: "a.market", ad_channel: "a.ad_channel" },
    },
  };
}

function dimExpr(f: FactSql, d: Dimension): string {
  if (d === "day") return f.date;
  if (d === "week") return `DATE_TRUNC(${f.date}, ISOWEEK)`;
  if (d === "month") return `DATE_TRUNC(${f.date}, MONTH)`;
  const e = f.dims[d];
  if (!e) throw new Error(`Dimension "${d}" is not available on this fact.`);
  return e;
}

function baseSql(m: MetricDef, spec: QuerySpec, dataset: string): string {
  const f = facts(dataset)[m.base!.fact];
  const select = spec.group_by.map((d) => `${dimExpr(f, d)} AS ${d}`);
  const where = [`${f.date} BETWEEN @date_from AND @date_to`];
  for (const [k, v] of Object.entries(spec.filters)) {
    if (v !== undefined) where.push(`${dimExpr(f, k as Dimension)} = @f_${k}`);
  }
  const group = spec.group_by.length ? ` GROUP BY ${spec.group_by.join(", ")}` : "";
  return `SELECT ${[...select, `${m.base!.sql} AS value`].join(", ")} FROM ${f.from} WHERE ${where.join(" AND ")}${group}`;
}

/** Builds the SQL and named parameters for a validated spec. */
export function buildSql(spec: QuerySpec, dataset: string): { sql: string; params: Record<string, string | number>; types: Record<string, string> } {
  const m = validate(spec);
  let inner: string;
  if (m.base) {
    inner = baseSql(m, spec, dataset);
  } else {
    const num = baseSql(getMetric(m.ratio!.numerator), spec, dataset);
    const den = baseSql(getMetric(m.ratio!.denominator), spec, dataset);
    const dims = spec.group_by;
    const join = dims.length ? `FULL OUTER JOIN d USING (${dims.join(", ")})` : "CROSS JOIN d";
    const cols = dims.length ? `${dims.join(", ")}, ` : "";
    inner = `WITH n AS (${num}), d AS (${den}) SELECT ${cols}SAFE_DIVIDE(n.value, d.value) AS value FROM n ${join}`;
  }
  const time = spec.group_by.find((d) => TIME_DIMS.includes(d));
  const order = time ? `${time} ASC` : "value DESC";
  const sql = `SELECT * FROM (${inner}) ORDER BY ${order} LIMIT @limit`;

  const params: Record<string, string | number> = { date_from: spec.date_from, date_to: spec.date_to, limit: spec.limit };
  const types: Record<string, string> = { date_from: "DATE", date_to: "DATE", limit: "INT64" };
  for (const [k, v] of Object.entries(spec.filters)) {
    if (v !== undefined) {
      params[`f_${k}`] = v;
      types[`f_${k}`] = "STRING";
    }
  }
  return { sql, params, types };
}

export function listMetrics() {
  return Object.values(METRICS).map(({ name, description, unit, dimensions }) => ({ name, description, unit, dimensions }));
}
