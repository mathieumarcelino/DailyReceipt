import type { ReceiptModule } from "./types";
import { configStore } from "../config/store";
import { fetchRssItems, type RssItem } from "../lib/rss";
import { selectStoriesWithGemini, summarizeWithGemini } from "../lib/ai-summarizer";

interface FeedEntry {
  url: string;
}

interface TopicConfig {
  label: string;
  feeds: FeedEntry[];
  /** Prompt propre au sujet ; vide/absent = prompt par défaut de ai-summarizer.ts. */
  prompt?: string;
  /** Nombre d'histoires retenues pour la synthèse finale (défaut 8). */
  storiesCount?: number;
  /** Fenêtre de recherche en heures, jusqu'à MAX_HOURS_BACK (vide = 24 h). */
  hoursBack?: number;
}

interface NewsConfig {
  topics: TopicConfig[];
  /** Taille cible du résumé, en nombre de lignes du ticket (indicatif, voir ai-summarizer.ts). */
  summaryTargetLines: number;
  apiKey: string;
  model: string;
}

interface TopicResult {
  label: string;
  summary: string | null;
  error?: string;
}

interface NewsData {
  topics: TopicResult[];
}

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

const newsModule: ReceiptModule<NewsConfig, NewsData> = {
  id: "news",
  name: "Actualités",
  description: "Résumé par IA des principaux articles de vos flux RSS suivis",
  dataSource: "flux RSS + generativelanguage.googleapis.com (Gemini)",
  configSchema: [
    {
      key: "topics",
      label: "Sujets suivis",
      type: "news-topics",
      help: "Un sujet regroupe plusieurs flux RSS (plusieurs sources sur un même thème) pour un résumé unique. Tous les articles de la période choisie sont triés par l'IA, qui regroupe les doublons entre sources et ne garde que les histoires les plus importantes.",
    },
    {
      key: "summaryTargetLines",
      label: "Taille cible du résumé (lignes sur le ticket)",
      type: "number",
      min: 5,
      max: 60,
      help: "Indicatif : l'IA vise cette longueur, un dépassement important est tronqué automatiquement.",
    },
    {
      key: "apiKey",
      label: "Clé API Gemini",
      type: "password",
      help: "Créée gratuitement sur Google AI Studio (aistudio.google.com), sans carte bancaire au moment de l'écriture.",
    },
    {
      key: "model",
      label: "Modèle Gemini",
      type: "text",
      placeholder: DEFAULT_MODEL,
      help: "Nom exact du modèle à utiliser, avec ou sans le préfixe \"models/\" (voir la liste réellement disponible pour ta clé via GET https://generativelanguage.googleapis.com/v1beta/models?key=TA_CLE).",
    },
    {
      key: "clearCache",
      label: "Cache des résumés",
      type: "action",
      buttonLabel: "Vider le cache (forcer un nouveau résumé)",
      endpoint: "/api/news/clear-cache",
      help: "Les résumés sont conservés jusqu'au lendemain pour économiser les appels à l'IA ; utile pour tester une modification immédiatement.",
    },
  ],
  defaultConfig: { topics: [], summaryTargetLines: 20, apiKey: "", model: DEFAULT_MODEL },

  async fetchData(config) {
    const topics = (config.topics ?? [])
      .filter((t) => t?.label?.trim())
      .map((t) => ({ ...t, feeds: (t.feeds ?? []).filter((f) => f?.url?.trim()) }))
      .filter((t) => t.feeds.length > 0);

    if (topics.length === 0) {
      throw new Error("Configurez au moins un sujet avec un flux RSS.");
    }
    if (!config.apiKey?.trim()) {
      throw new Error("Renseignez une clé API Gemini.");
    }

    // Vise une longueur de résumé cohérente avec la largeur d'impression réellement configurée.
    const { columns } = configStore.getConfig().printer;
    const maxChars = columns * Math.max(1, config.summaryTargetLines || 20);

    const results = await Promise.all(topics.map((topic) => summarizeTopic(topic, config, maxChars)));
    return { topics: results };
  },

  renderReceipt(data, ctx) {
    if (data.topics.length === 0) return;

    ctx.text("ACTUALITÉS", { bold: true, underline: true });

    data.topics.forEach((topic, index) => {
      ctx.text(topic.label.toUpperCase(), { bold: true });
      ctx.text(topic.summary ?? `Indisponible (${topic.error ?? "erreur inconnue"})`);
      if (index < data.topics.length - 1) ctx.spacer(1);
    });
  },
};

const DEFAULT_STORIES_COUNT = 8;
const MAX_STORIES_COUNT = 20;
const DEFAULT_HOURS_BACK = 24;
/** Plafond de la fenêtre de recherche : une période trop longue ferait exploser la taille des prompts. */
const MAX_HOURS_BACK = 72;
/** Plafond de titres envoyés à la passe 1 (les plus récents sont conservés). */
const MAX_CANDIDATES = 200;
/** Articles bruts lus par flux avant filtrage par date (le flux entier est de toute façon déjà téléchargé). */
const RAW_FETCH_LIMIT = 300;
/** Versions d'une même histoire transmises à la passe 2 (une par source, les plus riches d'abord). */
const MAX_VERSIONS_PER_STORY = 4;
/** Les versions secondaires sont raccourcies : la meilleure version suffit pour le détail, les autres complètent. */
const SECONDARY_DESCRIPTION_CHARS = 600;

interface Article extends RssItem {
  id: string;
}

interface Story {
  articles: Article[];
  /** Note d'impact (passe 1) ; absente en cas de repli. */
  score?: number;
}

/**
 * Résume un sujet en deux passes, en réutilisant le cache du jour s'il existe :
 * 1. tous les articles de la période sont réduits à id + source + titre, et l'IA regroupe les doublons,
 *    note l'impact et retient les `storiesCount` meilleures histoires (repli déterministe si elle échoue) ;
 * 2. les articles complets de ces histoires (toutes les versions, dans la limite de
 *    MAX_VERSIONS_PER_STORY) sont envoyés pour la synthèse finale, dans l'ordre des scores.
 * Chaque flux est interrogé indépendamment : un flux en panne ne prive pas le sujet des autres.
 */
async function summarizeTopic(topic: TopicConfig, config: NewsConfig, maxChars: number): Promise<TopicResult> {
  const { label, feeds } = topic;
  const cached = configStore.getConfig().state.newsCache?.[label];
  if (cached && isSameLocalDay(new Date(cached.cachedAt), new Date())) {
    return { label, summary: cached.summary };
  }

  const hoursBack = resolveInt(topic.hoursBack, DEFAULT_HOURS_BACK, 1, MAX_HOURS_BACK);
  const count = resolveInt(topic.storiesCount, DEFAULT_STORIES_COUNT, 1, MAX_STORIES_COUNT);
  const cutoff = Date.now() - hoursBack * 3_600_000;
  const model = config.model?.trim() || DEFAULT_MODEL;

  const fetchErrors: string[] = [];
  const itemsByFeed = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const rawItems = await fetchRssItems(feed.url, RAW_FETCH_LIMIT);
        return rawItems.filter((item) => isPublishedSince(item.pubDate, cutoff));
      } catch (err) {
        fetchErrors.push(err instanceof Error ? err.message : String(err));
        return [];
      }
    }),
  );
  const articles = collectCandidates(itemsByFeed.flat());

  if (articles.length === 0) {
    const error = fetchErrors.length === feeds.length ? fetchErrors[0] : `aucun article trouvé sur les dernières ${hoursBack} h`;
    return { label, summary: null, error };
  }

  let stories: Story[];
  if (articles.length <= count) {
    stories = articles.map((article) => ({ articles: [article] }));
  } else {
    try {
      const selected = await selectStoriesWithGemini(
        articles.map(({ id, source, title }) => ({ id, source, title })),
        { apiKey: config.apiKey, model, topic: label, count },
      );
      const byId = new Map(articles.map((article) => [article.id, article]));
      stories = selected.map((story) => ({ score: story.score, articles: story.ids.map((id) => byId.get(id)!) }));
    } catch (err) {
      console.warn(`[news] Sélection IA impossible pour "${label}" (${err instanceof Error ? err.message : err}) : repli sur les articles les plus récents.`);
      stories = pickFallbackStories(articles, count);
    }
  }

  try {
    const summary = await summarizeWithGemini(formatStories(stories), {
      apiKey: config.apiKey,
      model,
      maxChars,
      topic: label,
      customPrompt: topic.prompt,
      storiesCount: stories.length,
    });

    await configStore.updateConfig((draft) => {
      draft.state.newsCache = { ...(draft.state.newsCache ?? {}), [label]: { summary, cachedAt: new Date().toISOString() } };
    });

    return { label, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { label, summary: null, error: message };
  }
}

/** Entier borné ; une valeur vide, nulle ou invalide donne la valeur par défaut. */
function resolveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Déduplique les titres identiques (reprises d'un même flux ou flux qui se recoupent), garde les plus
 * récents dans la limite de MAX_CANDIDATES et attribue des identifiants courts (a1, a2...) — générés
 * ici plutôt que par l'IA, pour pouvoir valider strictement sa réponse.
 */
function collectCandidates(items: RssItem[]): Article[] {
  const seen = new Set<string>();
  return items
    .map((item) => ({ item, time: new Date(item.pubDate ?? "").getTime() }))
    .sort((a, b) => b.time - a.time)
    .filter(({ item }) => {
      const key = item.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES)
    .map(({ item }, index) => ({ ...item, id: `a${index + 1}` }));
}

/** Repli sans IA : les articles les plus récents, en alternant les sources pour ne pas laisser un flux bavard tout occuper. */
function pickFallbackStories(articles: Article[], count: number): Story[] {
  const bySource = new Map<string, Article[]>();
  for (const article of articles) bySource.set(article.source, [...(bySource.get(article.source) ?? []), article]);

  const queues = [...bySource.values()];
  const picked: Article[] = [];
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && picked.length < count) picked.push(next);
    }
  }
  return picked.map((article) => ({ articles: [article] }));
}

/** Une seule version par source (la plus riche), les meilleures d'abord, dans la limite de MAX_VERSIONS_PER_STORY. */
function pickVersions(articles: Article[]): Article[] {
  const richestBySource = new Map<string, Article>();
  for (const article of articles) {
    const current = richestBySource.get(article.source);
    if (!current || article.description.length > current.description.length) richestBySource.set(article.source, article);
  }
  return [...richestBySource.values()].sort((a, b) => b.description.length - a.description.length).slice(0, MAX_VERSIONS_PER_STORY);
}

/** Bloc envoyé en passe 2 : une section par histoire, dans l'ordre des scores, avec toutes ses versions. */
function formatStories(stories: Story[]): string {
  return stories
    .map((story, index) => {
      const header = `Histoire ${index + 1}${story.score !== undefined ? ` (score d'importance ${story.score.toFixed(2)})` : ""} :`;
      const lines = pickVersions(story.articles).map((article, versionIndex) => {
        const description = versionIndex === 0 ? article.description : article.description.slice(0, SECONDARY_DESCRIPTION_CHARS);
        return `- [${article.source}] ${article.title}${description ? " : " + description : ""}`;
      });
      return [header, ...lines].join("\n");
    })
    .join("\n\n");
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Retient un article publié à partir de `cutoff` ; exclut les dates absentes/invalides plutôt que de les considérer récentes par défaut. */
function isPublishedSince(pubDate: string | null, cutoff: number): boolean {
  if (!pubDate) return false;
  const time = new Date(pubDate).getTime();
  return !Number.isNaN(time) && time >= cutoff;
}

export default newsModule;
