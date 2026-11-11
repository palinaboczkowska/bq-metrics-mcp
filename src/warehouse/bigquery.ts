import { BigQuery } from "@google-cloud/bigquery";
import { buildSql, type QuerySpec } from "../semantic/query.js";
import type { QueryResult, Row, Warehouse } from "./types.js";

export type BigQueryOptions = {
  projectId?: string;
  dataset: string; // "project.dataset" or "dataset"
  location?: string;
  /** Hard cap per query. BigQuery refuses to run (and bill) anything above it. */
  maxBytesBilled?: number;
};

function plain(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "value" in v) return String((v as { value: unknown }).value); // BigQueryDate etc.
  return Number(v);
}

export class BigQueryWarehouse implements Warehouse {
  private bq: BigQuery;
  private maxBytes: number;

  constructor(private opts: BigQueryOptions) {
    this.bq = new BigQuery({ projectId: opts.projectId });
    this.maxBytes = opts.maxBytesBilled ?? 100 * 1024 * 1024; // 100 MB
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    const built = buildSql(spec, this.opts.dataset);
    const { sql } = built;
    // The Node client silently matches nothing when a DATE is sent as a string with an explicit
    // type (found in the live test), so dates are sent as BigQueryDate values instead.
    const params: Record<string, unknown> = {};
    const types: Record<string, string> = {};
    for (const [k, v] of Object.entries(built.params)) {
      if (built.types[k] === "DATE") params[k] = this.bq.date(String(v));
      else {
        params[k] = v;
        types[k] = built.types[k];
      }
    }
    const base = { query: sql, params, types, location: this.opts.location ?? "EU", useLegacySql: false };

    // Dry run first: estimate cost and refuse before anything is billed.
    const [dry] = await this.bq.createQueryJob({ ...base, dryRun: true });
    const estimate = Number(dry.metadata?.statistics?.totalBytesProcessed ?? 0);
    if (estimate > this.maxBytes) {
      throw new Error(`Query would scan ${estimate} bytes, above the limit of ${this.maxBytes}. Narrow the date range or filters.`);
    }

    const [job] = await this.bq.createQueryJob({ ...base, maximumBytesBilled: String(this.maxBytes) });
    const [raw] = await job.getQueryResults();
    const [meta] = await job.getMetadata();
    const rows: Row[] = raw.map((r: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])),
    );
    return { rows, bytesProcessed: Number(meta.statistics?.totalBytesProcessed ?? estimate), sql };
  }
}
