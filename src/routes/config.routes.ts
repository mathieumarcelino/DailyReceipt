import type { FastifyInstance } from "fastify";
import { configStore } from "../config/store";
import type { PrinterProfile } from "../config/types";
import { rescheduleFromConfig } from "../services/scheduler.service";

const VALID_PROFILES: PrinterProfile[] = ["CP437", "CP858", "CP1252"];
const VALID_COLUMNS = [42, 48];
const VALID_PRINT_WIDTHS = [384, 576];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/printer", async () => {
    return configStore.getConfig().printer;
  });

  app.put<{ Body: { host?: string; port?: number; profile?: string; columns?: number; printWidthPx?: number } }>("/api/printer", async (req, reply) => {
    const { host, port, profile, columns, printWidthPx } = req.body ?? {};

    if (!host || typeof host !== "string" || host.trim().length === 0) {
      return reply.code(400).send({ error: "L'adresse IP de l'imprimante est requise." });
    }
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
      return reply.code(400).send({ error: "Le port doit être un entier entre 1 et 65535." });
    }
    if (!profile || !VALID_PROFILES.includes(profile as PrinterProfile)) {
      return reply.code(400).send({ error: `Le profil doit être l'un de : ${VALID_PROFILES.join(", ")}.` });
    }
    if (!VALID_COLUMNS.includes(columns as number)) {
      return reply.code(400).send({ error: "Le nombre de colonnes doit être 42 ou 48." });
    }
    if (!VALID_PRINT_WIDTHS.includes(printWidthPx as number)) {
      return reply.code(400).send({ error: "La largeur d'impression doit être 384 ou 576 points." });
    }

    const updated = await configStore.updateConfig((cfg) => {
      cfg.printer = {
        host: host.trim(),
        port: port as number,
        profile: profile as PrinterProfile,
        columns: columns as 42 | 48,
        printWidthPx: printWidthPx as 384 | 576,
      };
    });
    return updated.printer;
  });

  app.get("/api/schedule", async () => {
    const cfg = configStore.getConfig();
    return { ...cfg.schedule, lastRun: cfg.state.lastRun ?? null };
  });

  app.put<{ Body: { time?: string; enabled?: boolean } }>("/api/schedule", async (req, reply) => {
    const { time, enabled } = req.body ?? {};

    if (!time || !TIME_RE.test(time)) {
      return reply.code(400).send({ error: "L'heure doit être au format HH:MM." });
    }
    if (typeof enabled !== "boolean") {
      return reply.code(400).send({ error: "Le champ 'enabled' doit être un booléen." });
    }

    const updated = await configStore.updateConfig((cfg) => {
      cfg.schedule = { time, enabled };
    });

    rescheduleFromConfig();
    return { ...updated.schedule, lastRun: updated.state.lastRun ?? null };
  });
}
