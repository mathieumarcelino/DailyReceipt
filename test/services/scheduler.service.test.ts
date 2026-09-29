import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cron from "node-cron";
import { createSchedule } from "../../src/config/types";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailyreceipt-scheduler-test-"));
const tmpConfigPath = path.join(tmpDir, "config.json");
process.env.CONFIG_PATH = tmpConfigPath;

let listTickets: typeof import("../../src/services/tickets.service").listTickets;
let createTicket: typeof import("../../src/services/tickets.service").createTicket;
let updateTicketSchedule: typeof import("../../src/services/tickets.service").updateTicketSchedule;
let deleteTicket: typeof import("../../src/services/tickets.service").deleteTicket;
let rescheduleFromConfig: typeof import("../../src/services/scheduler.service").rescheduleFromConfig;
let toCronExpression: typeof import("../../src/services/scheduler.service").toCronExpression;

before(async () => {
  ({ listTickets, createTicket, updateTicketSchedule, deleteTicket } = await import("../../src/services/tickets.service"));
  ({ rescheduleFromConfig, toCronExpression } = await import("../../src/services/scheduler.service"));

  // Repart d'une liste de tickets vide et connue : le ticket par défaut amorcé au tout premier accès
  // (cf. store.test.ts) n'a pas sa place dans ces tests, qui créent explicitement leurs propres tickets.
  for (const ticket of await listTickets()) await deleteTicket(ticket.id);
});

describe("toCronExpression", () => {
  test("convertit heure + jour en expression cron 'minute heure * * jour'", () => {
    assert.equal(toCronExpression("07:30", "mon"), "30 7 * * 1");
    assert.equal(toCronExpression("23:05", "sun"), "5 23 * * 0");
    assert.equal(toCronExpression("00:00", "sat"), "0 0 * * 6");
  });

  test("rejette une heure mal formée", () => {
    assert.throws(() => toCronExpression("pas une heure", "mon"));
  });
});

/** Remplace cron.schedule par un espion qui n'exécute jamais réellement la tâche planifiée. */
function mockCronSchedule(t: import("node:test").TestContext) {
  const calls: { expression: string }[] = [];
  const stopFns: ReturnType<typeof t.mock.fn>[] = [];
  t.mock.method(cron, "schedule", (expression: string) => {
    calls.push({ expression });
    const stop = t.mock.fn();
    stopFns.push(stop);
    return { stop } as unknown as ReturnType<typeof cron.schedule>;
  });
  return { calls, stopFns };
}

describe("rescheduleFromConfig", () => {
  test("crée une tâche par jour activé, avec l'expression cron correspondant à son heure, et ignore les jours désactivés", async (t) => {
    const { calls } = mockCronSchedule(t);

    const morning = await createTicket("Matin");
    const morningSchedule = createSchedule("07:30", false);
    morningSchedule.mon.enabled = true;
    morningSchedule.wed.enabled = true;
    await updateTicketSchedule(morning.id, morningSchedule);

    const evening = await createTicket("Soir");
    await updateTicketSchedule(evening.id, createSchedule("18:00", false)); // tous les jours désactivés

    await rescheduleFromConfig();

    assert.equal(calls.length, 2);
    assert.ok(calls.some((c) => c.expression === "30 7 * * 1")); // lundi
    assert.ok(calls.some((c) => c.expression === "30 7 * * 3")); // mercredi

    await deleteTicket(morning.id);
    await deleteTicket(evening.id);
  });

  test("un même ticket peut imprimer à des heures différentes selon le jour", async (t) => {
    const { calls } = mockCronSchedule(t);

    const ticket = await createTicket("Semaine");
    const schedule = createSchedule("07:30", false);
    schedule.mon.enabled = true;
    schedule.fri.enabled = true;
    schedule.fri.time = "18:00"; // heure différente le vendredi
    await updateTicketSchedule(ticket.id, schedule);

    await rescheduleFromConfig();

    assert.equal(calls.length, 2);
    assert.ok(calls.some((c) => c.expression === "30 7 * * 1")); // lundi 07:30
    assert.ok(calls.some((c) => c.expression === "0 18 * * 5")); // vendredi 18:00

    await deleteTicket(ticket.id);
  });

  test("arrête les tâches précédentes avant d'en recréer de nouvelles", async (t) => {
    const { calls, stopFns } = mockCronSchedule(t);

    const first = await createTicket("Ticket 1");
    const schedule1 = createSchedule("08:00", false);
    schedule1.mon.enabled = true;
    await updateTicketSchedule(first.id, schedule1);
    await rescheduleFromConfig();
    assert.equal(calls.length, 1);
    assert.equal(stopFns[0].mock.callCount(), 0);

    const second = await createTicket("Ticket 2");
    const schedule2 = createSchedule("09:00", false);
    schedule2.tue.enabled = true;
    await updateTicketSchedule(second.id, schedule2);
    await rescheduleFromConfig();

    assert.equal(calls.length, 3); // 1 (premier appel, ticket 1) + 2 (recréées au second appel : ticket 1 + ticket 2)
    assert.equal(stopFns[0].mock.callCount(), 1); // la tâche du premier appel a bien été arrêtée avant recréation

    await deleteTicket(first.id);
    await deleteTicket(second.id);
  });
});
