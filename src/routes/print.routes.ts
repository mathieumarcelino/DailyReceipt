import type { FastifyInstance } from "fastify";
import { configStore } from "../config/store";
import type { PrinterProfile } from "../config/types";
import { printTestTicket } from "../services/printer.service";
import { triggerNow } from "../services/scheduler.service";
import { buildReceiptLines } from "../services/receipt-builder";

const VALID_PROFILES: PrinterProfile[] = ["CP437", "CP858", "CP1252"];

export default async function printRoutes(app: FastifyInstance): Promise<void> {
  // Permet de tester avec les valeurs actuellement dans le formulaire, même non enregistrées.
  app.post<{ Body: { host?: string; port?: number; profile?: string; columns?: number; printWidthPx?: number } }>("/api/print/test", async (req, reply) => {
    const stored = configStore.getConfig().printer;
    const body = req.body ?? {};

    const host = (body.host ?? stored.host)?.toString().trim();
    const port = body.port ?? stored.port;
    const profile = (body.profile as PrinterProfile) ?? stored.profile;
    const columns = (body.columns as 42 | 48) ?? stored.columns;
    const printWidthPx = (body.printWidthPx as 384 | 576) ?? stored.printWidthPx;

    if (!host) return reply.code(400).send({ error: "L'adresse IP de l'imprimante est requise." });
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reply.code(400).send({ error: "Port invalide." });
    if (!VALID_PROFILES.includes(profile)) return reply.code(400).send({ error: "Profil invalide." });

    try {
      await printTestTicket({ host, port, profile, columns: columns === 42 ? 42 : 48, printWidthPx: printWidthPx === 384 ? 384 : 576 });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });

  app.post("/api/print/now", async (_req, reply) => {
    try {
      await triggerNow();
      return { ok: true, lastRun: configStore.getConfig().state.lastRun };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message, lastRun: configStore.getConfig().state.lastRun });
    }
  });

  app.get("/api/receipt/preview", async () => {
    const { columns, printWidthPx } = configStore.getConfig().printer;
    const lines = await buildReceiptLines(columns, printWidthPx);
    return { columns, lines };
  });
}
