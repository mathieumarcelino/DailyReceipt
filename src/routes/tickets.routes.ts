import type { FastifyInstance } from "fastify";
import { createTicket, deleteTicket, getTicket, listTickets, renameTicket, updateTicketSchedule } from "../services/tickets.service";
import { rescheduleFromConfig } from "../services/scheduler.service";
import { WEEKDAYS, type ScheduleConfig } from "../config/types";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Valide qu'un schedule reçu du client couvre exactement les 7 jours, chacun avec une heure HH:MM et un booléen `enabled`. */
function validateSchedule(schedule: unknown): schedule is ScheduleConfig {
  if (!schedule || typeof schedule !== "object") return false;
  return WEEKDAYS.every((day) => {
    const daySchedule = (schedule as Record<string, unknown>)[day] as { time?: unknown; enabled?: unknown } | undefined;
    return !!daySchedule && typeof daySchedule.time === "string" && TIME_RE.test(daySchedule.time) && typeof daySchedule.enabled === "boolean";
  });
}

export default async function ticketsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tickets", async () => {
    return listTickets();
  });

  app.post<{ Body: { name?: string } }>("/api/tickets", async (req) => {
    const name = req.body?.name?.trim() || "Nouveau ticket";
    const ticket = await createTicket(name);
    await rescheduleFromConfig();
    return ticket;
  });

  app.put<{ Params: { id: string }; Body: { name?: string; schedule?: unknown } }>("/api/tickets/:id", async (req, reply) => {
    const { id } = req.params;
    const { name, schedule } = req.body ?? {};

    if (!(await getTicket(id))) {
      return reply.code(404).send({ error: `Ticket inconnu : ${id}` });
    }

    if (typeof name === "string" && name.trim()) {
      await renameTicket(id, name.trim());
    }

    if (schedule !== undefined) {
      if (!validateSchedule(schedule)) {
        return reply.code(400).send({ error: "La planification doit fournir une heure (HH:MM) et un statut activé/désactivé pour chacun des 7 jours." });
      }
      await updateTicketSchedule(id, schedule);
      await rescheduleFromConfig();
    }

    return getTicket(id);
  });

  app.delete<{ Params: { id: string } }>("/api/tickets/:id", async (req, reply) => {
    const removed = await deleteTicket(req.params.id);
    if (!removed) return reply.code(404).send({ error: `Ticket inconnu : ${req.params.id}` });
    await rescheduleFromConfig();
    return { ok: true };
  });
}
