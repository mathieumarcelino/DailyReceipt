import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import sportsModule, { searchTeams, type TeamCandidate } from "../../src/modules/sports.module";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Route un fetch mocké vers la bonne fixture selon l'URL ESPN appelée (schedule, fiche équipe,
 * résumé de match ou recherche) — sportsModule fait plusieurs appels par équipe suivie.
 */
function mockEspn(
  t: { mock: { method: typeof import("node:test").mock.method } },
  fixtures: { schedule?: unknown; teamInfo?: unknown; summary?: unknown; search?: unknown },
) {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/apis/search/")) return fakeJsonResponse(fixtures.search ?? { results: [] });
    if (url.includes("/summary?")) return fakeJsonResponse(fixtures.summary ?? {});
    if (url.includes("/schedule")) return fakeJsonResponse(fixtures.schedule ?? { events: [] });
    return fakeJsonResponse(fixtures.teamInfo ?? { team: {} });
  });
}

function team(overrides: Partial<TeamCandidate> = {}): TeamCandidate {
  return { query: "psg", teamId: "1", name: "Paris Saint-Germain", sport: "soccer", leagueSlug: "fra.1", league: "Ligue 1", badge: null, ...overrides };
}

function competitor(homeAway: "home" | "away", id: string, displayName: string, abbreviation: string, score: number | null = null) {
  return { homeAway, team: { id, displayName, abbreviation }, score };
}

describe("searchTeams", () => {
  test("extrait teamId depuis uid, et le reste des champs depuis la fiche ESPN", async (t) => {
    mockEspn(t as any, {
      search: {
        results: [
          {
            type: "team",
            contents: [
              { uid: "s:600~l:1~t:160", displayName: "Paris Saint-Germain", sport: "soccer", defaultLeagueSlug: "fra.1", subtitle: "Ligue 1", image: { default: "http://x/160.png" } },
            ],
          },
        ],
      },
    });

    const [result] = await searchTeams("psg");
    assert.equal(result.teamId, "160");
    assert.equal(result.name, "Paris Saint-Germain");
    assert.equal(result.leagueSlug, "fra.1");
    assert.equal(result.league, "Ligue 1");
    assert.equal(result.badge, "http://x/160.png");
  });

  test("retombe sur 'Compétition inconnue' si l'API ne fournit pas de sous-titre", async (t) => {
    mockEspn(t as any, {
      search: { results: [{ type: "team", contents: [{ uid: "s:1~t:1", displayName: "X", sport: "soccer", defaultLeagueSlug: "l" }] }] },
    });
    const [result] = await searchTeams("x");
    assert.equal(result.league, "Compétition inconnue");
  });

  test("ignore les entrées sans identifiant, sport ou ligue exploitable", async (t) => {
    mockEspn(t as any, { search: { results: [{ type: "team", contents: [{ displayName: "Sans uid" }] }] } });
    assert.deepEqual(await searchTeams("x"), []);
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));
    await assert.rejects(() => searchTeams("psg"), /ESPN a répondu 500/);
  });
});

describe("sportsModule.fetchData", () => {
  test("lève une erreur explicite si aucune équipe n'est configurée", async () => {
    await assert.rejects(() => sportsModule.fetchData({ teams: [], showNextMatchIfNoGame: true }), /Configurez au moins une équipe à suivre/);
  });
});

describe("sportsModule.renderReceipt — match du jour", () => {
  test("classe un événement à la date du jour comme 'AUJOURD'HUI'", async (t) => {
    mockEspn(t as any, {
      teamInfo: {
        team: {
          nextEvent: [
            {
              id: "10",
              date: new Date().toISOString(),
              competitions: [
                {
                  status: { type: { completed: false } },
                  competitors: [competitor("home", "1", "Paris Saint-Germain", "PSG"), competitor("away", "2", "Marseille", "OM")],
                  venue: { fullName: "Parc des Princes" },
                },
              ],
              season: { displayName: "2026-27 Ligue 1" },
              seasonType: { name: "2026-27" },
            },
          ],
        },
      },
    });

    const data = await sportsModule.fetchData({ teams: [{ team: team() }], showNextMatchIfNoGame: true });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "SPORTS");
    assert.equal(texts[1], "PARIS SAINT-GERMAIN - AUJOURD'HUI");
    assert.equal(texts[2], "Ligue 1"); // ligue principale : nom résolu à la recherche, pas dérivé de la saison
    assert.equal(texts[3], "Paris Saint-Germain - Marseille");
    assert.ok(texts[4].startsWith("Aujourd'hui à "));
  });
});

describe("sportsModule.renderReceipt — résultat de la veille", () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  test("affiche le score et les faits de jeu (but, carton) triés par minute, gras si l'équipe suivie", async (t) => {
    mockEspn(t as any, {
      schedule: {
        events: [
          {
            id: "20",
            date: yesterday,
            competitions: [
              {
                status: { type: { completed: true } },
                competitors: [competitor("home", "1", "Paris Saint-Germain", "PSG", 2), competitor("away", "2", "Marseille", "OM", 1)],
                venue: { fullName: "Parc des Princes" },
              },
            ],
            season: { displayName: "2026-27 Ligue 1" },
            seasonType: { name: "2026-27" },
          },
        ],
      },
      summary: {
        keyEvents: [
          { type: { type: "yellow-card" }, participants: [{ athlete: { displayName: "Marquinhos" } }], clock: { displayValue: "12'" }, team: { id: "1" } },
          { type: { type: "goal" }, scoringPlay: true, participants: [{ athlete: { displayName: "Mbappé" } }], clock: { displayValue: "45'" }, team: { id: "1" } },
        ],
      },
    });

    const data = await sportsModule.fetchData({ teams: [{ team: team() }], showNextMatchIfNoGame: true });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[1], "PARIS SAINT-GERMAIN - RÉSULTAT");
    assert.equal(texts[3], "Paris Saint-Germain 2 - 1 Marseille");
    assert.ok(texts[4].startsWith("Hier à "));

    const lines = ctx.getLines();
    const goalLine = lines.find((l) => l.text.includes("Mbappé"))!;
    const cardLine = lines.find((l) => l.text.includes("Marquinhos"))!;
    // Trié par minute : le carton (12') doit apparaître avant le but (45').
    assert.ok(lines.indexOf(cardLine) < lines.indexOf(goalLine));
    assert.equal(goalLine.bold, true); // équipe suivie
    assert.equal(cardLine.bold, true);
  });

  test("affiche 'score indisponible' si les scores sont absents", async (t) => {
    mockEspn(t as any, {
      schedule: {
        events: [
          {
            id: "21",
            date: yesterday,
            competitions: [{ status: { type: { completed: true } }, competitors: [competitor("home", "1", "PSG", "PSG"), competitor("away", "2", "OM", "OM")] }],
          },
        ],
      },
    });

    const data = await sportsModule.fetchData({ teams: [{ team: team() }], showNextMatchIfNoGame: true });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });
    assert.ok(ctx.getLines().some((l) => l.text.includes("score indisponible")));
  });

  test("affiche un tableau de scores par période pour les sports concernés (basket, foot US, baseball)", async (t) => {
    mockEspn(t as any, {
      schedule: {
        events: [
          {
            id: "22",
            date: yesterday,
            competitions: [{ status: { type: { completed: true } }, competitors: [competitor("home", "1", "Lakers", "LAL", 101), competitor("away", "2", "Celtics", "BOS", 99)] }],
          },
        ],
      },
      summary: {
        header: {
          competitions: [
            {
              competitors: [
                { team: { id: "1" }, linescores: [{ displayValue: "25" }, { displayValue: "30" }, { displayValue: "20" }, { displayValue: "26" }] },
                { team: { id: "2" }, linescores: [{ displayValue: "20" }, { displayValue: "25" }, { displayValue: "28" }, { displayValue: "26" }] },
              ],
            },
          ],
        },
      },
    });

    const data = await sportsModule.fetchData({
      teams: [{ team: team({ sport: "basketball", leagueSlug: "nba", name: "Lakers" }) }],
      showNextMatchIfNoGame: true,
    });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });

    const lines = ctx.getLines();
    const homeRow = lines.find((l) => l.text.startsWith("LAL"))!;
    const awayRow = lines.find((l) => l.text.startsWith("BOS"))!;
    assert.ok(homeRow);
    assert.ok(awayRow);
    assert.equal(homeRow.bold, true); // équipe suivie
    assert.equal(awayRow.bold, false);
    assert.ok(homeRow.text.trimEnd().endsWith("101")); // colonne "T" = score final
  });
});

describe("sportsModule.renderReceipt — match à venir", () => {
  test("classe un événement futur comme 'À VENIR' quand showNextMatchIfNoGame est activé", async (t) => {
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockEspn(t as any, {
      teamInfo: {
        team: {
          nextEvent: [
            {
              id: "30",
              date: inAWeek,
              competitions: [{ status: { type: { completed: false } }, competitors: [competitor("home", "1", "Paris Saint-Germain", "PSG"), competitor("away", "2", "Lyon", "OL")] }],
            },
          ],
        },
      },
    });

    const data = await sportsModule.fetchData({ teams: [{ team: team() }], showNextMatchIfNoGame: true });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[1], "PARIS SAINT-GERMAIN - À VENIR");
  });

  test("ne montre aucun match à venir si showNextMatchIfNoGame est désactivé", async (t) => {
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockEspn(t as any, {
      teamInfo: {
        team: { nextEvent: [{ id: "31", date: inAWeek, competitions: [{ status: { type: { completed: false } }, competitors: [] }] }] },
      },
    });

    const data = await sportsModule.fetchData({ teams: [{ team: team() }], showNextMatchIfNoGame: false });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });
    assert.deepEqual(ctx.getLines(), []); // le module reste muet plutôt que d'imprimer une section vide
  });
});

describe("sportsModule.renderReceipt — plusieurs équipes", () => {
  test("ne reste muet que si AUCUNE équipe n'a de contenu, et sépare les sections par une ligne vide", async (t) => {
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockEspn(t as any, {
      teamInfo: {
        team: { nextEvent: [{ id: "40", date: inAWeek, competitions: [{ status: { type: { completed: false } }, competitors: [competitor("home", "1", "PSG", "PSG"), competitor("away", "9", "Lyon", "OL")] }] }] },
      },
    });

    const data = await sportsModule.fetchData({
      teams: [{ team: team() }, { team: team({ teamId: "1", name: "Paris Saint-Germain" }) }],
      showNextMatchIfNoGame: true,
    });
    const ctx = new ReceiptBuilder(48, 576);
    sportsModule.renderReceipt(data, ctx, { teams: [], showNextMatchIfNoGame: true });

    const blankIndexes = ctx.getLines().map((l, i) => (l.type === "blank" ? i : -1)).filter((i) => i >= 0);
    assert.ok(blankIndexes.length >= 1); // au moins une ligne vide entre les deux sections d'équipe
  });
});
