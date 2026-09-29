import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSchedule } from "../../src/config/types";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailyreceipt-store-fresh-test-"));
const tmpConfigPath = path.join(tmpDir, "config.json");
process.env.CONFIG_PATH = tmpConfigPath;

describe("ConfigStore : création d'un fichier neuf", () => {
  test("amorce un fichier inexistant avec exactement un ticket par défaut", async () => {
    const { configStore } = await import("../../src/config/store");
    const cfg = configStore.getConfig();

    assert.equal(cfg.tickets.length, 1);
    assert.equal(cfg.tickets[0].name, "Ticket du matin");
    assert.deepEqual(cfg.tickets[0].schedule, createSchedule("07:30", true));
    assert.deepEqual(cfg.tickets[0].modules, []);

    // Le fichier écrit sur disque contient bien ce ticket (pas seulement le cache en mémoire).
    const raw = JSON.parse(fs.readFileSync(tmpConfigPath, "utf-8"));
    assert.equal(raw.tickets.length, 1);
  });
});
