import type { ReceiptModule } from "./types";

interface Asset {
  type: "crypto" | "stock";
  symbol: string;
  label: string;
}

interface MarketsConfig {
  assets: Asset[];
}

interface Quote {
  label: string;
  price: number | null;
  currency: string;
  changePct: number | null;
  error?: string;
}

interface MarketsData {
  quotes: Quote[];
}

const marketsModule: ReceiptModule<MarketsConfig, MarketsData> = {
  id: "markets",
  name: "Bourse / Crypto",
  description: "Cours d'actions (Yahoo Finance) ou de cryptomonnaies (CoinGecko).",
  configSchema: [
    {
      key: "assets",
      label: "Valeurs suivies",
      type: "array",
      itemLabel: "Valeur",
      itemSchema: [
        {
          key: "type",
          label: "Type",
          type: "select",
          options: [
            { value: "crypto", label: "Crypto (CoinGecko)" },
            { value: "stock", label: "Action (Yahoo Finance)" },
          ],
        },
        { key: "symbol", label: "Symbole", type: "text", placeholder: "bitcoin (CoinGecko) ou AAPL (Yahoo)" },
        { key: "label", label: "Libellé affiché", type: "text", placeholder: "Bitcoin (BTC)" },
      ],
    },
  ],
  defaultConfig: {
    assets: [
      { type: "crypto", symbol: "bitcoin", label: "Bitcoin (BTC)" },
      { type: "crypto", symbol: "ethereum", label: "Ethereum (ETH)" },
    ],
  },

  async fetchData(config) {
    const assets = config.assets ?? [];
    const cryptoAssets = assets.filter((a) => a.type === "crypto" && a.symbol?.trim());
    const stockAssets = assets.filter((a) => a.type === "stock" && a.symbol?.trim());

    const cryptoQuotes = await fetchCryptoQuotes(cryptoAssets);
    const stockQuotes = await Promise.all(stockAssets.map(fetchStockQuote));

    // On restitue l'ordre de configuration d'origine.
    const byLabel = new Map<string, Quote>();
    for (const q of [...cryptoQuotes, ...stockQuotes]) byLabel.set(q.label, q);
    const quotes = assets.map((a) => byLabel.get(a.label ?? a.symbol) ?? errorQuote(a));

    return { quotes };
  },

  renderReceipt(data, ctx) {
    ctx.text("BOURSE & CRYPTO", { bold: true, underline: true });
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

function errorQuote(asset: Asset): Quote {
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

async function fetchCryptoQuotes(assets: Asset[]): Promise<Quote[]> {
  if (assets.length === 0) return [];
  const ids = assets.map((a) => a.symbol.trim()).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur&include_24hr_change=true`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`CoinGecko a répondu ${res.status}`);
    const json: any = await res.json();

    return assets.map((asset) => {
      const entry = json[asset.symbol.trim()];
      if (!entry) return errorQuote(asset);
      return {
        label: asset.label?.trim() || asset.symbol,
        price: entry.eur ?? null,
        currency: "€",
        changePct: entry.eur_24h_change ?? null,
      };
    });
  } catch {
    return assets.map(errorQuote);
  }
}

async function fetchStockQuote(asset: Asset): Promise<Quote> {
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

export default marketsModule;
