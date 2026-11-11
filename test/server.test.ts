import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { generate } from "../src/data/generate.js";
import { createServer } from "../src/server.js";
import { MemoryWarehouse } from "../src/warehouse/memory.js";

let client: Client;
const parse = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0].text);

beforeAll(async () => {
  const server = createServer(new MemoryWarehouse(generate()));
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe("MCP server", () => {
  it("exposes three read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_metrics", "query_metric", "top_products"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });
  it("lists metric definitions", async () => {
    const metrics = parse(await client.callTool({ name: "list_metrics", arguments: {} }));
    expect(metrics.map((m: { name: string }) => m.name)).toContain("roas");
  });
  it("answers a metric query", async () => {
    const r = parse(await client.callTool({
      name: "query_metric",
      arguments: { metric: "revenue_sek", group_by: ["market"], date_from: "2026-05-01", date_to: "2026-05-31" },
    }));
    expect(r.rows).toHaveLength(5);
  });
  it("returns a readable error instead of crashing", async () => {
    const res = await client.callTool({
      name: "query_metric",
      arguments: { metric: "roas", group_by: ["sku"], date_from: "2026-05-01", date_to: "2026-05-31" },
    });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/cannot be grouped/);
  });
  it("ranks top products", async () => {
    const r = parse(await client.callTool({
      name: "top_products",
      arguments: { by: "units", date_from: "2026-06-01", date_to: "2026-06-30", market: "SE", n: 3 },
    }));
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].value).toBeGreaterThanOrEqual(r.rows[2].value);
  });
});

describe("semantic layer as resources", () => {
  it("lists the layer, the catalog and one resource per metric", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("semantic://metrics.yaml");
    expect(uris).toContain("semantic://catalog");
    expect(uris).toContain("semantic://metrics/roas");
  });
  it("returns the catalog with partitioning and lineage", async () => {
    const r = await client.readResource({ uri: "semantic://catalog" });
    const cat = JSON.parse((r.contents[0] as { text: string }).text);
    expect(cat.sources.sales.partitioned_by).toBe("order_date");
    expect(cat.sources.sales.lineage).toContain("shop_demo.order_lines");
  });
  it("returns one metric definition", async () => {
    const r = await client.readResource({ uri: "semantic://metrics/aov_sek" });
    expect(JSON.parse((r.contents[0] as { text: string }).text).ratio).toEqual({ numerator: "revenue_sek", denominator: "orders" });
  });
});
