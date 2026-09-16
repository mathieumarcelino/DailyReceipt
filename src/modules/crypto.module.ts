import type { ReceiptModule } from "./types";

export interface CryptoCandidate {
  query: string;
  id: string;
  name: string;
  symbol: string;
  rank: number | null;
}

interface CryptoAsset {
  crypto: CryptoCandidate | null;
  /** Surcharge optionnelle du libellé récupéré automatiquement via l'API. */
  label?: string;
}

interface CryptoConfig {
  assets: CryptoAsset[];
}

interface Quote {
  label: string;
  price: number | null;
  currency: string;
  changePct: number | null;
  error?: string;
}

interface CryptoData {
  quotes: Quote[];
}

const cryptoModule: ReceiptModule<CryptoConfig, CryptoData> = {
  id: "crypto",
  name: "Crypto",
  description: "Cours de cryptomonnaies",
  dataSource: "coingecko.com",
  configSchema: [
    {
      key: "assets",
      label: "Cryptos suivies",
      type: "array",
      itemLabel: "Crypto",
      itemSchema: [
        { key: "crypto", label: "Crypto", type: "crypto-search" },
        {
          key: "label",
          label: "Libellé affiché",
          type: "text",
          placeholder: "Bitcoin (BTC)",
          help: "Laissez vide pour utiliser le nom récupéré automatiquement depuis CoinGecko.",
        },
      ],
    },
  ],
  defaultConfig: {
    assets: [
      { crypto: { query: "bitcoin", id: "bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1 } },
      { crypto: { query: "ethereum", id: "ethereum", name: "Ethereum", symbol: "ETH", rank: 2 } },
    ],
  },

  async fetchData(config) {
    const assets = (config.assets ?? []).filter((a): a is CryptoAsset & { crypto: CryptoCandidate } => Boolean(a.crypto?.id));
    const quotes = await fetchCryptoQuotes(assets);
    return { quotes };
  },

  renderReceipt(data, ctx) {
    ctx.text("CRYPTO", { bold: true, underline: true });
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

/** Recherche de cryptos par nom ou symbole (utilisé par fetchData ET par la route de recherche du Constructeur). */
export async function searchCryptos(query: string): Promise<CryptoCandidate[]> {
  const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`CoinGecko a répondu ${res.status}`);

  const json: any = await res.json();
  const coins: any[] = Array.isArray(json?.coins) ? json.coins : [];

  return coins.slice(0, 8).map(
    (c): CryptoCandidate => ({
      query,
      id: c.id,
      name: c.name,
      symbol: typeof c.symbol === "string" ? c.symbol.toUpperCase() : "",
      rank: typeof c.market_cap_rank === "number" ? c.market_cap_rank : null,
    }),
  );
}

function errorQuote(asset: CryptoAsset & { crypto: CryptoCandidate }): Quote {
  return {
    label: asset.label?.trim() || asset.crypto.name || asset.crypto.symbol,
    price: null,
    currency: "",
    changePct: null,
    error: "non disponible",
  };
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

/** Texte de la colonne valeur pour une cotation (ex: "45 000 € (-0.6%)" ou "N/A"). */
function formatQuoteValue(q: Quote): string {
  if (q.price == null) return "N/A";
  const sign = q.changePct != null && q.changePct >= 0 ? "+" : "";
  const change = q.changePct != null ? ` (${sign}${q.changePct.toFixed(1)}%)` : "";
  return `${formatPrice(q.price)} ${q.currency}${change}`;
}

async function fetchCryptoQuotes(assets: (CryptoAsset & { crypto: CryptoCandidate })[]): Promise<Quote[]> {
  if (assets.length === 0) return [];
  const ids = assets.map((a) => a.crypto.id.trim()).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur&include_24hr_change=true`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`CoinGecko a répondu ${res.status}`);
    const json: any = await res.json();

    return assets.map((asset) => {
      const entry = json[asset.crypto.id.trim()];
      if (!entry) return errorQuote(asset);
      return {
        label: asset.label?.trim() || asset.crypto.name || asset.crypto.symbol,
        price: entry.eur ?? null,
        currency: "€",
        changePct: entry.eur_24h_change ?? null,
      };
    });
  } catch {
    return assets.map(errorQuote);
  }
}

export default cryptoModule;
