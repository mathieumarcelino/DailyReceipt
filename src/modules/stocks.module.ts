import type { ReceiptModule } from "./types";

export interface StockCandidate {
  query: string;
  symbol: string;
  name: string;
  exchange: string;
}

/** Types de cotation pertinents pour un suivi boursier personnel (on exclut futures, options, devises...). */
const ALLOWED_QUOTE_TYPES = new Set(["EQUITY", "ETF"]);

interface StockAsset {
  stock: StockCandidate | null;
  /** Surcharge optionnelle du libellé récupéré automatiquement via l'API (champ shortName). */
  label?: string;
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
  description: "Cours d'actions",
  dataSource: "finance.yahoo.com",
  configSchema: [
    {
      key: "assets",
      label: "Actions suivies",
      type: "array",
      itemLabel: "Action",
      itemSchema: [
        { key: "stock", label: "Action", type: "stock-search" },
        {
          key: "label",
          label: "Libellé affiché",
          type: "text",
          placeholder: "Apple (AAPL)",
          help: "Laissez vide pour utiliser le nom récupéré automatiquement depuis Yahoo Finance.",
        },
      ],
    },
  ],
  defaultConfig: { assets: [] },

  async fetchData(config) {
    const assets = (config.assets ?? []).filter((a): a is StockAsset & { stock: StockCandidate } => Boolean(a.stock?.symbol));
    const quotes = await Promise.all(assets.map(fetchStockQuote));
    return { quotes };
  },

  renderReceipt(data, ctx) {
    ctx.text("BOURSE", { bold: true, underline: true });
    if (data.quotes.length === 0) {
      ctx.text("Aucune valeur configurée.");
    }
    const rows = data.quotes.map((q) => ({ label: q.label, value: formatQuoteValue(q) }));
    // Largeur réservée à la colonne valeur commune à toutes les lignes, pour que les libellés
    // tronqués s'arrêtent tous à la même colonne plutôt qu'en escalier.
    const rightColumnWidth = Math.max(0, ...rows.map((r) => r.value.length));
    for (const row of rows) {
      ctx.row(row.label, row.value, { rightColumnWidth });
    }
  },
};

/** Recherche d'actions par nom ou symbole (utilisé par fetchData ET par la route de recherche du Constructeur). */
export async function searchStocks(query: string): Promise<StockCandidate[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (DailyReceipt)" } });
  if (!res.ok) throw new Error(`Yahoo Finance a répondu ${res.status}`);

  const json: any = await res.json();
  const quotes: any[] = Array.isArray(json?.quotes) ? json.quotes : [];

  return quotes
    .filter((q) => ALLOWED_QUOTE_TYPES.has(q?.quoteType) && q?.symbol && (q?.longname || q?.shortname))
    .map(
      (q): StockCandidate => ({
        query,
        symbol: q.symbol,
        // longname est préféré à shortname : ce dernier est tronqué par Yahoo lui-même à ~31
        // caractères sans "…" (ex: "BNP Paribas Easy Stoxx Europe 6"), longname donne le nom complet.
        name: q.longname || q.shortname,
        exchange: q.exchDisp ?? q.exchange ?? "",
      }),
    );
}

function errorQuote(asset: StockAsset & { stock: StockCandidate }): Quote {
  return { label: asset.label?.trim() || asset.stock.name || asset.stock.symbol, price: null, currency: "", changePct: null, error: "non disponible" };
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

/** Texte de la colonne valeur pour une cotation (ex: "187.42 USD (-0.2%)" ou "N/A"). */
function formatQuoteValue(q: Quote): string {
  if (q.price == null) return "N/A";
  const sign = q.changePct != null && q.changePct >= 0 ? "+" : "";
  const change = q.changePct != null ? ` (${sign}${q.changePct.toFixed(1)}%)` : "";
  return `${formatPrice(q.price)} ${q.currency}${change}`;
}

async function fetchStockQuote(asset: StockAsset & { stock: StockCandidate }): Promise<Quote> {
  const symbol = asset.stock.symbol.trim();
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
    // longName/shortName donnent un libellé lisible ("Apple Inc.", "LVMH"...) sans avoir à le saisir
    // manuellement — shortName est tronqué par Yahoo lui-même à ~31 caractères sans "…", longName
    // donne le nom complet. Reste surchargeable via le champ "label" si l'utilisateur le préfère.
    const apiName = [meta.longName, meta.shortName].find((n) => typeof n === "string" && n.trim());
    const apiLabel = apiName?.trim() || asset.stock.name || symbol;
    const label = asset.label?.trim() || apiLabel;

    return { label, price, currency: meta.currency ?? "", changePct };
  } catch {
    return errorQuote(asset);
  }
}

export default stocksModule;
