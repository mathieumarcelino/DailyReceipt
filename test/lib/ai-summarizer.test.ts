import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, selectStoriesWithGemini, summarizeWithGemini, type SelectOptions, type SummarizeOptions } from "../../src/lib/ai-summarizer";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function geminiSuccess(text: string) {
  return fakeJsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function options(overrides: Partial<SummarizeOptions> = {}): SummarizeOptions {
  return { apiKey: "key", model: "m", maxChars: 100, topic: "Tech", retryDelayMs: 0, ...overrides };
}

describe("summarizeWithGemini", () => {
  test("renvoie le texte résumé tel quel s'il tient dans la limite", async (t) => {
    t.mock.method(globalThis, "fetch", async () => geminiSuccess("Un court résumé."));
    const summary = await summarizeWithGemini("texte source", options());
    assert.equal(summary, "Un court résumé.");
  });

  test("construit l'URL avec le modèle et la clé API encodés", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("texte", options({ apiKey: "ma clé", model: "gemini-2.5-flash-lite" }));

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.ok(String(url).includes("/models/gemini-2.5-flash-lite:generateContent"));
    assert.ok(String(url).includes(`key=${encodeURIComponent("ma clé")}`));
  });

  test("tolère un nom de modèle copié avec le préfixe 'models/' (format renvoyé par l'API de listing)", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("texte", options({ model: "models/gemini-2.5-flash-lite" }));

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.ok(String(url).includes("/models/gemini-2.5-flash-lite:generateContent"));
    assert.ok(!String(url).includes("%2F"));
  });

  test("envoie le texte source et la longueur cible dans le prompt", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("- article 1\n- article 2", options({ maxChars: 250 }));

    const [, init] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse((init as RequestInit).body as string);
    const prompt = body.contents[0].parts[0].text;
    assert.ok(prompt.includes("250"));
    assert.ok(prompt.includes("- article 1\n- article 2"));
  });

  test("le prompt par défaut demande une ligne courte par histoire commençant par un tiret, variables résolues", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("texte", options({ topic: "Paris Saint Germain", maxChars: 960, storiesCount: 5 }));

    const [, init] = fetchMock.mock.calls[0].arguments;
    const prompt = JSON.parse((init as RequestInit).body as string).contents[0].parts[0].text;
    assert.ok(prompt.includes('sujet "Paris Saint Germain"'));
    assert.ok(prompt.includes("Voici 5 histoires"));
    assert.ok(prompt.includes("exactement une ligne par histoire"));
    assert.ok(prompt.includes('commence par un tiret "-"'));
    assert.ok(prompt.includes("192 caractères maximum")); // 960 / 5 histoires
    assert.ok(prompt.includes("960 caractères maximum"));
    assert.ok(!/\{[a-z_]+\}/.test(prompt), "aucune variable ne doit rester non résolue");
  });

  test("tronque avec une ellipse si la réponse dépasse largement la longueur cible", async (t) => {
    const longText = "a".repeat(1000);
    t.mock.method(globalThis, "fetch", async () => geminiSuccess(longText));
    const summary = await summarizeWithGemini("texte", options());

    assert.equal(summary.length, 150);
    assert.ok(summary.endsWith("…"));
  });

  test("lève une erreur explicite en cas d'échec HTTP persistant, avec le message de Google", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({ error: { message: "The model is overloaded." } }, 503),
    );
    await assert.rejects(() => summarizeWithGemini("texte", options()), /Gemini a répondu 503 \(The model is overloaded\.\)/);
    assert.equal(fetchMock.mock.callCount(), 3); // 1 essai + 2 nouvelles tentatives
  });

  test("réessaie après un 503 passager et renvoie le résumé si la tentative suivante réussit", async (t) => {
    let call = 0;
    t.mock.method(globalThis, "fetch", async () => (++call === 1 ? fakeJsonResponse({}, 503) : geminiSuccess("Résumé.")));
    assert.equal(await summarizeWithGemini("texte", options()), "Résumé.");
    assert.equal(call, 2);
  });

  test("réessaie après un timeout", async (t) => {
    let call = 0;
    t.mock.method(globalThis, "fetch", async () => {
      if (++call === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return geminiSuccess("Résumé.");
    });
    assert.equal(await summarizeWithGemini("texte", options()), "Résumé.");
  });

  test("signale clairement un timeout persistant", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await assert.rejects(() => summarizeWithGemini("texte", options()), /n'a pas répondu à temps/);
  });

  test("ne réessaie pas sur une erreur définitive (ex: 404 modèle introuvable)", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ error: { message: "model not found" } }, 404));
    await assert.rejects(() => summarizeWithGemini("texte", options()), /Gemini a répondu 404/);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test("lève une erreur explicite si la réponse ne contient pas de texte exploitable", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ candidates: [] }));
    await assert.rejects(() => summarizeWithGemini("texte", options()), /Réponse Gemini invalide/);
  });

  test("lève une erreur explicite si le résumé renvoyé est une chaîne vide", async (t) => {
    t.mock.method(globalThis, "fetch", async () => geminiSuccess("   "));
    await assert.rejects(() => summarizeWithGemini("texte", options()), /Réponse Gemini invalide/);
  });
});

describe("buildPrompt", () => {
  test("utilise le prompt par défaut si aucun prompt personnalisé (ou vide) n'est fourni", () => {
    const base = { topic: "Tech", maxChars: 100 };
    assert.equal(buildPrompt("A", base), buildPrompt("A", { ...base, customPrompt: "   " }));
    assert.ok(buildPrompt("A", base).includes("téléscripteur"));
  });

  test("le prompt personnalisé remplace le prompt par défaut, résout les variables et ajoute les articles", () => {
    const prompt = buildPrompt("- article 1", {
      topic: "Sport",
      maxChars: 200,
      storiesCount: 5,
      customPrompt: "Résume le {sujet} en {longueur_max} car. (viser {longueur_cible}) sur {nombre_sujets} histoires.",
    });
    assert.ok(prompt.startsWith("Résume le Sport en 200 car. (viser 120) sur 5 histoires.\n\nHistoires (classées par importance décroissante"));
    assert.ok(prompt.endsWith("\n- article 1"));
    assert.ok(!prompt.includes("téléscripteur"));
  });

  test("summarizeWithGemini envoie le prompt personnalisé à l'API", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("texte", options({ customPrompt: "Consigne perso pour {sujet}" }));
    const [, init] = fetchMock.mock.calls[0].arguments;
    const sent = JSON.parse((init as RequestInit).body as string).contents[0].parts[0].text;
    assert.ok(sent.startsWith("Consigne perso pour Tech"));
  });
});

describe("selectStoriesWithGemini", () => {
  const candidates = [
    { id: "a1", source: "lemonde.fr", title: "Titre 1" },
    { id: "a2", source: "theverge.com", title: "Titre 2" },
    { id: "a3", source: "numerama.com", title: "Titre 3" },
  ];
  const selectOptions = (overrides: Partial<SelectOptions> = {}): SelectOptions => ({ apiKey: "key", model: "m", topic: "Tech", count: 2, retryDelayMs: 0, ...overrides });
  const selection = (stories: unknown) => geminiSuccess(JSON.stringify({ stories }));

  test("renvoie les histoires triées par score décroissant et coupées au nombre demandé", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      selection([
        { ids: ["a1"], score: 0.4 },
        { ids: ["a2", "a3"], score: 0.9 },
        { ids: ["a1"], score: 0.7 },
      ]),
    );
    const result = await selectStoriesWithGemini(candidates, selectOptions());
    assert.deepEqual(result, [{ ids: ["a2", "a3"], score: 0.9 }, { ids: ["a1"], score: 0.4 }]);
  });

  test("ignore les ids inconnus et répétés, borne les scores à [0, 1]", async (t) => {
    t.mock.method(globalThis, "fetch", async () => selection([{ ids: ["zz", "a1", "a1"], score: 3 }, { ids: ["nope"], score: 0.5 }, { ids: ["a2"], score: "n/a" }]));
    const result = await selectStoriesWithGemini(candidates, selectOptions({ count: 5 }));
    assert.deepEqual(result, [{ ids: ["a1"], score: 1 }, { ids: ["a2"], score: 0 }]);
  });

  test("envoie uniquement id | source | titre, le schéma JSON et une réflexion réduite", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => selection([{ ids: ["a1"], score: 0.5 }]));
    await selectStoriesWithGemini(candidates, selectOptions());

    const body = JSON.parse((fetchMock.mock.calls[0].arguments[1] as RequestInit).body as string);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.ok(body.generationConfig.responseSchema);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.ok(body.contents[0].parts[0].text.includes("a2 | theverge.com | Titre 2"));
  });

  test("retente une fois si la réponse n'est pas exploitable, puis renvoie le résultat valide", async (t) => {
    let call = 0;
    t.mock.method(globalThis, "fetch", async () => (++call === 1 ? geminiSuccess("pas du JSON") : selection([{ ids: ["a1"], score: 0.5 }])));
    assert.deepEqual(await selectStoriesWithGemini(candidates, selectOptions()), [{ ids: ["a1"], score: 0.5 }]);
    assert.equal(call, 2);
  });

  test("extrait le JSON d'une réponse entourée de texte ou de balises Markdown", async (t) => {
    t.mock.method(globalThis, "fetch", async () => geminiSuccess('```json\n{"stories":[{"ids":["a3"],"score":0.6}]}\n```'));
    assert.deepEqual(await selectStoriesWithGemini(candidates, selectOptions()), [{ ids: ["a3"], score: 0.6 }]);
  });

  test("lève une erreur si la réponse reste inexploitable après la nouvelle tentative", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => selection([{ ids: ["zz"], score: 0.5 }]));
    await assert.rejects(() => selectStoriesWithGemini(candidates, selectOptions()), /Sélection Gemini invalide/);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  test("relance sans thinkingConfig si le modèle le refuse (400)", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      return body.generationConfig.thinkingConfig ? fakeJsonResponse({ error: { message: "thinkingLevel" } }, 400) : selection([{ ids: ["a1"], score: 0.5 }]);
    });
    assert.deepEqual(await selectStoriesWithGemini(candidates, selectOptions()), [{ ids: ["a1"], score: 0.5 }]);
    assert.equal(fetchMock.mock.callCount(), 2);
  });
});

describe("mode débogage (NEWS_DEBUG)", () => {
  function captureLogs(t: import("node:test").TestContext) {
    const log = t.mock.method(console, "log", () => {});
    return () => log.mock.calls.map((c) => String(c.arguments[0])).join("\n");
  }

  test("n'affiche rien par défaut", async (t) => {
    delete process.env.NEWS_DEBUG;
    const logs = captureLogs(t);
    t.mock.method(globalThis, "fetch", async () => geminiSuccess("Résumé."));
    await summarizeWithGemini("texte", options());
    assert.equal(logs(), "");
  });

  test("avec NEWS_DEBUG=1, affiche le prompt envoyé et la réponse brute, jamais la clé API", async (t) => {
    process.env.NEWS_DEBUG = "1";
    t.after(() => delete process.env.NEWS_DEBUG);
    const logs = captureLogs(t);
    t.mock.method(globalThis, "fetch", async () => geminiSuccess("Résumé secret."));
    await summarizeWithGemini("- article source", options({ apiKey: "CLE-SECRETE" }));

    const output = logs();
    assert.ok(output.includes("PASSE 2 (synthèse) — prompt envoyé"));
    assert.ok(output.includes("- article source"));
    assert.ok(output.includes("PASSE 2 (synthèse) — réponse brute de Gemini"));
    assert.ok(output.includes("Résumé secret."));
    assert.ok(!output.includes("CLE-SECRETE"));
  });
});
