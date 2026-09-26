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
  /** Prompt propre au sujet (remplace `DEFAULT_PROMPT_TEMPLATE` s'il n'est pas vide) ; voir les variables supportées ci-dessous. */
  customPrompt?: string;
  /** Nombre d'histoires fournies (valeur de la variable `{nombre_sujets}` du prompt). */
  storiesCount?: number;
  /** Délai de base entre deux tentatives (multiplié par le numéro de tentative) ; surchargeable pour les tests. */
  retryDelayMs?: number;
}

/**
 * Prompt par défaut de la passe 2 (consignes uniquement : les histoires sont toujours ajoutées à la
 * suite par `buildPrompt()`). Une ligne courte par histoire, commençant par "-". Variables remplacées
 * à l'envoi : `{sujet}`, `{nombre_sujets}` (nombre d'histoires fournies), `{longueur_par_sujet}` (budget
 * en caractères d'une ligne), `{longueur_max}` (budget total) et `{longueur_cible}` (~60 % du maximum).
 * Un sujet peut définir son propre prompt (`SummarizeOptions.customPrompt`).
 */
export const DEFAULT_PROMPT_TEMPLATE =
  `Tu es un téléscripteur d'actualités brutes pour ticket d'information en continu.\n` +
  `Voici {nombre_sujets} histoires d'actualité sur le sujet "{sujet}", chacune regroupant des articles en anglais ou en français :\n\n` +
  `Directives strictes :\n` +
  `- Écris exactement une ligne par histoire, dans l'ordre fourni (de la plus à la moins importante), sans en omettre ni en ajouter.\n` +
  `- Chaque ligne commence par un tiret "-" suivi d'un espace et tient en une seule phrase courte de {longueur_par_sujet} caractères maximum.\n` +
  `- Va droit au fait : [Acteur] + [fait marquant] + [chiffre ou conséquence concrète]. Pas de phrase d'introduction, pas de transitions.\n` +
  `- Croise les sources d'une même histoire au lieu de les répéter. Traduis en français si la source est en anglais.\n` +
  `- Utilise des chiffres arabes pour toutes les valeurs numériques. Ajoute entre parenthèses la définition courte de tout sigle ou acronyme technique (ex. "l'ICANN (gestionnaire des noms de domaine)").\n` +
  `- Longueur totale : {longueur_max} caractères maximum.\n` +
  `- Aucun titre, aucun Markdown (pas de gras, pas d'italique, pas d'étoiles) : uniquement les lignes commençant par "-".\n` +
  `- Sortie directe : commence par le premier tiret, sans introduction ni conclusion.`;

/** Introduit le bloc d'histoires ajouté par le code, quel que soit le prompt (par défaut ou personnalisé). */
const STORIES_HEADER =
  "Histoires (classées par importance décroissante, dans l'ordre à respecter ; chaque histoire regroupe les articles de plusieurs sources sur un même fait : croise-les au lieu de les répéter) :";

/** Assemble le prompt final : consignes (personnalisées ou par défaut, variables résolues) + histoires. */
export function buildPrompt(
  text: string,
  options: Pick<SummarizeOptions, "topic" | "maxChars" | "customPrompt" | "storiesCount">,
): string {
  const template = options.customPrompt?.trim() || DEFAULT_PROMPT_TEMPLATE;
  const instructions = template
    .replaceAll("{sujet}", options.topic)
    .replaceAll("{longueur_cible}", String(Math.round(options.maxChars * 0.6)))
    .replaceAll("{longueur_max}", String(options.maxChars))
    .replaceAll("{longueur_par_sujet}", String(Math.floor(options.maxChars / Math.max(1, options.storiesCount ?? 1))))
    .replaceAll("{nombre_sujets}", String(options.storiesCount ?? ""));
  return `${instructions}\n\n${STORIES_HEADER}\n${text}`;
}

/**
 * Résume un texte en français via l'API Gemini (Google AI Studio — offre gratuite sans carte
 * bancaire au moment de l'écriture, mais à vérifier : https://ai.google.dev/gemini-api/docs/pricing).
 */
export async function summarizeWithGemini(text: string, options: SummarizeOptions): Promise<string> {
  const summary = await callGemini(buildPrompt(text, options), { ...options, debugLabel: "PASSE 2 (synthèse)" });
  return truncate(summary, options.maxChars);
}

export interface StoryCandidate {
  id: string;
  source: string;
  title: string;
}

/** Une histoire = un ou plusieurs articles (ids) traitant du même fait, avec une note d'impact de 0 à 1. */
export interface SelectedStory {
  ids: string[];
  score: number;
}

export interface SelectOptions {
  apiKey: string;
  model: string;
  topic: string;
  /** Nombre d'histoires à retenir. */
  count: number;
  retryDelayMs?: number;
}

/** Marqueur du bloc de candidats dans le prompt de sélection (aussi utilisé par les tests). */
export const SELECTION_LIST_HEADER = "Articles (id | source | titre) :";

/**
 * Prompt de la passe 1 (tri) : regroupe les doublons, note l'impact et retient les meilleures
 * histoires. Variables : `{sujet}` et `{nombre}`.
 */
export const DEFAULT_SELECTION_PROMPT_TEMPLATE =
  `Tu tries des articles d'actualité sur le sujet "{sujet}" (titres en français ou en anglais).\n` +
  `1. Regroupe les articles qui traitent de la MÊME histoire (même événement, même annonce), même s'ils viennent de sources ou de langues différentes.\n` +
  `2. Écarte les articles sans rapport avec "{sujet}".\n` +
  `3. Note l'impact de chaque histoire de 0 à 1 : 0.85 et plus = crise ou fait majeur, 0.60 à 0.84 = structurant, 0.30 à 0.59 = secondaire.\n` +
  `4. Renvoie les {nombre} histoires les plus importantes, triées par score décroissant, chacune avec la liste de TOUS les ids de ses articles.`;

const SELECTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    stories: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { ids: { type: "ARRAY", items: { type: "STRING" } }, score: { type: "NUMBER" } },
        required: ["ids", "score"],
      },
    },
  },
  required: ["stories"],
};

const MAX_SELECTION_ATTEMPTS = 2;

/**
 * Passe 1 : envoie uniquement id + source + titre de chaque candidat et récupère, en JSON contraint par
 * un schéma, les histoires retenues. La réponse est validée (ids inconnus ou déjà utilisés ignorés,
 * tri par score, coupe à `count`) ; une réponse inexploitable après une nouvelle tentative lève une
 * erreur — l'appelant décide du repli.
 */
export async function selectStoriesWithGemini(candidates: StoryCandidate[], options: SelectOptions): Promise<SelectedStory[]> {
  const list = candidates.map((c) => `${c.id} | ${c.source} | ${c.title}`).join("\n");
  const prompt =
    DEFAULT_SELECTION_PROMPT_TEMPLATE.replaceAll("{sujet}", options.topic).replaceAll("{nombre}", String(options.count)) +
    `\n\n${SELECTION_LIST_HEADER}\n${list}`;
  const knownIds = new Set(candidates.map((c) => c.id));
  const generationConfig = { responseMimeType: "application/json", responseSchema: SELECTION_SCHEMA };

  let lastError: Error = new Error("Sélection Gemini invalide");
  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    let text: string;
    try {
      // Réflexion réduite : ~20 s au lieu de ~35 s pour un résultat équivalent sur cette tâche de tri.
      text = await callGemini(prompt, { ...options, debugLabel: "PASSE 1 (tri)", generationConfig: { ...generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    } catch (err) {
      // `thinkingLevel` n'existe que sur certains modèles : un 400 le concernant ne doit pas bloquer la sélection.
      if (!(err instanceof GeminiHttpError && err.status === 400)) throw err;
      text = await callGemini(prompt, { ...options, debugLabel: "PASSE 1 (tri, sans réflexion réduite)", generationConfig });
    }

    try {
      const stories = parseSelection(text, knownIds, options.count);
      debugLog("PASSE 1 (tri) — histoires retenues après validation", JSON.stringify(stories));
      return stories;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

function parseSelection(text: string, knownIds: Set<string>, count: number): SelectedStory[] {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const block = text.match(/\{[\s\S]*\}/);
    if (!block) throw new Error("Sélection Gemini invalide (JSON illisible)");
    parsed = JSON.parse(block[0]);
  }
  if (!Array.isArray(parsed?.stories)) throw new Error("Sélection Gemini invalide (champ stories absent)");

  const used = new Set<string>();
  const stories: SelectedStory[] = [];
  for (const raw of parsed.stories) {
    const ids = [...new Set<string>(Array.isArray(raw?.ids) ? raw.ids : [])].filter((id) => typeof id === "string" && knownIds.has(id) && !used.has(id));
    if (ids.length === 0) continue;
    ids.forEach((id) => used.add(id));
    const score = Number(raw?.score);
    stories.push({ ids, score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0 });
  }

  if (stories.length === 0) throw new Error("Sélection Gemini invalide (aucune histoire exploitable)");
  return stories.sort((a, b) => b.score - a.score).slice(0, count);
}

class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface GeminiCallOptions {
  apiKey: string;
  model: string;
  retryDelayMs?: number;
  /** Paramètres de génération supplémentaires (sortie JSON contrainte, réflexion...). */
  generationConfig?: Record<string, unknown>;
  /** Nom de l'appel dans les logs de débogage (`NEWS_DEBUG=1`). */
  debugLabel?: string;
}

/** Mode débogage (`NEWS_DEBUG=1`) : affiche dans la console du serveur les prompts envoyés et les réponses de Gemini. */
function debugLog(title: string, content: string): void {
  if (process.env.NEWS_DEBUG !== "1" && process.env.NEWS_DEBUG !== "true") return;
  console.log(`\n[news:debug] ===== ${title} =====\n${content}\n`);
}

/** Appel `generateContent` avec nouvelles tentatives sur les échecs passagers ; renvoie le texte de la réponse. */
async function callGemini(prompt: string, options: GeminiCallOptions): Promise<string> {
  // Tolère un nom de modèle copié tel quel depuis l'API (`GET /v1beta/models`), qui préfixe
  // chaque nom par "models/" (ex: "models/gemini-2.5-flash-lite") — sans ça, le "/" encodé en
  // "%2F" casse le chemin de l'URL et l'API répond 404 (modèle introuvable) sans autre explication.
  const modelId = options.model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
  });

  const label = options.debugLabel ?? "Gemini";
  debugLog(`${label} — prompt envoyé`, prompt);

  const retryDelayMs = options.retryDelayMs ?? 3_000;
  let lastError: Error = new Error("Gemini indisponible");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await readErrorMessage(res);
        lastError = new GeminiHttpError(res.status, `Gemini a répondu ${res.status}${detail ? ` (${detail})` : ""}`);
        if (RETRYABLE_STATUSES.has(res.status)) continue;
        throw lastError;
      }

      const json: any = await res.json();
      const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p?.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("");
      if (!text.trim()) throw new Error("Réponse Gemini invalide");
      debugLog(`${label} — réponse brute de Gemini`, text.trim());
      return text.trim();
    } catch (err) {
      if (err === lastError || !isTransientNetworkError(err)) throw err;
      lastError = new Error(err instanceof Error && err.name === "TimeoutError" ? "Gemini n'a pas répondu à temps" : String(err));
    }
  }
  throw lastError;
}

/** Délai maximal par tentative : un gros prompt sur un modèle "thinking" dépasse facilement 20 s. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Nombre de nouvelles tentatives après un échec passager (503 "surchargé", 429 quota momentané, timeout). */
const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function isTransientNetworkError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError);
}

/** Extrait le message d'erreur renvoyé par l'API Google (`{ error: { message } }`) pour un diagnostic lisible. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const json: any = await res.json();
    const message = json?.error?.message;
    return typeof message === "string" ? message.slice(0, 200) : "";
  } catch {
    return "";
  }
}

/** Garde-fou si l'IA ignore la consigne de longueur : mieux vaut tronquer que gâcher du papier. */
function truncate(text: string, maxChars: number): string {
  const hardLimit = Math.round(maxChars * 1.5);
  return text.length > hardLimit ? `${text.slice(0, hardLimit - 1)}…` : text;
}
