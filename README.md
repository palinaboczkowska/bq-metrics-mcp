# bq-metrics-mcp

An MCP server that lets AI assistants answer business questions from BigQuery through a small semantic layer.
The assistant can only ask for metrics that are defined once in code, never write its own SQL.

> "What was revenue per market last month?" → `query_metric(revenue_sek, group_by: [market])`

## Why

General database MCP servers give a model access to tables and SQL. That works for exploring, but numbers
drift: two assistants can define "revenue" in two different ways. This server puts the definitions in one place
(`src/semantic/metrics.ts`) and exposes only those, the way a semantic layer does in BI tools.

## Tools

| Tool | What it does |
|---|---|
| `list_metrics` | Every metric with its definition, unit and allowed dimensions |
| `query_metric` | One metric for a date range, grouped by up to two dimensions, with filters |
| `top_products` | Best-selling SKUs by revenue or units |

Metrics: `revenue_sek`, `orders`, `units`, `aov_sek`, `ad_spend_sek`, `roas`.
Dimensions: `day`/`week`/`month`, `market`, `channel`, `category`, `sku`, `ad_channel`.

## Guardrails

- **No free SQL.** Inputs are validated against the semantic layer; filter values are bound as query parameters.
- **Cost cap.** Every query is dry-run first and refused above `BQ_MAX_BYTES`; the real job also sets `maximumBytesBilled`.
- **Least privilege.** The Cloud Run service account can read one dataset and run query jobs, nothing else.
- **Private endpoint.** Deployed with `--no-allow-unauthenticated`; callers need `roles/run.invoker`.
- **Audit log.** One structured log line per tool call (metric, filters, rows, bytes, latency) in Cloud Logging.
- Read-only tools, max two dimensions, max 400 days, max 500 rows.

## Correct numbers

The demo data is synthetic and generated from a fixed seed (`src/data/generate.ts`). A reference engine in
TypeScript (`src/warehouse/memory.ts`) computes every metric directly from the same rows. Unit tests check the
engine against raw totals, and `npm run test:live` checks that BigQuery returns exactly the same answers.

## Run

```sh
npm install
npm test                 # unit + MCP protocol tests (in-memory data)
npm run dev:stdio        # local stdio server, in-memory data unless BQ_DATASET is set
```

Claude Code (`.mcp.json`):

```json
{ "mcpServers": { "metrics": { "command": "npx", "args": ["tsx", "src/stdio.ts"], "env": { "BQ_DATASET": "my-project.shop_demo" } } } }
```

BigQuery and Cloud Run:

```sh
PROJECT=my-project ./scripts/setup-bigquery.sh   # dataset, tables, read-only service account
BQ_DATASET=my-project.shop_demo npm run test:live # BigQuery must match the answer key
./deploy.sh                                       # private Cloud Run service
gcloud run services proxy bq-metrics-mcp --region europe-north1 --port 8080   # http://localhost:8080/mcp
```

## Stack

TypeScript, MCP TypeScript SDK (stdio and Streamable HTTP), BigQuery, Cloud Run, Zod, Vitest, GitHub Actions.
