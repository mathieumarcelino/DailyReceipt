import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
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

type Config = Parameters<typeof newsModuleType.fetchData>[0];

interface FakeArticle {
  title: string;
  description?: string;
  hoursAgo: number;
}

function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Flux RSS dont les articles sont datés relativement à "maintenant" (le module filtre sur une fenêtre en heures). */
function rss(articles: FakeArticle[]): Response {
  const items = articles
    .map((a) => {
      const date = new Date(Date.now() - a.hoursAgo * 3_600_000).toUTCString();
      return `<item><title>${a.title}</title><link>https://example.com</link><description>${a.description ?? ""}</description><pubDate>${date}</pubDate></item>`;
    })
    .join("");
  return xmlResponse(`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`);
}

const geminiText = (text: string) => jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
const geminiSelection = (stories: { ids: string[]; score: number }[]) => geminiText(JSON.stringify({ stories }));

interface Network {
  /** Réponse du flux RSS pour une URL donnée. */
  rss: (url: string) => Response;
  /** Réponse à la passe 1 (tri) ; absente = cette passe ne doit pas être appelée. */
  selection?: (prompt: string) => Response;
  /** Réponse à la passe 2 (synthèse). */
  summary?: (prompt: string) => Response;
}

/** Simule le réseau et distingue les deux passes Gemini : seule la passe 1 demande une sortie JSON contrainte. */
function mockNetwork(t: TestContext, network: Network) {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (!String(url).includes("generativelanguage")) return network.rss(String(url));
    const body = JSON.parse(init!.body as string);
    const prompt = body.contents[0].parts[0].text as string;
    if (body.generationConfig?.responseSchema) {
      if (!network.selection) throw new Error("La passe 1 ne devait pas être appelée");
      return network.selection(prompt);
    }
    return (network.summary ?? (() => geminiText("Résumé.")))(prompt);
  });

  const geminiPrompts = (kind: "selection" | "summary") =>
    fetchMock.mock.calls
      .filter((c) => String(c.arguments[0]).includes("generativelanguage"))
      .map((c) => JSON.parse((c.arguments[1] as RequestInit).body as string))
      .filter((body) => Boolean(body.generationConfig?.responseSchema) === (kind === "selection"))
      .map((body) => body.contents[0].parts[0].text as string);

  return { fetchMock, selectionPrompts: () => geminiPrompts("selection"), summaryPrompts: () => geminiPrompts("summary") };
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    topics: [{ label: "Tech", feeds: [{ url: "https://example.com/rss.xml" }] }],
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

describe("newsModule.fetchData : configuration", () => {
  test("lève une erreur explicite si aucun sujet n'est configuré", async () => {
    await assert.rejects(() => newsModule.fetchData(baseConfig({ topics: [] })), /Configurez au moins un sujet/);
  });

  test("lève une erreur explicite si un sujet n'a aucun flux avec une URL", async () => {
    await assert.rejects(
      () => newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", feeds: [{ url: "" }] }] })),
      /Configurez au moins un sujet/,
    );
  });

  test("lève une erreur explicite si la clé API est absente", async () => {
    await assert.rejects(() => newsModule.fetchData(baseConfig({ apiKey: "" })), /clé API Gemini/);
  });
});

describe("newsModule.fetchData : cache et isolation des erreurs", () => {
  test("résume un sujet et met le résultat en cache (clé = sujet, pas l'URL)", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Titre", description: "Description", hoursAgo: 1 }]), summary: () => geminiText("Résumé généré.") });

    const data = await newsModule.fetchData(baseConfig());
    assert.deepEqual(data.topics, [{ label: "Tech", summary: "Résumé généré." }]);
    assert.equal(configStore.getConfig().state.newsCache?.["Tech"]?.summary, "Résumé généré.");
  });

  test("réutilise le cache du jour sans ré-appeler les flux ni l'IA", async (t) => {
    await clearCache();
    const { fetchMock } = mockNetwork(t, { rss: () => rss([{ title: "T", hoursAgo: 1 }]), summary: () => geminiText("Premier résumé.") });

    await newsModule.fetchData(baseConfig());
    assert.equal(fetchMock.mock.callCount(), 2);

    const data = await newsModule.fetchData(baseConfig());
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(data.topics[0].summary, "Premier résumé.");
  });

  test("un sujet en échec n'empêche pas les autres sujets d'être résumés", async (t) => {
    await clearCache();
    mockNetwork(t, {
      rss: (url) => (url.includes("panne") ? xmlResponse("", 500) : rss([{ title: "T", hoursAgo: 1 }])),
      summary: () => geminiText("Résumé OK."),
    });

    const data = await newsModule.fetchData(
      baseConfig({
        topics: [
          { label: "En panne", feeds: [{ url: "https://example.com/panne.xml" }] },
          { label: "OK", feeds: [{ url: "https://example.com/ok.xml" }] },
        ],
      }),
    );

    assert.equal(data.topics[0].summary, null);
    assert.match(data.topics[0].error ?? "", /500/);
    assert.equal(data.topics[1].summary, "Résumé OK.");
  });

  test("conserve l'ordre des sujets configuré", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "T", hoursAgo: 1 }]) });
    const topics = ["C", "A", "B"].map((label) => ({ label, feeds: [{ url: `https://example.com/${label}.xml` }] }));
    const data = await newsModule.fetchData(baseConfig({ topics }));
    assert.deepEqual(data.topics.map((x) => x.label), ["C", "A", "B"]);
  });
});

describe("newsModule.fetchData : période de recherche", () => {
  const empty = "aucun article trouvé sur les dernières 24 h";

  test("par défaut, seuls les articles des dernières 24 h sont retenus", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Trop vieux", hoursAgo: 30 }]) });
    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].error, empty);
  });

  test("retient un article de 20 h avec la période par défaut", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Récent", hoursAgo: 20 }]) });
    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].summary, "Résumé.");
  });

  test("hoursBack élargit la période", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Vieux de 30 h", hoursAgo: 30 }]) });
    const data = await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", hoursBack: 48, feeds: [{ url: "https://example.com/rss.xml" }] }] }));
    assert.equal(data.topics[0].summary, "Résumé.");
  });

  test("hoursBack est plafonné à 72 h même si l'utilisateur saisit beaucoup plus", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Vieux de 80 h", hoursAgo: 80 }]) });
    const tooOld = await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", hoursBack: 500, feeds: [{ url: "https://example.com/rss.xml" }] }] }));
    assert.equal(tooOld.topics[0].error, "aucun article trouvé sur les dernières 72 h");

    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Vieux de 60 h", hoursAgo: 60 }]) });
    const ok = await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", hoursBack: 500, feeds: [{ url: "https://example.com/rss.xml" }] }] }));
    assert.equal(ok.topics[0].summary, "Résumé.");
  });

  test("une valeur vide ou nulle de hoursBack retombe sur 24 h", async (t) => {
    await clearCache();
    mockNetwork(t, { rss: () => rss([{ title: "Vieux de 30 h", hoursAgo: 30 }]) });
    const data = await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", hoursBack: "" as unknown as number, feeds: [{ url: "https://example.com/rss.xml" }] }] }));
    assert.equal(data.topics[0].error, empty);
  });

  test("exclut les articles sans date exploitable", async (t) => {
    await clearCache();
    mockNetwork(t, {
      rss: () => xmlResponse(`<rss><channel><item><title>Sans date</title><description>D</description></item></channel></rss>`),
    });
    const data = await newsModule.fetchData(baseConfig());
    assert.equal(data.topics[0].error, empty);
  });
});

describe("newsModule.fetchData : passe 1 (tri) et passe 2 (synthèse)", () => {
  /** 5 articles récents (a1 = le plus récent) répartis sur un seul flux. */
  const fiveArticles: FakeArticle[] = [1, 2, 3, 4, 5].map((n) => ({ title: `Article ${n}`, description: `Détail ${n}`, hoursAgo: n }));
  const twoStories = (count = 2): Config =>
    baseConfig({ topics: [{ label: "Tech", storiesCount: count, feeds: [{ url: "https://example.com/rss.xml" }] }] });

  test("saute la passe 1 quand il y a autant d'articles que de sujets demandés", async (t) => {
    await clearCache();
    const net = mockNetwork(t, { rss: () => rss(fiveArticles.slice(0, 2)) });
    await newsModule.fetchData(twoStories(2));
    assert.equal(net.selectionPrompts().length, 0);
    assert.equal(net.summaryPrompts().length, 1);
  });

  test("passe 1 : n'envoie que id, source et titre, jamais les descriptions", async (t) => {
    await clearCache();
    const net = mockNetwork(t, { rss: () => rss(fiveArticles), selection: () => geminiSelection([{ ids: ["a1"], score: 0.9 }]) });
    await newsModule.fetchData(twoStories());

    const [prompt] = net.selectionPrompts();
    assert.match(prompt, /a1 \| example\.com \| Article 1/);
    assert.match(prompt, /a5 \| example\.com \| Article 5/);
    assert.ok(!prompt.includes("Détail"));
    assert.ok(prompt.includes('sujet "Tech"'));
    assert.ok(prompt.includes("Renvoie les 2 histoires"));
  });

  test("passe 2 : reçoit les histoires retenues, dans l'ordre des scores, avec toutes leurs versions", async (t) => {
    await clearCache();
    // Articles impairs sur le flux a, pairs sur le flux b : les versions d'une même histoire viennent de sources différentes.
    const net = mockNetwork(t, {
      rss: (url) => rss(fiveArticles.filter((_, i) => (i % 2 === 0) === url.includes("//a."))),
      selection: () =>
        geminiSelection([
          { ids: ["a3"], score: 0.5 },
          { ids: ["a1", "a2"], score: 0.9 },
        ]),
    });
    await newsModule.fetchData(
      baseConfig({ topics: [{ label: "Tech", storiesCount: 2, feeds: [{ url: "https://a.example.com/rss.xml" }, { url: "https://b.example.com/rss.xml" }] }] }),
    );

    const [prompt] = net.summaryPrompts();
    const first = prompt.indexOf("Histoire 1 (score d'importance 0.90)");
    const second = prompt.indexOf("Histoire 2 (score d'importance 0.50)");
    assert.ok(first !== -1 && second > first);
    assert.ok(prompt.indexOf("Article 1") > first && prompt.indexOf("Article 2") > first && prompt.indexOf("Article 2") < second);
    assert.ok(prompt.indexOf("Article 3") > second);
    assert.ok(!prompt.includes("Article 4") && !prompt.includes("Article 5"));
    assert.ok(prompt.includes("Détail 1"));
  });

  test("ignore les ids inconnus ou répétés renvoyés par l'IA", async (t) => {
    await clearCache();
    const net = mockNetwork(t, {
      rss: () => rss(fiveArticles),
      selection: () =>
        geminiSelection([
          { ids: ["zz", "a2"], score: 0.8 },
          { ids: ["a2", "a4"], score: 0.7 },
        ]),
    });
    await newsModule.fetchData(twoStories());

    const [prompt] = net.summaryPrompts();
    assert.equal(prompt.match(/Article 2/g)?.length, 1);
    assert.ok(prompt.includes("Article 4") && !prompt.includes("Article 1"));
  });

  test("limite les versions d'une même histoire (une par source, 4 au maximum)", async (t) => {
    await clearCache();
    const hosts = ["a", "b", "c", "d", "e", "f"];
    const net = mockNetwork(t, {
      rss: (url) => rss([{ title: `Version ${url.split("//")[1].split(".")[0]}`, description: "Description", hoursAgo: 1 }]),
      selection: () => geminiSelection([{ ids: ["a1", "a2", "a3", "a4", "a5", "a6"], score: 0.9 }]),
    });
    await newsModule.fetchData(baseConfig({ topics: [{ label: "Tech", storiesCount: 1, feeds: hosts.map((h) => ({ url: `https://${h}.example.com/rss.xml` })) }] }));

    const [prompt] = net.summaryPrompts();
    assert.equal(prompt.match(/^- \[/gm)?.length, 4);
  });

  test("plafonne les candidats de la passe 1 à 200 titres, les plus récents d'abord", async (t) => {
    await clearCache();
    const many = Array.from({ length: 250 }, (_, i) => ({ title: `Titre ${i + 1}`, hoursAgo: 0.01 + i * 0.05 }));
    const net = mockNetwork(t, { rss: () => rss(many), selection: () => geminiSelection([{ ids: ["a1"], score: 0.9 }]) });
    await newsModule.fetchData(twoStories());

    const [prompt] = net.selectionPrompts();
    assert.ok(prompt.includes("a200 | example.com | Titre 200"));
    assert.ok(!prompt.includes("a201 |"));
  });

  test("dédoublonne les titres identiques avant la passe 1", async (t) => {
    await clearCache();
    const net = mockNetwork(t, {
      rss: () => rss([{ title: "Même titre", hoursAgo: 1 }]),
    });
    await newsModule.fetchData(
      baseConfig({
        topics: [{ label: "Tech", storiesCount: 5, feeds: [{ url: "https://a.example.com/rss.xml" }, { url: "https://b.example.com/rss.xml" }] }],
      }),
    );
    assert.equal(net.selectionPrompts().length, 0); // un seul candidat restant : passe 1 inutile
    assert.equal(net.summaryPrompts()[0].match(/Même titre/g)?.length, 1);
  });

  test("repli sur les articles les plus récents (sources alternées) si la passe 1 renvoie un JSON invalide", async (t) => {
    await clearCache();
    const net = mockNetwork(t, {
      rss: (url) => (url.includes("//a.") ? rss([1, 2, 3].map((n) => ({ title: `A${n}`, hoursAgo: n }))) : rss([{ title: "B1", hoursAgo: 1.5 }])),
      selection: () => geminiText("ceci n'est pas du JSON"),
    });
    const data = await newsModule.fetchData(
      baseConfig({ topics: [{ label: "Tech", storiesCount: 2, feeds: [{ url: "https://a.example.com/rss.xml" }, { url: "https://b.example.com/rss.xml" }] }] }),
    );

    assert.equal(net.selectionPrompts().length, 2); // 1 essai + 1 nouvelle tentative
    assert.equal(data.topics[0].summary, "Résumé."); // le ticket est produit malgré tout
    const [prompt] = net.summaryPrompts();
    assert.ok(prompt.includes("A1") && prompt.includes("B1") && !prompt.includes("A2"));
    assert.ok(!prompt.includes("score d'importance"));
  });

  test("repli si l'appel de la passe 1 échoue", async (t) => {
    await clearCache();
    const net = mockNetwork(t, { rss: () => rss(fiveArticles), selection: () => jsonResponse({ error: { message: "bad" } }, 400) });
    const data = await newsModule.fetchData(twoStories());
    assert.equal(data.topics[0].summary, "Résumé.");
    assert.ok(net.summaryPrompts()[0].includes("Article 1"));
  });

  test("un sujet peut regrouper plusieurs flux, fusionnés en un seul résumé", async (t) => {
    await clearCache();
    const net = mockNetwork(t, {
      rss: (url) => rss([{ title: url.includes("//a.") ? "Article A" : "Article B", hoursAgo: 1 }]),
      summary: () => geminiText("Résumé fusionné."),
    });
    const data = await newsModule.fetchData(
      baseConfig({ topics: [{ label: "Tech", feeds: [{ url: "https://a.example.com/rss.xml" }, { url: "https://b.example.com/rss.xml" }] }] }),
    );

    assert.equal(data.topics.length, 1);
    assert.equal(data.topics[0].summary, "Résumé fusionné.");
    assert.equal(net.summaryPrompts().length, 1);
    assert.ok(net.summaryPrompts()[0].includes("Article A") && net.summaryPrompts()[0].includes("Article B"));
  });

  test("un flux en échec au sein d'un sujet n'empêche pas les autres flux du même sujet de contribuer", async (t) => {
    await clearCache();
    mockNetwork(t, {
      rss: (url) => (url.includes("panne") ? xmlResponse("", 500) : rss([{ title: "Article OK", hoursAgo: 1 }])),
      summary: () => geminiText("Résumé partiel."),
    });
    const data = await newsModule.fetchData(
      baseConfig({ topics: [{ label: "Tech", feeds: [{ url: "https://example.com/panne.xml" }, { url: "https://example.com/ok.xml" }] }] }),
    );
    assert.equal(data.topics[0].summary, "Résumé partiel.");
  });

  test("transmet le prompt personnalisé du sujet (variables résolues) et garde le prompt par défaut pour les autres", async (t) => {
    await clearCache();
    const net = mockNetwork(t, { rss: () => rss([{ title: "T", hoursAgo: 1 }]) });
    await newsModule.fetchData(
      baseConfig({
        topics: [
          { label: "Perso", prompt: "Consigne spéciale {sujet} sur {nombre_sujets} histoire(s)", feeds: [{ url: "https://example.com/a.xml" }] },
          { label: "Defaut", feeds: [{ url: "https://example.com/b.xml" }] },
        ],
      }),
    );

    const prompts = net.summaryPrompts();
    assert.equal(prompts.length, 2);
    assert.ok(prompts.some((p) => p.startsWith("Consigne spéciale Perso sur 1 histoire(s)")));
    assert.ok(prompts.some((p) => p.includes("téléscripteur") && p.includes('"Defaut"')));
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
