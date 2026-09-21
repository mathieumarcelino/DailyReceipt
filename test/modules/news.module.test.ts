import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReceiptBuilder } from "../../src/receipt/context";
import type newsModuleType from "../../src/modules/news.module";

// `news.module.ts` importe le singleton `configStore`, qui lit/crée un fichier de config dès sa
// construction (au premier `require`). On pointe `CONFIG_PATH` vers un fichier temporaire avant tout
// import du module pour isoler ces tests du vrai `data/config.json`, comme le ferait un déploiement
// réel avec une variable d'environnement dédiée.
const tmpConfigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dailyreceipt-news-test-")), "config.json");
process.env.CONFIG_PATH = tmpConfigPath;

let newsModule: typeof newsModuleType;
let configStore: typeof import("../../src/config/store").configStore;

before(async () => {
  newsModule = (await import("../../src/modules/news.module")).default;
  ({ configStore } = await import("../../src/config/store"));
});

function fakeXmlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status });
}

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Le module ne retient que les articles publiés aujourd'hui ou hier (jour calendaire local) : les
// fixtures datent donc leurs articles par défaut sur "aujourd'hui" pour rester dans cette fenêtre.
function rssFixture(title: string, description: string, pubDate: Date = new Date()): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://example.com</link><description>${description}</description><pubDate>${pubDate.toUTCString()}</pubDate></item></channel></rss>`;
}

function rssFixtureMultiItems(items: { title: string; description: string; pubDate: Date }[]): string {
  const itemsXml = items
    .map((i) => `<item><title>${i.title}</title><link>https://example.com</link><description>${i.description}</description><pubDate>${i.pubDate.toUTCString()}</pubDate></item>`)
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel>${itemsXml}</channel></rss>`;
}

function geminiFixture(text: string): Response {
  return fakeJsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function baseConfig(overrides: Partial<Parameters<typeof newsModuleType.fetchData>[0]> = {}) {
  return {
    topics: [{ label: "Tech", feeds: [{ url: "https://example.com/rss.xml", maxArticles: 3 }] }],
    summaryTargetLines: 20,
    apiKey: "test-key",
    model: "gemini-test",
    ...overrides,
  };
}

async function clearCache() {
  await configStore.updateConfig((draft) => {
    draft.state.newsCache = {};
  });
}

describe("newsModule.fetchData", () => {
  test("lève une erreur explicite si aucun sujet n'est configuré", async () => {
    await assert.rejects(() => newsModule.fetchData(baseConfig({ topics: [] })), /Configurez au moins un sujet/);
  });

  test("lève une erreur explicite si un sujet n'a aucun flux avec une URL", async () => {
    await assert.rejects(
      () => newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", feeds: [{ url: "", maxArticles: 3 }] }] })),
      /Configurez au moins un sujet/,
    );
  });

  test("lève une erreur explicite si la clé API est absente", async () => {
    await assert.rejects(() => newsModule.fetchData(baseConfig({ apiKey: "" })), /clé API Gemini/);
  });

  test("résume un sujet et met le résultat en cache (clé = sujet, pas l'URL)", async (t) => {
    await clearCache();
    let call = 0;
    t.mock.method(globalThis, "fetch", async () => {
      call += 1;
      return call === 1 ? fakeXmlResponse(rssFixture("Titre", "Description")) : geminiFixture("Résumé généré.");
    });

    const data = await newsModule.fetchData(baseConfig());
    assert.deepEqual(data.topics, [{ label: "Tech", summary: "Résumé généré." }]);

    const cached = configStore.getConfig().state.newsCache?.["Tech"];
    assert.equal(cached?.summary, "Résumé généré.");
  });

  test("réutilise le cache du jour sans ré-appeler le flux ni l'IA", async (t) => {
    await clearCache();
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) =>
      String(url).includes("generativelanguage") ? geminiFixture("Premier résumé.") : fakeXmlResponse(rssFixture("T", "D")),
    );

    await newsModule.fetchData(baseConfig());
    assert.equal(fetchMock.mock.callCount(), 2);

    const data = await newsModule.fetchData(baseConfig());
    assert.equal(fetchMock.mock.callCount(), 2); // aucun appel supplémentaire
    assert.equal(data.topics[0].summary, "Premier résumé.");
  });

  test("un sujet en échec n'empêche pas les autres sujets d'être résumés", async (t) => {
    await clearCache();
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (String(url).includes("generativelanguage")) return geminiFixture("Résumé OK.");
      if (String(url).includes("panne")) return fakeXmlResponse("", 500);
      return fakeXmlResponse(rssFixture("T", "D"));
    });

    const data = await newsModule.fetchData(
      baseConfig({
        topics: [
          { label: "En panne", feeds: [{ url: "https://example.com/panne.xml", maxArticles: 3 }] },
          { label: "OK", feeds: [{ url: "https://example.com/ok.xml", maxArticles: 3 }] },
        ],
      }),
    );

    assert.equal(data.topics[0].summary, null);
    assert.match(data.topics[0].error ?? "", /500/);
    assert.equal(data.topics[1].summary, "Résumé OK.");
  });

  test("un flux sans article renvoie une erreur dédiée plutôt qu'un résumé vide", async (t) => {
    await clearCache();
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse("<rss><channel></channel></rss>"));

    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].summary, null);
    assert.equal(data.topics[0].error, "aucun article récent trouvé (aujourd'hui/hier)");
  });

  test("exclut les articles publiés avant J-1", async (t) => {
    await clearCache();
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(rssFixture("Vieil article", "Description", daysAgo(3))));

    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].summary, null);
    assert.equal(data.topics[0].error, "aucun article récent trouvé (aujourd'hui/hier)");
  });

  test("retient les articles publiés hier (J-1), pas seulement aujourd'hui", async (t) => {
    await clearCache();
    t.mock.method(globalThis, "fetch", async (url: string) =>
      String(url).includes("generativelanguage") ? geminiFixture("Résumé.") : fakeXmlResponse(rssFixture("Hier", "D", daysAgo(1))),
    );

    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].summary, "Résumé.");
  });

  test("un sujet peut regrouper plusieurs flux, fusionnés en un seul résumé", async (t) => {
    await clearCache();
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) => {
      if (String(url).includes("generativelanguage")) return geminiFixture("Résumé fusionné.");
      if (String(url).includes("source-a")) return fakeXmlResponse(rssFixture("Article A", "Desc A"));
      return fakeXmlResponse(rssFixture("Article B", "Desc B"));
    });

    const data = await newsModule.fetchData(
      baseConfig({
        topics: [
          {
            label: "Tech",
            feeds: [
              { url: "https://example.com/source-a.xml", maxArticles: 5 },
              { url: "https://example.com/source-b.xml", maxArticles: 5 },
            ],
          },
        ],
      }),
    );

    // Un seul sujet malgré deux flux, et les deux flux ont bien été interrogés (2 RSS + 1 Gemini).
    assert.equal(data.topics.length, 1);
    assert.equal(data.topics[0].label, "Tech");
    assert.equal(data.topics[0].summary, "Résumé fusionné.");
    assert.equal(fetchMock.mock.callCount(), 3);

    const geminiCall = fetchMock.mock.calls.find((c) => String(c.arguments[0]).includes("generativelanguage"))!;
    const prompt = JSON.parse((geminiCall.arguments[1] as RequestInit).body as string).contents[0].parts[0].text;
    assert.ok(prompt.includes("Article A"));
    assert.ok(prompt.includes("Article B"));
  });

  test("un flux en échec au sein d'un sujet multi-flux n'empêche pas les autres flux du même sujet de contribuer", async (t) => {
    await clearCache();
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (String(url).includes("generativelanguage")) return geminiFixture("Résumé partiel.");
      if (String(url).includes("panne")) return fakeXmlResponse("", 500);
      return fakeXmlResponse(rssFixture("Article OK", "Desc"));
    });

    const data = await newsModule.fetchData(
      baseConfig({
        topics: [
          {
            label: "Tech",
            feeds: [
              { url: "https://example.com/panne.xml", maxArticles: 5 },
              { url: "https://example.com/ok.xml", maxArticles: 5 },
            ],
          },
        ],
      }),
    );

    assert.equal(data.topics.length, 1);
    assert.equal(data.topics[0].summary, "Résumé partiel.");
  });

  test("respecte maxArticles par flux même quand plus d'articles récents sont disponibles", async (t) => {
    await clearCache();
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `Article ${i}`, description: `Desc ${i}`, pubDate: new Date() }));
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) =>
      String(url).includes("generativelanguage") ? geminiFixture("Résumé.") : fakeXmlResponse(rssFixtureMultiItems(items)),
    );

    await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", feeds: [{ url: "https://example.com/rss.xml", maxArticles: 2 }] }] }));

    const geminiCall = fetchMock.mock.calls.find((c) => String(c.arguments[0]).includes("generativelanguage"))!;
    const prompt = JSON.parse((geminiCall.arguments[1] as RequestInit).body as string).contents[0].parts[0].text;
    const matches = prompt.match(/Article \d/g) ?? [];
    assert.equal(matches.length, 2);
  });
});

describe("newsModule.renderReceipt", () => {
  test("n'affiche rien si aucun sujet", () => {
    const ctx = new ReceiptBuilder(48, 576);
    newsModule.renderReceipt({ topics: [] }, ctx, baseConfig());
    assert.deepEqual(ctx.getLines(), []);
  });

  test("affiche le résumé de chaque sujet, ou 'Indisponible' en cas d'erreur", () => {
    const ctx = new ReceiptBuilder(48, 576);
    newsModule.renderReceipt(
      {
        topics: [
          { label: "Tech", summary: "Un résumé." },
          { label: "Sport", summary: null, error: "aucun article trouvé" },
        ],
      },
      ctx,
      baseConfig(),
    );

    const lines = ctx.getLines().map((l) => l.text);
    assert.deepEqual(lines, ["ACTUALITÉS", "TECH", "Un résumé.", "", "SPORT", "Indisponible (aucun article trouvé)"]);
  });
});
