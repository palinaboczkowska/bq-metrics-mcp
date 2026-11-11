// Loads and validates the semantic layer from semantic/metrics.yaml.
// Every metric is defined once there; the server exposes nothing else.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const DIMENSIONS = ["day", "week", "month", "market", "channel", "category", "sku", "ad_channel"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Fact = "sales" | "ads";
export type Filter = Partial<Record<"market" | "channel" | "category" | "sku" | "ad_channel", string>>;

const Dim = z.enum(DIMENSIONS);
const Source = z.object({
  table: z.string().regex(/^\w+$/),
  description: z.string(),
  grain: z.string(),
  date_column: z.string().regex(/^\w+$/),
  partitioned_by: z.string().optional(),
  clustered_by: z.array(z.string()).optional(),
  lineage: z.array(z.string()).default([]),
  dimensions: z.record(z.string(), z.string().regex(/^\w+$/)),
});
const Metric = z
  .object({
    description: z.string(),
    unit: z.enum(["SEK", "count", "ratio"]),
    dimensions: z.array(Dim).min(1),
    source: z.enum(["sales", "ads"]).optional(),
    expression: z.string().optional(),
    ratio: z.object({ numerator: z.string(), denominator: z.string() }).optional(),
  })
  .refine((m) => (!!m.source && !!m.expression) !== !!m.ratio, "A metric is either source + expression, or a ratio");
const Layer = z.object({
  version: z.literal(1),
  sources: z.object({ sales: Source, ads: Source }),
  dimensions: z.record(Dim, z.object({ description: z.string() })),
  metrics: z.record(z.string(), Metric),
});
export type Layer = z.infer<typeof Layer>;

export type MetricDef = {
  name: string;
  description: string;
  unit: "SEK" | "count" | "ratio";
  dimensions: Dimension[];
  base?: { fact: Fact; sql: string };
  ratio?: { numerator: string; denominator: string };
};

/** Path works from both src/semantic (tsx) and dist/semantic (node). */
export const LAYER_PATH = fileURLToPath(new URL("../../semantic/metrics.yaml", import.meta.url));
export const LAYER_YAML = readFileSync(LAYER_PATH, "utf8");

export function loadLayer(yamlText: string): Layer {
  const layer = Layer.parse(parse(yamlText));
  for (const [name, m] of Object.entries(layer.metrics)) {
    if (m.ratio) {
      for (const part of [m.ratio.numerator, m.ratio.denominator]) {
        const p = layer.metrics[part];
        if (!p || p.ratio) throw new Error(`Metric ${name}: ratio part "${part}" must be a base metric`);
        for (const d of m.dimensions) {
          const src = layer.sources[p.source!];
          if (!["day", "week", "month"].includes(d) && !(d in src.dimensions)) {
            throw new Error(`Metric ${name}: dimension "${d}" is missing on source of "${part}"`);
          }
        }
      }
    } else {
      const src = layer.sources[m.source!];
      for (const d of m.dimensions) {
        if (!["day", "week", "month"].includes(d) && !(d in src.dimensions)) {
          throw new Error(`Metric ${name}: dimension "${d}" is not mapped on source "${m.source}"`);
        }
      }
    }
  }
  return layer;
}

export const LAYER = loadLayer(LAYER_YAML);

export const METRICS: Record<string, MetricDef> = Object.fromEntries(
  Object.entries(LAYER.metrics).map(([name, m]) => [
    name,
    {
      name,
      description: m.description,
      unit: m.unit,
      dimensions: m.dimensions,
      base: m.source ? { fact: m.source, sql: m.expression! } : undefined,
      ratio: m.ratio,
    },
  ]),
);

export function getMetric(name: string): MetricDef {
  const m = METRICS[name];
  if (!m) throw new Error(`Unknown metric "${name}". Use list_metrics to see what exists.`);
  return m;
}
