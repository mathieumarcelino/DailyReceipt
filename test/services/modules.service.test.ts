import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `modules.service.ts` importe le singleton `configStore`, qui lit le fichier de config dès sa
// construction. On écrit une config "legacy" sur disque puis on pointe `CONFIG_PATH` dessus avant
// tout import, pour que la migration testée s'exécute sur des données représentatives d'un vrai
// fichier utilisateur pré-existant (à plat, avant le passage au multi-ticket) plutôt que sur un état vide.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailyreceipt-modules-service-test-"));
const tmpConfigPath = path.join(tmpDir, "config.json");

const legacyNewsFeeds = [
  { label: "Tech", url: "https://example.com/tech-a.xml", maxArticles: 5 },
  { label: "Tech", url: "https://example.com/tech-b.xml", maxArticles: 3 },
  { label: "Sport", url: "https://example.com/sport.xml", maxArticles: 2 },
];

fs.writeFileSync(
  tmpConfigPath,
  JSON.stringify({
    modules: [{ id: "news", enabled: true, order: 1, config: { feeds: legacyNewsFeeds, summaryTargetLines: 20, apiKey: "key", model: "m" } }],
  }),
  "utf-8",
);
process.env.CONFIG_PATH = tmpConfigPath;

let listTickets: typeof import("../../src/services/tickets.service").listTickets;
let listModules: typeof import("../../src/services/modules.service").listModules;

before(async () => {
  ({ listTickets } = await import("../../src/services/tickets.service"));
  ({ listModules } = await import("../../src/services/modules.service"));
});

async function newsConfig(): Promise<any> {
  const [ticket] = await listTickets(); // déclenche la migration schedule+modules -> ticket unique
  const modules = await listModules(ticket.id); // déclenche ensureModuleInstances() -> migrations, dont celle des flux Actualités
  return modules.find((m) => m.id === "news")?.config;
}

describe("migration : ancienne config Actualités (feeds à plat) -> sujets groupés (topics)", () => {
  test("regroupe les anciens flux par label en sujets, sans perdre d'URL", async () => {
    const config = await newsConfig();

    assert.equal(config.feeds, undefined);
    assert.equal(config.topics.length, 2);

    const tech = config.topics.find((t: any) => t.label === "Tech");
    assert.deepEqual(
      tech.feeds.map((f: any) => f.url),
      ["https://example.com/tech-a.xml", "https://example.com/tech-b.xml"],
    );

    const sport = config.topics.find((t: any) => t.label === "Sport");
    assert.equal(sport.feeds.length, 1);
    assert.equal(sport.feeds[0].url, "https://example.com/sport.xml");

    // Les autres champs de la config (non concernés par la migration) sont préservés.
    assert.equal(config.summaryTargetLines, 20);
    assert.equal(config.apiKey, "key");
  });

  test("est idempotente : un second appel ne modifie plus rien", async () => {
    const before = JSON.stringify(await newsConfig());
    const after = JSON.stringify(await newsConfig());

    assert.equal(before, after);
  });
});
