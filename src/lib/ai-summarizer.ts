export interface SummarizeOptions {
  apiKey: string;
  /**
   * Nom exact du modèle Gemini (ex: "gemini-3.5-flash-lite"), volontairement configurable plutôt
   * que figé en dur : l'offre de modèles Google évolue régulièrement, mieux vaut pouvoir l'ajuster
   * sans redéployer. Voir la liste courante sur https://ai.google.dev/gemini-api/docs/pricing.
   */
  model: string;
  /** Longueur cible en caractères (indicative pour l'IA) ; sert aussi de base au garde-fou de troncature. */
  maxChars: number;
  /**
   * Sujet suivi (le "label" configuré par l'utilisateur, ex: "Tech"), transmis à l'IA pour qu'elle
   * ignore les articles hors-sujet — utile depuis qu'un sujet peut regrouper plusieurs flux RSS dont
   * certains généralistes (voir news.module.ts), qui peuvent remonter des articles non pertinents.
   */
  topic: string;
}

/**
 * Résume un texte en français via l'API Gemini (Google AI Studio — offre gratuite sans carte
 * bancaire au moment de l'écriture, mais à vérifier : https://ai.google.dev/gemini-api/docs/pricing).
 */
export async function summarizeWithGemini(text: string, options: SummarizeOptions): Promise<string> {
  const prompt =
    `Tu es un rédacteur d'agence de presse chargé de synthétiser des flux d'actualités.` +
    `Voici plusieurs articles issus de flux suivis pour le sujet "${options.topic}", pouvant être rédigés en anglais ou en français :\n\n` +
    `Directives strictes :\n` +
    `- Ignore complètement les articles qui n'ont pas de rapport avec le sujet "${options.topic}" (certains flux sont généralistes et peuvent remonter du hors-sujet) ; base la synthèse uniquement sur les articles pertinents.\n` +
    `- Filtre et sélectionne en priorité les sujets majeurs et d'intérêt général (ex. rupture technologique, annonce majeure, annonces de produits phares, rachats stratégiques).\n` +
    `- Rédige une synthèse factuelle, fluide et neutre en français sous la forme d'un unique court paragraphe.\n` +
    `- Longueur cible : entre ${Math.round(options.maxChars * 0.7)} et ${options.maxChars} caractères maximum (environ ${Math.round(options.maxChars / 6)} mots).\n` +
    `- Zéro mise en forme : aucun titre, aucune puce, aucun formatage Markdown (pas de gras, pas d'italique).\n` +
    `- Sortie directe : commence immédiatement par le texte du résumé, sans formule d'introduction (ex: interdiction d'écrire "Voici le résumé", "En résumé"), sans guillemets autour du texte et sans conclusion.\n\n` +
    `Articles :\n${text}`;

  // Tolère un nom de modèle copié tel quel depuis l'API (`GET /v1beta/models`), qui préfixe
  // chaque nom par "models/" (ex: "models/gemini-2.5-flash-lite") — sans ça, le "/" encodé en
  // "%2F" casse le chemin de l'URL et l'API répond 404 (modèle introuvable) sans autre explication.
  const modelId = options.model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`Gemini a répondu ${res.status}`);
  const json: any = await res.json();
  const summary = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof summary !== "string" || !summary.trim()) throw new Error("Réponse Gemini invalide");

  return truncate(summary.trim(), options.maxChars);
}

/** Garde-fou si l'IA ignore la consigne de longueur : mieux vaut tronquer que gâcher du papier. */
function truncate(text: string, maxChars: number): string {
  const hardLimit = Math.round(maxChars * 1.5);
  return text.length > hardLimit ? `${text.slice(0, hardLimit - 1)}…` : text;
}
