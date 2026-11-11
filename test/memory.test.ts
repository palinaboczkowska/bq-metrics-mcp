import { describe, expect, it } from "vitest";
import { generate } from "../src/data/generate.js";
import { QuerySpec } from "../src/semantic/query.js";
import { MemoryWarehouse } from "../src/warehouse/memory.js";

const data = generate();
const wh = new MemoryWarehouse(data);
const q = (o: Record<string, unknown>) =>
  wh.query(QuerySpec.parse({ metric: "revenue_sek", date_from: "2026-03-01", date_to: "2026-03-31", limit: 500, ...o }));

// Totals computed directly from the raw rows, independent of the engine.
const orders = new Map(data.orders.map((o) => [o.order_id, o]));
const marchLines = data.order_lines.filter((l) => orders.get(l.order_id)!.order_date.startsWith("2026-03"));
const marchRevenue = marchLines.reduce((s, l) => s + l.quantity * l.unit_price_sek - l.discount_sek, 0);
const marchOrders = new Set(marchLines.map((l) => l.order_id)).size;
const marchSpend = data.ad_spend.filter((a) => a.date.startsWith("2026-03")).reduce((s, a) => s + a.spend_sek, 0);

describe("in-memory reference engine", () => {
  it("is deterministic", () => {
    expect(generate().order_lines.length).toBe(data.order_lines.length);
  });
  it("matches raw totals", async () => {
    expect((await q({})).rows[0].value).toBe(marchRevenue);
    expect((await q({ metric: "orders" })).rows[0].value).toBe(marchOrders);
    expect((await q({ metric: "ad_spend_sek" })).rows[0].value).toBe(marchSpend);
  });
  it("ratios equal numerator / denominator", async () => {
    expect((await q({ metric: "aov_sek" })).rows[0].value).toBeCloseTo(marchRevenue / marchOrders, 6);
    expect((await q({ metric: "roas" })).rows[0].value).toBeCloseTo(marchRevenue / marchSpend, 6);
  });
  it("grouped rows add up to the total", async () => {
    const byMarket = (await q({ group_by: ["market"] })).rows;
    expect(byMarket.reduce((s, r) => s + Number(r.value), 0)).toBeCloseTo(marchRevenue, 6);
    const byWeek = (await q({ group_by: ["week"] })).rows;
    expect(byWeek[0].week).toBe("2026-02-23"); // ISO week starting Monday before 1 March
  });
  it("applies filters", async () => {
    const se = (await q({ filters: { market: "SE" } })).rows[0].value;
    const bySe = (await q({ group_by: ["market"] })).rows.find((r) => r.market === "SE")!.value;
    expect(se).toBe(bySe);
  });
});
