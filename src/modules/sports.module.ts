import type { ReceiptModule } from "./types";
import { formatFrenchDate, formatFrenchTime } from "../lib/date-fr";

/**
 * Compétitions continentales à vérifier en plus de la ligue domestique d'une équipe
 * de football : l'API ESPN scope ses endpoints par compétition (l'historique d'une
 * équipe en Ligue des Champions n'apparaît pas dans son calendrier de Ligue 1, même
 * si le même identifiant d'équipe fonctionne partout). Sans ça, un match européen
 * de la veille serait invisible.
 */
const SOCCER_CONTINENTAL_SLUGS = ["uefa.champions", "uefa.europa", "uefa.europa.conf"];

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
  homeScore: number | null;
  awayScore: number | null;
  goals: SportsGoal[];
  cards: SportsCard[];
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
  description: "Suivi de plusieurs équipes via l'API publique ESPN : match du jour, résultat de la veille.",
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

        if (match.goals.length > 0 || match.cards.length > 0) {
          ctx.text("Faits de jeu :", { underline: true });
          for (const event of buildMatchEvents(match.goals, match.cards)) {
            ctx.text(event.text, { bold: event.isFollowedTeam });
          }
        }
      } else {
        ctx.text(competitionSuffix);
        ctx.text(`${match.homeTeam} - ${match.awayTeam}`);
        ctx.text(`${formatFrenchDate(kickoff)} à ${formatFrenchTime(kickoff)}`);
      }

      if (index < withContent.length - 1) ctx.spacer(1);
    });
    ctx.separator();
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
  const pastEvents = schedules.flat();
  const nextCandidates = teamInfos.map((info) => info?.team?.nextEvent?.[0]).filter(Boolean);

  const yesterdayMatch = pastEvents.find((e) => e.competitions?.[0]?.status?.type?.completed && isSameLocalDay(new Date(e.date), yesterday));
  const todayMatch = nextCandidates.find((e) => isSameLocalDay(new Date(e.date), now));

  let picked = todayMatch ?? yesterdayMatch ?? null;
  let kind: SportsMatch["kind"] = todayMatch ? "today" : "yesterday";

  if (!picked && showNextIfNone) {
    const upcoming = [...nextCandidates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    picked = upcoming[0] ?? null;
    kind = "next";
  }

  if (!picked) return { team, match: null };

  const comp = picked.competitions?.[0];
  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");

  let goals: SportsGoal[] = [];
  let cards: SportsCard[] = [];
  if (kind === "yesterday" && picked.id) {
    const events = await fetchKeyEvents(picked.sport, picked.leagueSlug, picked.id);
    ({ goals, cards } = extractFromKeyEvents(events, team.teamId));
  }

  const seasonTypeName: string | null = picked.seasonType?.name ?? null;
  // "2026-27 Ligue 1" ne fait que répéter la saison : seule une vraie étiquette de phase
  // (ex: "League Phase", "Quarterfinals") apporte une info utile.
  const stage = seasonTypeName && !/^\d{4}/.test(seasonTypeName) ? seasonTypeName : null;

  // Ex: "2026-27 UEFA Champions League" -> "UEFA Champions League" (l'année n'apporte rien ici).
  // Certains sports (NBA) n'ont qu'une année sans nom de ligue ("2026-27") : dans ce cas on
  // retombe sur le nom de ligue résolu à la recherche plutôt que d'afficher une chaîne vide.
  const strippedLeague = (picked.season?.displayName ?? "").replace(/^\d{4}-\d{2}\s*/, "").trim();
  const league = strippedLeague || team.league;

  const match: SportsMatch = {
    kind,
    utcDate: picked.date,
    league,
    stage,
    homeTeam: home?.team?.displayName ?? "Domicile",
    awayTeam: away?.team?.displayName ?? "Extérieur",
    venue: typeof comp?.venue?.fullName === "string" && comp.venue.fullName.trim() ? comp.venue.fullName.trim() : null,
    homeScore: parseScore(home?.score),
    awayScore: parseScore(away?.score),
    goals,
    cards,
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

async function fetchKeyEvents(sport: string, leagueSlug: string, eventId: string): Promise<any[]> {
  const json = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/summary?event=${eventId}`);
  return Array.isArray(json?.keyEvents) ? json.keyEvents : [];
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

    if (type.includes("goal")) {
      goals.push({ minute, scorer: player, isFollowedTeam });
    } else if (type.includes("card")) {
      cards.push({ minute, player, type: type.includes("red") ? "red" : "yellow", isFollowedTeam });
    }
  }

  return { goals, cards };
}

interface MatchEventLine {
  minuteSortKey: number;
  text: string;
  isFollowedTeam: boolean;
}

/** Fusionne buts et cartons en une seule liste triée par minute (ordre chronologique des faits de jeu). */
function buildMatchEvents(goals: SportsGoal[], cards: SportsCard[]): MatchEventLine[] {
  const events: MatchEventLine[] = [
    ...goals.map((g) => ({
      minuteSortKey: parseMinuteSortKey(g.minute),
      text: `${g.minute ? `${g.minute} ` : ""}${g.scorer}`,
      isFollowedTeam: g.isFollowedTeam,
    })),
    ...cards.map((c) => ({
      minuteSortKey: parseMinuteSortKey(c.minute),
      text: `[${c.type === "red" ? "R" : "J"}] ${c.minute ? `${c.minute} ` : ""}${c.player}`,
      isFollowedTeam: c.isFollowedTeam,
    })),
  ];

  return events.sort((a, b) => a.minuteSortKey - b.minuteSortKey);
}

/** Convertit une minute ESPN ("90'+3'") en clé triable (90'+3' -> 9003, 90' -> 9000, 51' -> 5100). */
function parseMinuteSortKey(minute: string | null): number {
  if (!minute) return Number.MAX_SAFE_INTEGER;
  const [base, extra] = minute.replace(/'/g, "").split("+").map(Number);
  return (Number.isFinite(base) ? base : 0) * 100 + (Number.isFinite(extra) ? extra : 0);
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
