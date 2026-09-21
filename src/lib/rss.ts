import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Récupère et normalise les N articles les plus récents d'un flux, RSS 2.0 (`rss.channel.item`)
 * ou Atom (`feed.entry`) — les deux formats coexistent largement dans la nature. On suppose que le
 * flux est déjà trié du plus récent au plus ancien (quasi toujours le cas) plutôt que de re-trier
 * sur `pubDate`, dont le format varie et n'est pas garanti présent.
 */
export async function fetchRssItems(feedUrl: string, maxItems: number): Promise<RssItem[]> {
  const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Le flux RSS a répondu ${res.status}`);

  const xml = await res.text();
  const json = parser.parse(xml);

  return extractRawItems(json)
    .slice(0, maxItems)
    .map(normalizeItem)
    .filter((item) => item.title || item.description);
}

function extractRawItems(json: any): any[] {
  const rssItems = json?.rss?.channel?.item;
  if (rssItems) return Array.isArray(rssItems) ? rssItems : [rssItems];

  const atomEntries = json?.feed?.entry;
  if (atomEntries) return Array.isArray(atomEntries) ? atomEntries : [atomEntries];

  return [];
}

const MAX_DESCRIPTION_CHARS = 1500;

/**
 * `content:encoded` (module RSS "content", très répandu sur les flux WordPress) contient souvent le
 * corps complet de l'article directement dans le flux — préféré à `description`/`summary` (un simple
 * extrait) quand il est présent, pour donner à l'IA plus de matière que le seul titre sans pour autant
 * scraper la page liée (voir la limite volontaire "Option A" du module Actualités, docs/modules/news.md).
 */
function normalizeItem(raw: any): RssItem {
  const descriptionSource = raw?.["content:encoded"] ?? raw?.description ?? raw?.summary ?? raw?.content;
  return {
    title: stripHtml(extractText(raw?.title)),
    link: extractLink(raw?.link),
    description: truncate(stripHtml(extractText(descriptionSource)), MAX_DESCRIPTION_CHARS),
    pubDate: extractText(raw?.pubDate ?? raw?.updated ?? raw?.published) || null,
  };
}

/** Garde-fou si `content:encoded` contient un article entier : évite de gonfler inutilement le prompt envoyé à l'IA. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Un champ XML devient soit une chaîne directe, soit un objet `{ "#text": "...", "@_attr": ... }`
 * dès que l'élément porte au moins un attribut (fast-xml-parser) — les deux formes sont courantes
 * selon les flux.
 */
function extractText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof (value as any)["#text"] === "string") {
    return (value as any)["#text"].trim();
  }
  return "";
}

/** RSS : `<link>url</link>` (texte). Atom : `<link href="url"/>` (attribut, jamais de texte). */
function extractLink(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const obj = value as any;
    if (typeof obj["#text"] === "string") return obj["#text"].trim();
    if (typeof obj["@_href"] === "string") return obj["@_href"].trim();
  }
  return "";
}

/**
 * Entités nommées les plus fréquentes dans les flux réels (WordPress échappe systématiquement les
 * apostrophes/guillemets typographiques et espaces insécables, tantôt en forme nommée, tantôt en
 * forme numérique — voir `stripHtml()` ci-dessous pour la forme numérique).
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
};

/** Retire les balises HTML et décode les entités (numériques `&#8217;`/`&#x2019;` et nommées), pour un texte propre à envoyer à l'IA. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}
