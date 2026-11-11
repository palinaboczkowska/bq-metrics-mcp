import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LAYER, LAYER_YAML } from "./semantic/metrics.js";
import { z } from "zod";
import { listMetrics, QuerySpec } from "./semantic/query.js";
import type { Warehouse } from "./warehouse/types.js";

const DIMS = ["day", "week", "month", "market", "channel", "category", "sku", "ad_channel"] as const;

function log(entry: Record<string, unknown>) {
  // One JSON line per tool call; Cloud Run sends stdout to Cloud Logging.
  console.error(JSON.stringify({ severity: "INFO", component: "bq-metrics-mcp", ...entry }));
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function createServer(warehouse: Warehouse): McpServer {
  const server = new McpServer({ name: "bq-metrics-mcp", version: "0.1.0" });

  server.registerTool(
    "list_metrics",
    {
      title: "List metrics",
      description: "Lists every business metric that can be queried, with its definition, unit and allowed dimensions. Call this first.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      log({ tool: "list_metrics" });
      return text(listMetrics());
    },
  );

  server.registerTool(
    "query_metric",
    {
      title: "Query a metric",
      description:
        "Returns one defined metric for a date range, optionally grouped by up to two dimensions and filtered. " +
        "Only metrics from list_metrics are allowed; free SQL is not supported.",
      inputSchema: {
        metric: z.string().describe("Metric name from list_metrics, e.g. revenue_sek"),
        group_by: z.array(z.enum(DIMS)).max(2).optional().describe("Up to two dimensions, at most one of day/week/month"),
        date_from: z.string().describe("Start date, YYYY-MM-DD (inclusive)"),
        date_to: z.string().describe("End date, YYYY-MM-DD (inclusive)"),
        filters: z
          .object({ market: z.string(), channel: z.string(), category: z.string(), sku: z.string(), ad_channel: z.string() })
          .partial()
          .optional()
          .describe("Exact-match filters, e.g. {\"market\": \"SE\"}"),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const started = Date.now();
      try {
        const spec = QuerySpec.parse(args);
        const res = await warehouse.query(spec);
        log({ tool: "query_metric", spec, rows: res.rows.length, bytes: res.bytesProcessed, ms: Date.now() - started });
        return text({ metric: spec.metric, group_by: spec.group_by, date_from: spec.date_from, date_to: spec.date_to, filters: spec.filters, rows: res.rows });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log({ tool: "query_metric", args, error: message, ms: Date.now() - started });
        return { ...text({ error: message }), isError: true };
      }
    },
  );

  server.registerTool(
    "top_products",
    {
      title: "Top products",
      description: "Best-selling products (SKU) by revenue_sek or units for a date range, optionally within one market.",
      inputSchema: {
        by: z.enum(["revenue_sek", "units"]).default("revenue_sek"),
        date_from: z.string(),
        date_to: z.string(),
        market: z.string().optional(),
        n: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ by, date_from, date_to, market, n }) => {
      try {
        const spec = QuerySpec.parse({ metric: by, group_by: ["sku"], date_from, date_to, filters: market ? { market } : {}, limit: n });
        const res = await warehouse.query(spec);
        log({ tool: "top_products", spec, rows: res.rows.length, bytes: res.bytesProcessed });
        return text({ by, date_from, date_to, market: market ?? "all", rows: res.rows });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log({ tool: "top_products", error: message });
        return { ...text({ error: message }), isError: true };
      }
    },
  );

  // ---- Semantic layer and catalog as MCP resources (read by the assistant, not executed) ----

  server.registerResource(
    "semantic-layer",
    "semantic://metrics.yaml",
    {
      title: "Semantic layer",
      description: "The metric and dimension definitions the server uses, as YAML. The single source of truth.",
      mimeType: "application/yaml",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/yaml", text: LAYER_YAML }] }),
  );

  server.registerResource(
    "catalog",
    "semantic://catalog",
    {
      title: "Data catalog",
      description: "Tables behind the metrics: description, grain, partitioning, clustering and lineage back to raw data.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ sources: LAYER.sources, dimensions: LAYER.dimensions }, null, 2),
      }],
    }),
  );

  server.registerResource(
    "metric",
    new ResourceTemplate("semantic://metrics/{name}", {
      list: async () => ({
        resources: Object.keys(LAYER.metrics).map((name) => ({ uri: `semantic://metrics/${name}`, name, mimeType: "application/json" })),
      }),
    }),
    { title: "Metric definition", description: "One metric with its definition, source table and allowed dimensions.", mimeType: "application/json" },
    async (uri, { name }) => {
      const m = LAYER.metrics[String(name)];
      if (!m) throw new Error(`Unknown metric "${name}"`);
      const source = m.source ? LAYER.sources[m.source] : undefined;
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ name, ...m, source_table: source?.table, lineage: source?.lineage }, null, 2),
        }],
      };
    },
  );

  return server;
}
