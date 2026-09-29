import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSchedule } from "../../src/config/types";

// `tickets.service.ts` importe le singleton `configStore`, qui lit le fichier de config dès sa
// construction. On écrit une config "legacy" complète et réaliste (imprimante, planning, module
// configuré avec sa clé API, dernière impression, cache Actualités) sur disque puis on pointe
// `CONFIG_PATH` dessus avant tout import, pour vérifier que la migration multi-tickets ne perd rien
// de la config réelle d'un utilisateur existant.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailyreceipt-tickets-service-test-"));
const tmpConfigPath = path.join(tmpDir, "config.json");

const legacyConfig = {
  printer: { host: "192.168.1.50", port: 9100, profile: "CP858", columns: 48, printWidthPx: 576 },
  schedule: { time: "07:15", enabled: true },
  modules: [{ id: "weather", enabled: true, order: 1, config: { apiKey: "secret" } }],
  state: {
    lastRun: { timestamp: "2026-09-01T07:15:00.000Z", status: "success" },
    newsCache: { Tech: { summary: "ancien résumé", cachedAt: "2026-09-01T00:00:00.000Z" } },
  },
};

fs.writeFileSync(tmpConfigPath, JSON.stringify(legacyConfig), "utf-8");
process.env.CONFIG_PATH = tmpConfigPath;

let configStore: typeof import("../../src/config/store").configStore;
let listTickets: typeof import("../../src/services/tickets.service").listTickets;
let getTicket: typeof import("../../src/services/tickets.service").getTicket;
let createTicket: typeof import("../../src/services/tickets.service").createTicket;
let renameTicket: typeof import("../../src/services/tickets.service").renameTicket;
let updateTicketSchedule: typeof import("../../src/services/tickets.service").updateTicketSchedule;
let deleteTicket: typeof import("../../src/services/tickets.service").deleteTicket;

before(async () => {
  ({ configStore } = await import("../../src/config/store"));
  ({ listTickets, getTicket, createTicket, renameTicket, updateTicketSchedule, deleteTicket } = await import("../../src/services/tickets.service"));
});

describe("migration : schedule+modules à plat -> ticket unique", () => {
  test("regroupe schedule, modules et lastRun dans un seul ticket, sans toucher printer/newsCache", async () => {
    const tickets = await listTickets();
    assert.equal(tickets.length, 1);

    const [ticket] = tickets;
    assert.equal(ticket.name, "Ticket du matin");
    // La planification legacy (une heure/activation unique) est répétée sur les 7 jours.
    assert.deepEqual(ticket.schedule, createSchedule("07:15", true));
    assert.deepEqual(ticket.lastRun, legacyConfig.state.lastRun);

    const cfg = configStore.getConfig();
    assert.deepEqual(cfg.printer, legacyConfig.printer);
    assert.deepEqual(cfg.tickets[0].modules, legacyConfig.modules);
    assert.deepEqual(cfg.state.newsCache, legacyConfig.state.newsCache);
  });

  test("ne laisse aucune clé 'schedule'/'modules' résiduelle sur le fichier disque", () => {
    const raw = JSON.parse(fs.readFileSync(tmpConfigPath, "utf-8"));
    assert.equal(raw.schedule, undefined);
    assert.equal(raw.modules, undefined);
    assert.equal(Array.isArray(raw.tickets), true);
    assert.equal(raw.tickets.length, 1);
  });

  test("est idempotente : un second accès ne recrée pas de ticket", async () => {
    const [first] = await listTickets();
    const again = await listTickets();
    assert.equal(again.length, 1);
    assert.equal(again[0].id, first.id);
  });
});

describe("migration : planification quotidienne unique -> par jour de la semaine", () => {
  test("un ticket dont le schedule est encore { time, enabled } est converti (même heure/activation répétée sur les 7 jours)", async () => {
    // Simule un ticket écrit par une version antérieure à la planification par jour (avant que
    // `Ticket.schedule` ne devienne un objet par jour), en écrivant directement dans le store.
    await configStore.updateConfig((draft) => {
      const ticket = draft.tickets[0];
      (ticket as any).schedule = { time: "06:45", enabled: false };
    });

    const [ticket] = await listTickets();
    assert.deepEqual(ticket.schedule, createSchedule("06:45", false));
  });
});

describe("CRUD", () => {
  test("createTicket crée un ticket désactivé par défaut, tous les jours", async () => {
    const created = await createTicket("Soir");
    assert.equal(created.name, "Soir");
    assert.deepEqual(created.schedule, createSchedule("07:30", false));

    assert.equal((await listTickets()).length, 2);
  });

  test("renameTicket et updateTicketSchedule modifient le ticket ciblé, 404 (undefined) si id inconnu", async () => {
    const [, evening] = await listTickets();

    const renamed = await renameTicket(evening.id, "Soirée");
    assert.equal(renamed?.name, "Soirée");

    const rescheduled = await updateTicketSchedule(evening.id, createSchedule("18:30", true));
    assert.deepEqual(rescheduled?.schedule, createSchedule("18:30", true));

    assert.equal(await renameTicket("inconnu", "x"), undefined);
    assert.equal(await updateTicketSchedule("inconnu", createSchedule("00:00", false)), undefined);
  });

  test("updateTicketSchedule accepte des heures/activations différentes par jour", async () => {
    const [, evening] = await listTickets();

    const mixed = createSchedule("18:30", true);
    mixed.fri.time = "20:00";
    mixed.sat.enabled = false;
    mixed.sun.enabled = false;

    const updated = await updateTicketSchedule(evening.id, mixed);
    assert.deepEqual(updated?.schedule, mixed);
  });

  test("deleteTicket autorise de vider tous les tickets, y compris le dernier, sans réamorçage automatique", async () => {
    const tickets = await listTickets();
    assert.equal(tickets.length, 2);

    assert.equal(await deleteTicket("inconnu"), false);

    for (const ticket of tickets) {
      assert.equal(await deleteTicket(ticket.id), true);
    }

    // État vide autorisé (choix produit validé) : un accès ultérieur ne doit PAS faire réapparaître
    // un ticket par défaut, sous peine de rendre la suppression du dernier ticket impossible pour l'utilisateur.
    assert.deepEqual(await listTickets(), []);
    assert.equal(await getTicket(tickets[0].id), undefined);
  });
});
