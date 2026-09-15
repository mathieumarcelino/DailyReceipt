import type { ReceiptModule } from "./types";

interface CryptoAsset {
  symbol: string;
  label: string;
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
        { key: "symbol", label: "Symbole", type: "text", placeholder: "bitcoin (identifiant CoinGecko)" },
        { key: "label", label: "Libellé affiché", type: "text", placeholder: "Bitcoin (BTC)" },
      ],
    },
  ],
  defaultConfig: {
    assets: [
      { symbol: "bitcoin", label: "Bitcoin (BTC)" },
      { symbol: "ethereum", label: "Ethereum (ETH)" },
    ],
  },

  async fetchData(config) {
    const assets = (config.assets ?? []).filter((a) => a.symbol?.trim());
    const quotes = await fetchCryptoQuotes(assets);
    return { quotes };
  },

  renderReceipt(data, ctx) {
    ctx.text("CRYPTO", { bold: true, underline: true });
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

function errorQuote(asset: CryptoAsset): Quote {
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

async function fetchCryptoQuotes(assets: CryptoAsset[]): Promise<Quote[]> {
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

export default cryptoModule;
