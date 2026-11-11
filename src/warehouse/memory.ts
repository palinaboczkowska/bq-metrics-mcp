// Reference engine: computes the same metrics in plain TypeScript from the
// generated dataset. It is the "answer key" the BigQuery results are checked against.

import type { Dataset } from "../data/generate.js";
import type { Dimension } from "../semantic/metrics.js";
import { getMetric } from "../semantic/metrics.js";
import { type QuerySpec, validate } from "../semantic/query.js";
import type { QueryResult, Row, Warehouse } from "./types.js";

const TIME: Dimension[] = ["day", "week", "month"];

function timeKey(date: string, d: Dimension): string {
  if (d === "day") return date;
  if (d === "month") return `${date.slice(0, 8)}01`;
  const t = new Date(`${date}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0, matches ISOWEEK
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

type Agg = Map<string, { key: Row; value: number }>;

export class MemoryWarehouse implements Warehouse {
  constructor(private data: Dataset) {}

  private base(name: string, spec: QuerySpec): Agg {
    const m = getMetric(name);
    const out: Agg = new Map();
    const add = (key: Row, v: number, distinct?: string) => {
      const k = JSON.stringify(key);
      const cur = out.get(k) ?? { key, value: 0, seen: new Set<string>() };
      if (distinct) {
        const s = (cur as { seen: Set<string> }).seen;
        if (!s.has(distinct)) { s.add(distinct); cur.value += 1; }
      } else cur.value += v;
      out.set(k, cur);
    };
    const inRange = (d: string) => d >= spec.date_from && d <= spec.date_to;
    const f = spec.filters;

    if (m.base!.fact === "sales") {
      const orders = new Map(this.data.orders.map((o) => [o.order_id, o]));
      const products = new Map(this.data.products.map((p) => [p.sku, p]));
      for (const l of this.data.order_lines) {
        const o = orders.get(l.order_id)!;
        const p = products.get(l.sku)!;
        if (!inRange(o.order_date)) continue;
        const attrs: Record<string, string> = { market: o.market, channel: o.channel, category: p.category, sku: l.sku };
        if (Object.entries(f).some(([k, v]) => v !== undefined && attrs[k] !== v)) continue;
        const key: Row = {};
        for (const d of spec.group_by) key[d] = TIME.includes(d) ? timeKey(o.order_date, d) : attrs[d];
        if (name === "revenue_sek") add(key, l.quantity * l.unit_price_sek - l.discount_sek);
        else if (name === "units") add(key, l.quantity);
        else if (name === "orders") add(key, 0, o.order_id);
      }
    } else {
      for (const a of this.data.ad_spend) {
        if (!inRange(a.date)) continue;
        const attrs: Record<string, string> = { market: a.market, ad_channel: a.ad_channel };
        if (Object.entries(f).some(([k, v]) => v !== undefined && attrs[k] !== v)) continue;
        const key: Row = {};
        for (const d of spec.group_by) key[d] = TIME.includes(d) ? timeKey(a.date, d) : attrs[d];
        add(key, a.spend_sek);
      }
    }
    return out;
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    const m = validate(spec);
    let rows: Row[];
    if (m.base) {
      rows = [...this.base(m.name, spec).values()].map(({ key, value }) => ({ ...key, value }));
    } else {
      const n = this.base(m.ratio!.numerator, spec);
      const d = this.base(m.ratio!.denominator, spec);
      const keys = new Set([...n.keys(), ...d.keys()]);
      rows = [...keys].map((k) => {
        const key = (n.get(k) ?? d.get(k))!.key;
        const den = d.get(k)?.value ?? 0;
        return { ...key, value: den === 0 || !n.has(k) ? null : n.get(k)!.value / den };
      });
    }
    const time = spec.group_by.find((g) => TIME.includes(g));
    rows.sort((a, b) =>
      time ? String(a[time]).localeCompare(String(b[time])) : Number(b.value ?? -Infinity) - Number(a.value ?? -Infinity),
    );
    return { rows: rows.slice(0, spec.limit), bytesProcessed: 0 };
  }
}
