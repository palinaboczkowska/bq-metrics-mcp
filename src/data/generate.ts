// Deterministic synthetic data for a Nordic beauty e-commerce brand.
// The same seed always gives the same rows, so tests can compute the
// expected answer in TypeScript and compare it with what BigQuery returns.

export type Product = { sku: string; name: string; category: string };
export type Order = { order_id: string; order_date: string; market: string; channel: string };
export type OrderLine = { order_id: string; sku: string; quantity: number; unit_price_sek: number; discount_sek: number };
export type AdSpend = { date: string; market: string; ad_channel: string; spend_sek: number };

export type Dataset = { products: Product[]; orders: Order[]; order_lines: OrderLine[]; ad_spend: AdSpend[] };

export const MARKETS = ["SE", "NO", "DK", "FI", "DE"] as const;
export const CHANNELS = ["web", "app", "retail_partner"] as const;
export const AD_CHANNELS = ["meta", "google", "tiktok"] as const;
export const CATEGORIES = ["lips", "eyes", "face", "skincare", "tools"] as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function generate(opts: { seed?: number; from?: string; to?: string } = {}): Dataset {
  const rnd = mulberry32(opts.seed ?? 42);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const prices: Record<string, number> = {};
  const products: Product[] = [];
  CATEGORIES.forEach((category, ci) => {
    for (let i = 1; i <= 8; i++) {
      const sku = `${category.slice(0, 3).toUpperCase()}-${String(i).padStart(3, "0")}`;
      products.push({ sku, name: `${category} ${i}`, category });
      prices[sku] = 99 + ci * 20 + int(0, 12) * 10;
    }
  });

  const start = new Date(`${opts.from ?? "2026-01-01"}T00:00:00Z`);
  const end = new Date(`${opts.to ?? "2026-10-31"}T00:00:00Z`);
  const orders: Order[] = [];
  const order_lines: OrderLine[] = [];
  const ad_spend: AdSpend[] = [];
  let n = 0;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    for (const market of MARKETS) {
      const base = market === "SE" ? 12 : market === "DE" ? 8 : 4;
      const count = int(Math.floor(base / 2), base);
      for (let k = 0; k < count; k++) {
        const order_id = `O${String(++n).padStart(7, "0")}`;
        orders.push({ order_id, order_date: date, market, channel: pick(CHANNELS) });
        const lines = int(1, 3);
        for (let l = 0; l < lines; l++) {
          const sku = pick(products).sku;
          const quantity = int(1, 3);
          const discount_sek = rnd() < 0.2 ? 20 * quantity : 0;
          order_lines.push({ order_id, sku, quantity, unit_price_sek: prices[sku], discount_sek });
        }
      }
      for (const ad_channel of AD_CHANNELS) {
        ad_spend.push({ date, market, ad_channel, spend_sek: int(100, 900) });
      }
    }
  }
  return { products, orders, order_lines, ad_spend };
}
