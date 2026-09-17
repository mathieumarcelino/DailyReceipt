import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import cryptoModule, { searchCryptos, type CryptoCandidate } from "../../src/modules/crypto.module";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function candidate(overrides: Partial<CryptoCandidate> = {}): CryptoCandidate {
  return { query: "bitcoin", id: "bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, ...overrides };
}

describe("searchCryptos", () => {
  test("met le symbole en majuscules et récupère le rang par capitalisation", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({ coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc", market_cap_rank: 1 }] }),
    );
    const [result] = await searchCryptos("bitcoin");
    assert.equal(result.symbol, "BTC");
    assert.equal(result.rank, 1);
  });

  test("rang à null si market_cap_rank est absent (jeton obscur non classé)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ coins: [{ id: "x", name: "X", symbol: "x" }] }));
    const [result] = await searchCryptos("x");
    assert.equal(result.rank, null);
  });

  test("limite à 8 résultats même si l'API en renvoie davantage", async (t) => {
    const coins = Array.from({ length: 20 }, (_, i) => ({ id: `coin-${i}`, name: `Coin ${i}`, symbol: `c${i}` }));
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ coins }));
    const results = await searchCryptos("coin");
    assert.equal(results.length, 8);
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));
    await assert.rejects(() => searchCryptos("bitcoin"), /CoinGecko a répondu 500/);
  });
});

describe("cryptoModule.fetchData", () => {
  test("associe chaque actif à sa cotation EUR et sa variation 24h", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ bitcoin: { eur: 65000, eur_24h_change: -1.2 } }));

    const data = await cryptoModule.fetchData({ assets: [{ crypto: candidate() }] });
    assert.deepEqual(data.quotes, [{ label: "Bitcoin", price: 65000, currency: "€", changePct: -1.2 }]);
  });

  test("le libellé manuel (label) prime sur le nom CoinGecko", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ bitcoin: { eur: 65000, eur_24h_change: 0 } }));
    const data = await cryptoModule.fetchData({ assets: [{ crypto: candidate(), label: "Mon label" }] });
    assert.equal(data.quotes[0].label, "Mon label");
  });

  test("dégrade en erreur pour un actif absent de la réponse groupée, sans jeter", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({})); // bitcoin absent de la réponse
    const data = await cryptoModule.fetchData({ assets: [{ crypto: candidate() }] });
    assert.equal(data.quotes[0].price, null);
    assert.equal(data.quotes[0].error, "non disponible");
  });

  test("dégrade toutes les cotations en erreur si l'appel groupé échoue, sans jeter", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));
    const data = await cryptoModule.fetchData({ assets: [{ crypto: candidate() }, { crypto: candidate({ id: "ethereum", name: "Ethereum" }) }] });
    assert.ok(data.quotes.every((q) => q.price === null && q.error === "non disponible"));
  });

  test("n'effectue aucun appel réseau si la liste d'actifs est vide", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}));
    const data = await cryptoModule.fetchData({ assets: [] });
    assert.deepEqual(data.quotes, []);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test("ignore les entrées sans crypto sélectionnée", async () => {
    const data = await cryptoModule.fetchData({ assets: [{ crypto: null }] });
    assert.deepEqual(data.quotes, []);
  });
});

describe("cryptoModule.renderReceipt", () => {
  test("affiche un message par défaut si aucune valeur n'est configurée", () => {
    const ctx = new ReceiptBuilder(48, 576);
    cryptoModule.renderReceipt({ quotes: [] }, ctx, { assets: [] });
    assert.deepEqual(
      ctx.getLines().map((l) => l.text),
      ["CRYPTO", "Aucune valeur configurée."],
    );
  });

  test("aligne les libellés tronqués de plusieurs cryptos sur la même colonne", () => {
    const ctx = new ReceiptBuilder(30, 576);
    cryptoModule.renderReceipt(
      {
        quotes: [
          { label: "Bitcoin", price: 65000, currency: "€", changePct: 1 },
          { label: "Un nom de crypto vraiment beaucoup trop long", price: 1, currency: "€", changePct: -1 },
        ],
      },
      ctx,
      { assets: [] },
    );
    const [, row1, row2] = ctx.getLines().map((l) => l.text);
    assert.equal(row1.length, 30);
    assert.equal(row2.length, 30);
    assert.ok(row2.includes("…"));
  });
});
