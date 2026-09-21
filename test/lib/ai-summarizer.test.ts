import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarizeWithGemini, type SummarizeOptions } from "../../src/lib/ai-summarizer";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function geminiSuccess(text: string) {
  return fakeJsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function options(overrides: Partial<SummarizeOptions> = {}): SummarizeOptions {
  return { apiKey: "key", model: "m", maxChars: 100, topic: "Tech", ...overrides };
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

  test("mentionne le sujet dans le prompt et demande d'ignorer le hors-sujet", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => geminiSuccess("ok"));
    await summarizeWithGemini("texte", options({ topic: "Paris Saint Germain" }));

    const [, init] = fetchMock.mock.calls[0].arguments;
    const prompt = JSON.parse((init as RequestInit).body as string).contents[0].parts[0].text;
    const occurrences = prompt.split("Paris Saint Germain").length - 1;
    assert.ok(occurrences >= 2); // cité dans le contexte ET dans la consigne de filtrage hors-sujet
    assert.ok(/ignore/i.test(prompt));
  });

  test("tronque avec une ellipse si la réponse dépasse largement la longueur cible", async (t) => {
    const longText = "a".repeat(1000);
    t.mock.method(globalThis, "fetch", async () => geminiSuccess(longText));
    const summary = await summarizeWithGemini("texte", options());

    assert.equal(summary.length, 150);
    assert.ok(summary.endsWith("…"));
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 429));
    await assert.rejects(() => summarizeWithGemini("texte", options()), /Gemini a répondu 429/);
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
