// Opt-in check against real BigQuery: `npm run test:live` with BQ_DATASET set.
// Every answer must equal the in-memory answer key computed from the same seed.
import { describe, expect, it } from "vitest";
import { generate } from "../src/data/generate.js";
import { QuerySpec } from "../src/semantic/query.js";
import { BigQueryWarehouse } from "../src/warehouse/bigquery.js";
import { MemoryWarehouse } from "../src/warehouse/memory.js";

const live = process.env.LIVE_BQ === "1" && !!process.env.BQ_DATASET;
const specs = [
  { metric: "revenue_sek", group_by: ["market"] },
  { metric: "orders", group_by: ["month"] },
  { metric: "aov_sek", group_by: ["channel"] },
  { metric: "roas", group_by: ["week", "market"] },
  { metric: "units", group_by: ["category"], filters: { market: "SE" } },
];

describe.skipIf(!live)("BigQuery matches the answer key", () => {
  const bq = new BigQueryWarehouse({ dataset: process.env.BQ_DATASET!, projectId: process.env.GOOGLE_CLOUD_PROJECT });
  const mem = new MemoryWarehouse(generate());
  for (const s of specs) {
    it(`${s.metric} by ${s.group_by.join("+")}`, async () => {
      const spec = QuerySpec.parse({ ...s, date_from: "2026-04-01", date_to: "2026-06-30", limit: 500 });
      const key = (r: Record<string, unknown>) => spec.group_by.map((g) => r[g]).join("|");
      const want = new Map((await mem.query(spec)).rows.map((r) => [key(r), Number(r.value)]));
      const got = (await bq.query(spec)).rows;
      expect(got.length).toBe(want.size);
      for (const r of got) expect(Number(r.value)).toBeCloseTo(want.get(key(r))!, 4);
    }, 60_000);
  }
});
