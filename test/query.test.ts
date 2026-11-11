import { describe, expect, it } from "vitest";
import { buildSql, QuerySpec, validate } from "../src/semantic/query.js";

const spec = (o: Partial<Record<string, unknown>>) =>
  QuerySpec.parse({ metric: "revenue_sek", date_from: "2026-01-01", date_to: "2026-01-31", ...o });

describe("validation against the semantic layer", () => {
  it("rejects unknown metrics", () => {
    expect(() => validate(spec({ metric: "profit" }))).toThrow(/Unknown metric/);
  });
  it("rejects dimensions a metric does not have", () => {
    expect(() => validate(spec({ metric: "roas", group_by: ["sku"] }))).toThrow(/cannot be grouped by "sku"/);
  });
  it("rejects filters a metric does not have", () => {
    expect(() => validate(spec({ metric: "ad_spend_sek", filters: { category: "lips" } }))).toThrow(/cannot be filtered/);
  });
  it("allows only one time dimension", () => {
    expect(() => validate(spec({ group_by: ["day", "month"] }))).toThrow(/one time dimension/);
  });
  it("limits the date range", () => {
    expect(() => validate(spec({ date_from: "2024-01-01", date_to: "2026-01-01" }))).toThrow(/limited/);
  });
  it("rejects a reversed date range", () => {
    expect(() => validate(spec({ date_from: "2026-02-01", date_to: "2026-01-01" }))).toThrow(/on or before/);
  });
  it("caps the number of rows", () => {
    expect(() => spec({ limit: 5000 })).toThrow();
  });
});

describe("SQL generation", () => {
  it("passes filter values as parameters, never inside the SQL text", () => {
    const evil = "SE' OR 1=1 --";
    const { sql, params } = buildSql(spec({ filters: { market: evil } }), "shop_demo");
    expect(sql).not.toContain(evil);
    expect(sql).toContain("@f_market");
    expect(params.f_market).toBe(evil);
  });
  it("builds ratio metrics with SAFE_DIVIDE and joins on the grouping", () => {
    const { sql } = buildSql(spec({ metric: "roas", group_by: ["month", "market"] }), "shop_demo");
    expect(sql).toContain("SAFE_DIVIDE(n.value, d.value)");
    expect(sql).toContain("FULL OUTER JOIN d USING (month, market)");
    expect(sql).toContain("`shop_demo.fct_ad_spend`");
  });
  it("orders time series by time and rankings by value", () => {
    expect(buildSql(spec({ group_by: ["week"] }), "x").sql).toContain("ORDER BY week ASC");
    expect(buildSql(spec({ group_by: ["sku"] }), "x").sql).toContain("ORDER BY value DESC");
  });
});
