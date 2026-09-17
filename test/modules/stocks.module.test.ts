import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import stocksModule, { searchStocks, type StockCandidate } from "../../src/modules/stocks.module";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function candidate(overrides: Partial<StockCandidate> = {}): StockCandidate {
  return { query: "apple", symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", ...overrides };
}

describe("searchStocks", () => {
  test("garde uniquement les actions et ETF, ignore les autres types de cotation", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({
        quotes: [
          { symbol: "AAPL", shortname: "Apple Inc.", longname: "Apple Inc.", exchDisp: "NASDAQ", quoteType: "EQUITY" },
          { symbol: "URTH", shortname: "iShares MSCI World ETF", longname: "iShares MSCI World ETF", exchDisp: "NYSEArca", quoteType: "ETF" },
          { symbol: "SAAPL=F", shortname: "Apple futures", longname: "Apple futures", exchDisp: "CME", quoteType: "FUTURE" },
        ],
      }),
    );

    const results = await searchStocks("apple");
    assert.deepEqual(
      results.map((r) => r.symbol),
      ["AAPL", "URTH"],
    );
  });

  test("préfère longname à shortname (shortname est tronqué par Yahoo sans ellipse)", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({
        quotes: [
          {
            symbol: "ETZ.PA",
            shortname: "BNP Paribas Easy Stoxx Europe 6",
            longname: "BNP Paribas Easy Stoxx Europe 600 UCITS ETF EUR C",
            exchDisp: "Paris",
            quoteType: "ETF",
          },
        ],
      }),
    );

    const [result] = await searchStocks("bnp");
    assert.equal(result.name, "BNP Paribas Easy Stoxx Europe 600 UCITS ETF EUR C");
  });

  test("ignore une cotation sans aucun nom exploitable", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ quotes: [{ symbol: "AAPL", quoteType: "EQUITY" }] }));
    assert.deepEqual(await searchStocks("apple"), []);
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));
    await assert.rejects(() => searchStocks("apple"), /Yahoo Finance a répondu 500/);
  });
});

describe("stocksModule.fetchData", () => {
  test("calcule le prix, la devise et la variation à partir de la fiche Yahoo", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({
        chart: { result: [{ meta: { regularMarketPrice: 187.42, previousClose: 190, currency: "USD", longName: "Apple Inc." } }] },
      }),
    );

    const data = await stocksModule.fetchData({ assets: [{ stock: candidate() }] });
    assert.equal(data.quotes.length, 1);
    const [q] = data.quotes;
    assert.equal(q.label, "Apple Inc.");
    assert.equal(q.price, 187.42);
    assert.equal(q.currency, "USD");
    assert.ok(q.changePct !== null && q.changePct < 0); // 187.42 < 190 -> baisse
  });

  test("le libellé manuel (label) prime sur le nom récupéré via l'API", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 100, currency: "USD", longName: "Apple Inc." } }] } }),
    );

    const data = await stocksModule.fetchData({ assets: [{ stock: candidate(), label: "Mon label perso" }] });
    assert.equal(data.quotes[0].label, "Mon label perso");
  });

  test("dégrade en 'N/A' sans faire échouer tout le module si l'API échoue pour une valeur", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));

    const data = await stocksModule.fetchData({ assets: [{ stock: candidate() }] });
    assert.equal(data.quotes[0].price, null);
    assert.equal(data.quotes[0].label, "Apple Inc."); // repli sur le nom connu à la recherche
    assert.equal(data.quotes[0].error, "non disponible");
  });

  test("ignore les entrées sans action sélectionnée (stock null ou symbole manquant)", async () => {
    const data = await stocksModule.fetchData({ assets: [{ stock: null }] });
    assert.deepEqual(data.quotes, []);
  });
});

describe("stocksModule.renderReceipt", () => {
  test("affiche un message par défaut si aucune valeur n'est configurée", () => {
    const ctx = new ReceiptBuilder(48, 576);
    stocksModule.renderReceipt({ quotes: [] }, ctx, { assets: [] });
    assert.deepEqual(
      ctx.getLines().map((l) => l.text),
      ["BOURSE", "Aucune valeur configurée."],
    );
  });

  test("affiche 'N/A' pour une valeur en erreur, sans planter le reste du rendu", () => {
    const ctx = new ReceiptBuilder(48, 576);
    stocksModule.renderReceipt({ quotes: [{ label: "Apple Inc.", price: null, currency: "", changePct: null, error: "non disponible" }] }, ctx, { assets: [] });
    const line = ctx.getLines()[1].text;
    assert.ok(line.startsWith("Apple Inc."));
    assert.ok(line.endsWith("N/A"));
  });
});
