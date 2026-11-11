import { generate } from "./data/generate.js";
import { BigQueryWarehouse } from "./warehouse/bigquery.js";
import { MemoryWarehouse } from "./warehouse/memory.js";
import type { Warehouse } from "./warehouse/types.js";

/** BigQuery when BQ_DATASET is set, otherwise the in-memory demo data. */
export function warehouseFromEnv(): Warehouse {
  const dataset = process.env.BQ_DATASET;
  if (!dataset) {
    console.error("BQ_DATASET not set: using in-memory demo data");
    return new MemoryWarehouse(generate());
  }
  return new BigQueryWarehouse({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    dataset,
    location: process.env.BQ_LOCATION ?? "EU",
    maxBytesBilled: process.env.BQ_MAX_BYTES ? Number(process.env.BQ_MAX_BYTES) : undefined,
  });
}
