# bq-metrics-mcp

An MCP server that lets AI assistants answer business questions from BigQuery through a small semantic layer.
The assistant can only ask for metrics that are defined once in code, never write its own SQL.

> "What was revenue per market last month?" → `query_metric(revenue_sek, group_by: [market])`

## Architecture

```
raw (shop_demo)  ──Dataform──▶  staging views  ──▶  marts (shop_marts)  ◀── MCP server ◀── AI assistant
orders, lines,                  stg_orders,         fct_sales                semantic/metrics.yaml
products, ad_spend              stg_order_lines     fct_ad_spend             (metrics defined once)
                                + 8 assertions      partitioned by date,
                                                    clustered by market
```

## Why

General database MCP servers give a model access to tables and SQL. That works for exploring, but numbers
drift: two assistants can define "revenue" in two different ways. This server puts the definitions in one place
(`semantic/metrics.yaml`) and exposes only those, the way a semantic layer does in BI tools. The file is
validated at startup: a metric that asks for a dimension its source table does not have will not load.

## Tools

| Tool | What it does |
|---|---|
| `list_metrics` | Every metric with its definition, unit and allowed dimensions |
| `query_metric` | One metric for a date range, grouped by up to two dimensions, with filters |
| `top_products` | Best-selling SKUs by revenue or units |

Metrics: `revenue_sek`, `orders`, `units`, `aov_sek`, `ad_spend_sek`, `roas`.
Dimensions: `day`/`week`/`month`, `market`, `channel`, `category`, `sku`, `ad_channel`.

## Resources

The assistant can also read the semantic layer itself, so it knows what a number means before it asks for it:

| Resource | Content |
|---|---|
| `semantic://metrics.yaml` | The full semantic layer |
| `semantic://catalog` | Source tables: description, grain, partitioning, clustering, lineage to raw data |
| `semantic://metrics/{name}` | One metric with its source table and lineage |

## Data model (Dataform)

`dataform/` builds the tables the server reads, in BigQuery:

- **Staging views** clean the raw tables (`stg_orders`, `stg_order_lines` with net line revenue).
- **Marts** are incremental tables: `fct_sales` at order × SKU grain and `fct_ad_spend` per day, market and ad
  channel, **partitioned by date and clustered by market**. A one-month query reads about 1/20 of what the same
  query on the raw tables reads.
- **Assertions** run with every build: unique keys, non-null keys, no negative amounts, every order line has an
  order, and total revenue in the mart reconciles with the raw order lines.

```sh
cd dataform && npx @dataform/cli@3.1.5 run      # add --full-refresh to rebuild
```

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
{ "mcpServers": { "metrics": { "command": "npx", "args": ["tsx", "src/stdio.ts"], "env": { "BQ_DATASET": "my-project.shop_marts" } } } }
```

BigQuery and Cloud Run:

```sh
PROJECT=my-project ./scripts/setup-bigquery.sh   # dataset, tables, read-only service account
(cd dataform && npx @dataform/cli@3.1.5 run --full-refresh)   # staging, marts and assertions
BQ_DATASET=my-project.shop_marts npm run test:live # BigQuery must match the answer key
./deploy.sh                                       # private Cloud Run service
gcloud run services proxy bq-metrics-mcp --region europe-north1 --port 8080   # http://localhost:8080/mcp
```

## Stack

TypeScript, MCP TypeScript SDK (stdio and Streamable HTTP), BigQuery, Dataform, Cloud Run, YAML + Zod, Vitest, GitHub Actions.
