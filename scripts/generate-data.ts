// Writes the synthetic dataset as newline-delimited JSON for `bq load`.
import { mkdirSync, writeFileSync } from "node:fs";
import { generate } from "../src/data/generate.js";

const data = generate();
mkdirSync("data", { recursive: true });
for (const [table, rows] of Object.entries(data)) {
  writeFileSync(`data/${table}.ndjson`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${table}: ${rows.length} rows`);
}
