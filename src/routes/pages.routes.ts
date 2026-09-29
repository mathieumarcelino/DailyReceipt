import type { FastifyInstance } from "fastify";
import { getTicket } from "../services/tickets.service";

export default async function pagesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_req, reply) => {
    return reply.redirect("/tickets");
  });

  app.get("/settings", async (_req, reply) => {
    return reply.view("settings.ejs", { active: "settings" });
  });

  app.get("/tickets", async (_req, reply) => {
    return reply.view("tickets.ejs", { active: "tickets" });
  });

  app.get<{ Params: { id: string } }>("/tickets/:id", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.redirect("/tickets"); // id inconnu/supprimé : retour à la liste plutôt qu'une page cassée
    return reply.view("builder.ejs", { active: "tickets", ticketId: ticket.id, ticketName: ticket.name, ticketSchedule: ticket.schedule });
  });
}
