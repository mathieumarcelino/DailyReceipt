import type { ReceiptModule } from "./types";

interface StockAsset {
  symbol: string;
  label: string;
}

interface StocksConfig {
  assets: StockAsset[];
}

interface Quote {
  label: string;
  price: number | null;
  currency: string;
  changePct: number | null;
  error?: string;
}

interface StocksData {
  quotes: Quote[];
}

const stocksModule: ReceiptModule<StocksConfig, StocksData> = {
  id: "stocks",
  name: "Bourse",
  description: "Cours d'actions via Yahoo Finance.",
  configSchema: [
    {
      key: "assets",
      label: "Actions suivies",
      type: "array",
      itemLabel: "Action",
      itemSchema: [
        { key: "symbol", label: "Symbole", type: "text", placeholder: "AAPL (symbole Yahoo Finance)" },
        { key: "label", label: "Libellé affiché", type: "text", placeholder: "Apple (AAPL)" },
      ],
    },
  ],
  defaultConfig: { assets: [] },

  async fetchData(config) {
    const assets = (config.assets ?? []).filter((a) => a.symbol?.trim());
    const quotes = await Promise.all(assets.map(fetchStockQuote));
    return { quotes };
  },

  renderReceipt(data, ctx) {
    ctx.text("BOURSE", { bold: true, underline: true });
    if (data.quotes.length === 0) {
      ctx.text("Aucune valeur configurée.");
    }
    for (const q of data.quotes) {
      if (q.price == null) {
        ctx.row(q.label, "N/A");
        continue;
      }
      const sign = q.changePct != null && q.changePct >= 0 ? "+" : "";
      const change = q.changePct != null ? ` (${sign}${q.changePct.toFixed(1)}%)` : "";
      ctx.row(q.label, `${formatPrice(q.price)} ${q.currency}${change}`);
    }
  },
};

function errorQuote(asset: StockAsset): Quote {
  return { label: asset.label ?? asset.symbol, price: null, currency: "", changePct: null, error: "non disponible" };
}

/**
 * Formate un prix avec un séparateur de milliers en espace ASCII normale.
 * Intl/toLocaleString('fr-FR') utilise une espace fine insécable (U+202F)
 * qui n'existe dans aucune page de code ESC/POS (CP437/858/1252) et
 * s'imprimerait comme un caractère invalide sur le ticket papier.
 */
function formatPrice(value: number): string {
  if (value < 1000) return value.toFixed(2);
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

async function fetchStockQuote(asset: StockAsset): Promise<Quote> {
  const symbol = asset.symbol.trim();
  const label = asset.label?.trim() || symbol;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (DailyReceipt)" } });
    if (!res.ok) throw new Error(`Yahoo Finance a répondu ${res.status}`);
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error("Réponse Yahoo Finance invalide");

    const price = meta.regularMarketPrice;
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const changePct = previousClose ? ((price - previousClose) / previousClose) * 100 : null;

    return { label, price, currency: meta.currency ?? "", changePct };
  } catch {
    return errorQuote(asset);
  }
}

export default stocksModule;
