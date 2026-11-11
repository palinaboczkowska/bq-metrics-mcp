import { describe, expect, it } from "vitest";
import { LAYER_YAML, loadLayer } from "../src/semantic/metrics.js";

describe("semantic layer file", () => {
  it("loads and validates", () => {
    expect(Object.keys(loadLayer(LAYER_YAML).metrics)).toEqual(["revenue_sek", "orders", "units", "aov_sek", "ad_spend_sek", "roas"]);
  });
  it("rejects a metric whose dimension is not mapped on its source", () => {
    const broken = LAYER_YAML.replace("dimensions: [day, week, month, market, ad_channel]", "dimensions: [day, category]");
    expect(() => loadLayer(broken)).toThrow(/not mapped/);
  });
  it("rejects a ratio over a dimension one side cannot provide", () => {
    const broken = LAYER_YAML.replace("dimensions: [day, week, month, market]\n", "dimensions: [day, week, month, market, channel]\n");
    expect(() => loadLayer(broken)).toThrow(/missing on source/);
  });
  it("rejects a metric that is neither base nor ratio", () => {
    const broken = LAYER_YAML.replace("    expression: SUM(quantity)\n", "");
    expect(() => loadLayer(broken)).toThrow();
  });
});
