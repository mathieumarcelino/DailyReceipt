import type { ReceiptContext, ReceiptModule } from "./types";
import { formatFrenchDate, formatFrenchTime } from "../lib/date-fr";

/**
 * Compétitions continentales à vérifier en plus de la ligue domestique d'une équipe
 * de football : l'API ESPN scope ses endpoints par compétition (l'historique d'une
 * équipe en Ligue des Champions n'apparaît pas dans son calendrier de Ligue 1, même
 * si le même identifiant d'équipe fonctionne partout). Sans ça, un match européen
 * de la veille serait invisible.
 */
const SOCCER_CONTINENTAL_SLUGS = ["uefa.champions", "uefa.europa", "uefa.europa.conf"];

/** Sports où un tableau de scores par période (façon feuille de match) est plus parlant qu'une liste de faits de jeu. */
const PERIOD_TABLE_SPORTS = new Set(["football", "basketball", "baseball"]);

export interface TeamCandidate {
  query: string;
  teamId: string;
  name: string;
  sport: string;
  leagueSlug: string;
  league: string;
  badge: string | null;
}

interface SportsConfig {
  teams: { team: TeamCandidate | null }[];
  showNextMatchIfNoGame: boolean;
}

interface SportsGoal {
  minute: string | null;
  scorer: string;
  isFollowedTeam: boolean;
  /** Type d'action (ex: "TRY", "CONVERSION") pour les sports sans notion unique de "but" (rugby...). */
  label?: string;
}

interface SportsCard {
  minute: string | null;
  player: string;
  type: "yellow" | "red";
  isFollowedTeam: boolean;
}

interface SportsMatch {
  kind: "today" | "yesterday" | "next";
  utcDate: string;
  league: string;
  /** Phase distincte de la saison (ex: "League Phase", "Quarterfinals"), seulement si informative. */
  stage: string | null;
  homeTeam: string;
  awayTeam: string;
  venue: string | null;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number | null;
  awayScore: number | null;
  homeIsFollowed: boolean;
  awayIsFollowed: boolean;
  goals: SportsGoal[];
  cards: SportsCard[];
  /** Scores par période (foot américain, basket, baseball...), remplace l'affichage des faits de jeu quand présent. */
  periodScores: PeriodScores | null;
}

interface PeriodScores {
  home: string[];
  away: string[];
  /** Colonnes de résumé après les périodes : "T" (total) pour foot US/basket, "R"/"H"/"E" pour le baseball. */
  columns: { label: string; home: string; away: string }[];
}

interface TeamResult {
  team: TeamCandidate;
  match: SportsMatch | null;
}

interface SportsData {
  results: TeamResult[];
}

const sportsModule: ReceiptModule<SportsConfig, SportsData> = {
  id: "sports",
  name: "Sports",
  description: "Suivi de vos équipes, match du jour et résultat de la veille",
  dataSource: "espn.com",
  configSchema: [
    {
      key: "teams",
      label: "Équipes suivies",
      type: "array",
      itemLabel: "Équipe",
      itemSchema: [{ key: "team", label: "Équipe", type: "team-search" }],
      help: "Tous sports confondus : football, basket, etc.",
    },
    {
      key: "showNextMatchIfNoGame",
      label: "Afficher le prochain match si aucun match hier/aujourd'hui",
      type: "boolean",
    },
  ],
  defaultConfig: { teams: [], showNextMatchIfNoGame: true },

  async fetchData(config) {
    const teams = (config.teams ?? []).map((t) => t.team).filter((t): t is TeamCandidate => Boolean(t?.teamId));
    if (teams.length === 0) {
      throw new Error("Configurez au moins une équipe à suivre.");
    }

    const results = await Promise.all(teams.map((team) => fetchTeamMatch(team, config.showNextMatchIfNoGame)));
    return { results };
  },

  renderReceipt(data, ctx) {
    const withContent = data.results.filter((r) => r.match);
    // Rien à afficher pour aucune équipe : le module reste muet plutôt que d'imprimer une section vide.
    if (withContent.length === 0) return;

    ctx.text("SPORTS", { bold: true, underline: true });

    withContent.forEach(({ team, match }, index) => {
      if (!match) return; // toujours vrai ici (withContent est déjà filtré), garde nécessaire pour TS

      const kindLabel = match.kind === "yesterday" ? "RÉSULTAT" : match.kind === "today" ? "AUJOURD'HUI" : "À VENIR";
      ctx.text(`${team.name.toUpperCase()} - ${kindLabel}`, { bold: true });

      const kickoff = new Date(match.utcDate);
      const competitionSuffix = match.stage ? `${match.league} - ${match.stage}` : match.league;

      if (match.kind === "today") {
        ctx.text(competitionSuffix);
        ctx.text(`${match.homeTeam} - ${match.awayTeam}`);
        ctx.text(`Aujourd'hui à ${formatFrenchTime(kickoff)}`);
      } else if (match.kind === "yesterday") {
        ctx.text(competitionSuffix);
        const score = match.homeScore != null && match.awayScore != null ? `${match.homeScore} - ${match.awayScore}` : "score indisponible";
        ctx.text(`${match.homeTeam} ${score} ${match.awayTeam}`);
        ctx.text(`Hier à ${formatFrenchTime(kickoff)}`);

        if (match.periodScores) {
          ctx.spacer(1);
          renderPeriodTable(ctx, match);
        } else if (match.goals.length > 0 || match.cards.length > 0) {
          ctx.spacer(1);
          for (const event of buildMatchEvents(match.goals, match.cards)) {
            ctx.rawLine(formatEventRow(event.minute, event.label, event.who), { bold: event.isFollowedTeam });
          }
        }
      } else {
        ctx.text(competitionSuffix);
        ctx.text(`${match.homeTeam} - ${match.awayTeam}`);
        ctx.text(`${formatFrenchDate(kickoff)} à ${formatFrenchTime(kickoff)}`);
      }

      if (index < withContent.length - 1) ctx.spacer(1);
    });
  },
};

/** Recherche d'équipes par nom (utilisé par fetchData ET par la route de recherche du Constructeur). */
export async function searchTeams(query: string): Promise<TeamCandidate[]> {
  const url = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(query)}&limit=8&type=team`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ESPN a répondu ${res.status}`);

  const json: any = await res.json();
  const group = (json?.results ?? []).find((g: any) => g?.type === "team");
  const contents: any[] = Array.isArray(group?.contents) ? group.contents : [];

  return contents
    .map((c) => {
      const teamId = /t:(\d+)/.exec(c?.uid ?? "")?.[1];
      if (!teamId || !c?.sport || !c?.defaultLeagueSlug) return null;
      const candidate: TeamCandidate = {
        query,
        teamId,
        name: c.displayName ?? query,
        sport: c.sport,
        leagueSlug: c.defaultLeagueSlug,
        league: c.subtitle ?? "Compétition inconnue",
        badge: typeof c?.image?.default === "string" ? c.image.default : null,
      };
      return candidate;
    })
    .filter((c): c is TeamCandidate => c !== null);
}

async function fetchTeamMatch(team: TeamCandidate, showNextIfNone: boolean): Promise<TeamResult> {
  const now = new Date();
  const yesterday = addDays(now, -1);

  const slugsToCheck = Array.from(new Set([team.leagueSlug, ...(team.sport === "soccer" ? SOCCER_CONTINENTAL_SLUGS : [])]));

  // L'endpoint /schedule d'ESPN ne renvoie que les matchs passés récents (jamais les matchs
  // à venir) : il faut le endpoint "infos équipe" (champ nextEvent) pour les prochains matchs.
  // Les deux sont scopés par compétition, d'où la boucle sur chaque compétition suivie.
  const [schedules, teamInfos] = await Promise.all([
    Promise.all(slugsToCheck.map((slug) => fetchSchedule(team.sport, slug, team.teamId))),
    Promise.all(slugsToCheck.map((slug) => fetchTeamInfo(team.sport, slug, team.teamId))),
  ]);
  const scheduleEvents = schedules.flat();
  const nextEventEntries = teamInfos
    .map((info, i) => {
      const e = info?.team?.nextEvent?.[0];
      // Tagué avec sport/leagueSlug comme fetchSchedule(), nécessaire pour l'appel summary() plus bas.
      return e ? { ...e, sport: team.sport, leagueSlug: slugsToCheck[i] } : null;
    })
    .filter(Boolean);

  // "nextEvent" n'est pas toujours fiable : pour certaines compétitions dont l'endpoint /schedule
  // répond en erreur côté ESPN (ex: rugby Top 14), il renvoie le dernier match déjà terminé plutôt
  // qu'un match à venir. On fusionne donc les deux sources et on classe chaque événement d'après
  // son propre statut plutôt que de supposer que schedule = passé et nextEvent = à venir.
  const allEvents = [...scheduleEvents, ...nextEventEntries];
  const isCompleted = (e: any) => Boolean(e?.competitions?.[0]?.status?.type?.completed);

  const yesterdayMatch = allEvents.find((e) => isCompleted(e) && isSameLocalDay(new Date(e.date), yesterday));
  const todayMatch = allEvents.find((e) => isSameLocalDay(new Date(e.date), now));

  let picked = todayMatch ?? yesterdayMatch ?? null;
  let kind: SportsMatch["kind"] = todayMatch ? "today" : "yesterday";

  if (!picked && showNextIfNone) {
    const upcoming = allEvents
      .filter((e) => !isCompleted(e) && new Date(e.date).getTime() > now.getTime())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    picked = upcoming[0] ?? null;
    kind = "next";
  }

  if (!picked) return { team, match: null };

  const comp = picked.competitions?.[0];
  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");

  let goals: SportsGoal[] = [];
  let cards: SportsCard[] = [];
  let periodScores: PeriodScores | null = null;
  if (kind === "yesterday" && picked.id) {
    const summary = await fetchMatchSummary(picked.sport, picked.leagueSlug, picked.id);
    if (PERIOD_TABLE_SPORTS.has(team.sport)) {
      // Foot US / basket / baseball : un tableau de scores par période est plus parlant qu'une
      // liste de faits de jeu (pas de notion de "but" unique dans ces sports).
      periodScores = extractPeriodScores(
        summary,
        team.sport,
        { id: String(home?.team?.id ?? ""), score: parseScore(home?.score) },
        { id: String(away?.team?.id ?? ""), score: parseScore(away?.score) },
      );
    } else {
      const keyEvents = Array.isArray(summary?.keyEvents) ? summary.keyEvents : [];
      const details = Array.isArray(summary?.header?.competitions?.[0]?.details) ? summary.header.competitions[0].details : [];
      if (keyEvents.length > 0) {
        // Format "keyEvents" (football) : type.type explicite ("goal", "card"...).
        ({ goals, cards } = extractFromKeyEvents(keyEvents, team.teamId));
      } else if (details.length > 0) {
        // Certains sports (rugby...) n'exposent pas "keyEvents" : repli sur le résumé de la fiche
        // match, au format différent (type.text: "try", "conversion", "yellow card"...).
        ({ goals, cards } = extractFromDetails(details, team.teamId));
      }
    }
  }

  const seasonTypeName: string | null = picked.seasonType?.name ?? null;
  // "2026-27 Ligue 1" ne fait que répéter la saison : seule une vraie étiquette de phase
  // (ex: "League Phase", "Quarterfinals") apporte une info utile.
  const stage = seasonTypeName && !/^\d{4}/.test(seasonTypeName) ? seasonTypeName : null;

  // Ex: "2026-27 UEFA Champions League" -> "UEFA Champions League" (l'année n'apporte rien ici).
  // Certains sports n'ont qu'une année sans nom de ligue (NBA: "2026-27", rugby: "2027") : dans ce
  // cas on retombe sur le nom de ligue résolu à la recherche plutôt que d'afficher une année seule.
  const strippedLeague = (picked.season?.displayName ?? "").replace(/^\d{4}-\d{2}\s*/, "").trim();
  // Pour la ligue principale de l'équipe, le nom résolu à la recherche est le libellé "officiel"
  // d'ESPN (ex: "Ligue 1"), plus propre que celui dérivé de la saison qui ajoute parfois le pays
  // (ex: "French Ligue 1"). Ce dernier reste utile pour les autres compétitions suivies (Ligue des
  // Champions...) où le nom de ligue de l'équipe ne conviendrait pas. Pour les sélections
  // nationales, ESPN met un descriptif générique ("Men's soccer team") au lieu du nom de la
  // compétition à cet endroit : dans ce cas on préfère aussi le nom dérivé de la saison.
  const isPrimaryLeague = picked.leagueSlug === team.leagueSlug;
  const hasGenericTeamLabel = /soccer team$/i.test(team.league);
  const league =
    isPrimaryLeague && !hasGenericTeamLabel ? team.league : strippedLeague && !/^\d+$/.test(strippedLeague) ? strippedLeague : team.league;

  const match: SportsMatch = {
    kind,
    utcDate: picked.date,
    league,
    stage,
    homeTeam: home?.team?.displayName ?? "Domicile",
    awayTeam: away?.team?.displayName ?? "Extérieur",
    venue: typeof comp?.venue?.fullName === "string" && comp.venue.fullName.trim() ? comp.venue.fullName.trim() : null,
    homeAbbrev: home?.team?.abbreviation ?? (home?.team?.displayName ?? "DOM").slice(0, 3).toUpperCase(),
    awayAbbrev: away?.team?.abbreviation ?? (away?.team?.displayName ?? "EXT").slice(0, 3).toUpperCase(),
    homeScore: parseScore(home?.score),
    awayScore: parseScore(away?.score),
    homeIsFollowed: String(home?.team?.id ?? "") === team.teamId,
    awayIsFollowed: String(away?.team?.id ?? "") === team.teamId,
    goals,
    cards,
    periodScores,
  };

  return { team, match };
}

function parseScore(score: any): number | null {
  const value = typeof score === "object" ? score?.value : score;
  return typeof value === "number" ? value : null;
}

async function fetchSchedule(sport: string, leagueSlug: string, teamId: string): Promise<any[]> {
  const json = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/teams/${teamId}/schedule`);
  const events: any[] = Array.isArray(json?.events) ? json.events : [];
  // On tague chaque événement avec le sport/la ligue d'où il vient, nécessaire pour l'appel summary().
  return events.map((e) => ({ ...e, sport, leagueSlug }));
}

async function fetchTeamInfo(sport: string, leagueSlug: string, teamId: string): Promise<any | null> {
  return fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/teams/${teamId}`);
}

async function fetchMatchSummary(sport: string, leagueSlug: string, eventId: string): Promise<any | null> {
  return fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/summary?event=${eventId}`);
}

interface TeamScoreRef {
  id: string;
  score: number | null;
}

/**
 * Scores par période : uniquement présents sur la fiche résumé du match (absents du calendrier).
 * Le baseball a des manches en nombre variable (l'équipe à domicile ne rejoue pas la dernière
 * si elle mène déjà) et des colonnes de résumé différentes (R/H/E au lieu d'un simple total).
 */
function extractPeriodScores(summary: any, sport: string, home: TeamScoreRef, away: TeamScoreRef): PeriodScores | null {
  const competitors = summary?.header?.competitions?.[0]?.competitors;
  if (!Array.isArray(competitors)) return null;

  const homeC = competitors.find((c: any) => String(c?.team?.id ?? "") === home.id);
  const awayC = competitors.find((c: any) => String(c?.team?.id ?? "") === away.id);
  const homeLine = homeC?.linescores;
  const awayLine = awayC?.linescores;
  if (!Array.isArray(homeLine) || !Array.isArray(awayLine) || homeLine.length === 0) return null;

  const isBaseball = sport === "baseball";
  const columns = isBaseball
    ? [
        { label: "R", home: String(home.score ?? "-"), away: String(away.score ?? "-") },
        { label: "H", home: String(homeC?.hits ?? "-"), away: String(awayC?.hits ?? "-") },
        { label: "E", home: String(homeC?.errors ?? "-"), away: String(awayC?.errors ?? "-") },
      ]
    : [{ label: "T", home: String(home.score ?? "-"), away: String(away.score ?? "-") }];

  return {
    home: homeLine.map((p: any) => String(p?.displayValue ?? "-")),
    away: awayLine.map((p: any) => String(p?.displayValue ?? "-")),
    columns,
  };
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // Réseau, timeout, compétition indisponible... : on dégrade proprement.
  }
}

function extractFromKeyEvents(events: any[], followedTeamId: string): { goals: SportsGoal[]; cards: SportsCard[] } {
  const goals: SportsGoal[] = [];
  const cards: SportsCard[] = [];

  for (const e of events) {
    const type = String(e?.type?.type ?? "");
    const player = e?.participants?.[0]?.athlete?.displayName;
    if (!player) continue;
    const minute = typeof e?.clock?.displayValue === "string" && e.clock.displayValue ? e.clock.displayValue : null;
    const isFollowedTeam = String(e?.team?.id ?? "") === followedTeamId;

    // scoringPlay est l'indicateur fiable d'ESPN pour "ceci a marqué un but" : le type seul ne
    // suffit pas ("penalty---scored" par exemple ne contient pas "goal" mais est bien un but).
    if (e?.scoringPlay === true || type.includes("goal")) {
      goals.push({ minute, scorer: player, isFollowedTeam, label: type.includes("penalty") ? "Goal (P)" : undefined });
    } else if (type.includes("card")) {
      cards.push({ minute, player, type: type.includes("red") ? "red" : "yellow", isFollowedTeam });
    }
  }

  return { goals, cards };
}

/**
 * Repli pour les sports sans "keyEvents" (ex: rugby) : la fiche match expose ses temps forts
 * sous un format différent (type.text: "try", "conversion", "yellow card"...). On y greffe le
 * libellé de l'action sur les "buts" (essai, transformation, pénalité...) pour ne pas laisser
 * croire que deux joueurs différents ont marqué la même chose sans distinction.
 */
function extractFromDetails(details: any[], followedTeamId: string): { goals: SportsGoal[]; cards: SportsCard[] } {
  const goals: SportsGoal[] = [];
  const cards: SportsCard[] = [];

  for (const d of details) {
    const label = String(d?.type?.text ?? "").toLowerCase();
    if (!label || label.includes("substitut")) continue;
    const player = d?.participants?.[0]?.athlete?.displayName;
    if (!player) continue;
    const minute = typeof d?.clock?.displayValue === "string" && d.clock.displayValue ? d.clock.displayValue : null;
    const isFollowedTeam = String(d?.team?.id ?? "") === followedTeamId;

    if (label.includes("card")) {
      cards.push({ minute, player, type: label.includes("red") ? "red" : "yellow", isFollowedTeam });
    } else {
      goals.push({ minute, scorer: player, isFollowedTeam, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
  }

  return { goals, cards };
}

interface MatchEventLine {
  minuteSortKey: number;
  minute: string | null;
  label: string;
  who: string;
  isFollowedTeam: boolean;
}

/**
 * Fusionne buts et cartons en une seule liste triée par minute (ordre chronologique des faits
 * de jeu), avec un libellé uniforme par événement ("Goal", "Try", "Yellow card"...) pour un
 * rendu en 3 colonnes identique quel que soit le sport.
 */
function buildMatchEvents(goals: SportsGoal[], cards: SportsCard[]): MatchEventLine[] {
  const events: MatchEventLine[] = [
    ...goals.map((g) => ({
      minuteSortKey: parseMinuteSortKey(g.minute),
      minute: g.minute,
      label: g.label ?? "Goal",
      who: g.scorer,
      isFollowedTeam: g.isFollowedTeam,
    })),
    ...cards.map((c) => ({
      minuteSortKey: parseMinuteSortKey(c.minute),
      minute: c.minute,
      label: c.type === "red" ? "Red card" : "Yellow card",
      who: c.player,
      isFollowedTeam: c.isFollowedTeam,
    })),
  ];

  return events.sort((a, b) => a.minuteSortKey - b.minuteSortKey);
}

const EVENT_MINUTE_WIDTH = 7;
const EVENT_LABEL_WIDTH = 14;

/** Ligne à 3 colonnes alignées (minute, type d'action, joueur) — nécessite rawLine() pour préserver le padding. */
function formatEventRow(minute: string | null, label: string, who: string): string {
  const minuteCell = (minute ?? "").padEnd(EVENT_MINUTE_WIDTH);
  const labelCell = truncate(label, EVENT_LABEL_WIDTH - 1).padEnd(EVENT_LABEL_WIDTH);
  return `${minuteCell}${labelCell}${who}`;
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
}

/** Convertit une minute ESPN ("90'+3'") en clé triable (90'+3' -> 9003, 90' -> 9000, 51' -> 5100). */
function parseMinuteSortKey(minute: string | null): number {
  if (!minute) return Number.MAX_SAFE_INTEGER;
  const [base, extra] = minute.replace(/'/g, "").split("+").map(Number);
  return (Number.isFinite(base) ? base : 0) * 100 + (Number.isFinite(extra) ? extra : 0);
}

/** Tableau de scores par période (foot US, basket, baseball...), équipe suivie en gras. */
function renderPeriodTable(ctx: ReceiptContext, match: SportsMatch): void {
  const scores = match.periodScores;
  if (!scores) return;

  const periodCount = Math.max(scores.home.length, scores.away.length);
  const labelWidth = Math.max(match.homeAbbrev.length, match.awayAbbrev.length, 3) + 1;
  const colWidth = 3;

  const periodHeaders = Array.from({ length: periodCount }, (_, i) => String(i + 1).padStart(colWidth)).join("");
  const summaryHeaders = scores.columns.map((c) => c.label.padStart(colWidth)).join("");
  ctx.rawLine(`${" ".repeat(labelWidth)}${periodHeaders}${summaryHeaders}`);

  ctx.rawLine(
    formatPeriodRow(match.homeAbbrev, scores.home, scores.columns.map((c) => c.home), periodCount, labelWidth, colWidth),
    { bold: match.homeIsFollowed },
  );
  ctx.rawLine(
    formatPeriodRow(match.awayAbbrev, scores.away, scores.columns.map((c) => c.away), periodCount, labelWidth, colWidth),
    { bold: match.awayIsFollowed },
  );
}

function formatPeriodRow(label: string, periods: string[], summaryValues: string[], periodCount: number, labelWidth: number, colWidth: number): string {
  const cells = Array.from({ length: periodCount }, (_, i) => (periods[i] ?? "-").padStart(colWidth)).join("");
  const summaryCells = summaryValues.map((v) => v.padStart(colWidth)).join("");
  return `${label.toUpperCase().padEnd(labelWidth)}${cells}${summaryCells}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default sportsModule;
