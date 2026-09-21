import type { ReceiptModule } from "./types";
import { configStore } from "../config/store";
import { fetchRssItems } from "../lib/rss";
import { summarizeWithGemini } from "../lib/ai-summarizer";

interface FeedEntry {
  url: string;
  maxArticles: number;
}

interface TopicConfig {
  label: string;
  feeds: FeedEntry[];
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
      help: "Un sujet peut regrouper plusieurs flux RSS (plusieurs sources sur un même thème) pour un résumé unique. Seuls les articles publiés aujourd'hui ou hier sont pris en compte, quel que soit le nombre max d'articles défini par flux.",
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
      .map((t) => ({ label: t.label, feeds: (t.feeds ?? []).filter((f) => f?.url?.trim()) }))
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

/**
 * Nombre d'articles bruts récupérés par flux avant filtrage par date, indépendant du `maxArticles`
 * choisi par l'utilisateur (qui ne plafonne que les articles retenus *après* le filtre J/J-1) — sans
 * coût réseau additionnel, le flux entier est de toute façon déjà téléchargé par `fetchRssItems()`.
 */
const RAW_FETCH_LIMIT = 100;

/**
 * Résume un sujet (un ou plusieurs flux RSS), en réutilisant le cache du jour s'il existe. Chaque
 * flux du sujet est interrogé indépendamment : un flux en panne ne prive pas le sujet des articles
 * des autres flux du même sujet (le sujet entier n'échoue que si tous ses flux échouent ou qu'aucun
 * n'a d'article récent).
 */
async function summarizeTopic(topic: TopicConfig, config: NewsConfig, maxChars: number): Promise<TopicResult> {
  const { label, feeds } = topic;
  const cached = configStore.getConfig().state.newsCache?.[label];
  if (cached && isSameLocalDay(new Date(cached.cachedAt), new Date())) {
    return { label, summary: cached.summary };
  }

  const now = new Date();
  const fetchErrors: string[] = [];
  const itemsByFeed = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const rawItems = await fetchRssItems(feed.url, RAW_FETCH_LIMIT);
        return rawItems.filter((item) => isWithinLastTwoLocalDays(item.pubDate, now)).slice(0, Math.max(1, feed.maxArticles || 3));
      } catch (err) {
        fetchErrors.push(err instanceof Error ? err.message : String(err));
        return [];
      }
    }),
  );
  const items = itemsByFeed.flat();

  if (items.length === 0) {
    const error = fetchErrors.length === feeds.length ? fetchErrors[0] : "aucun article récent trouvé (aujourd'hui/hier)";
    return { label, summary: null, error };
  }

  try {
    const sourceText = items.map((item) => `- ${item.title}${item.description ? " : " + item.description : ""}`).join("\n");
    const summary = await summarizeWithGemini(sourceText, {
      apiKey: config.apiKey,
      model: config.model?.trim() || DEFAULT_MODEL,
      maxChars,
      topic: label,
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

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Retient un article s'il a été publié aujourd'hui ou hier (jour calendaire local) ; exclut les dates absentes/invalides plutôt que de les considérer récentes par défaut. */
function isWithinLastTwoLocalDays(pubDate: string | null, now: Date): boolean {
  if (!pubDate) return false;
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return false;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameLocalDay(date, now) || isSameLocalDay(date, yesterday);
}

export default newsModule;
