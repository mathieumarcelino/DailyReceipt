import type { FastifyInstance } from "fastify";
import { listModules, reorderModules, setModuleConfig, setModuleEnabled } from "../services/modules.service";
import { getTicket } from "../services/tickets.service";

export default async function modulesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/modules", async (req, reply) => {
    const { ticketId } = req.params;
    if (!(await getTicket(ticketId))) return reply.code(404).send({ error: `Ticket inconnu : ${ticketId}` });
    return listModules(ticketId);
  });

  app.put<{ Params: { ticketId: string }; Body: { order?: string[] } }>("/api/tickets/:ticketId/modules/order", async (req, reply) => {
    const { ticketId } = req.params;
    if (!(await getTicket(ticketId))) return reply.code(404).send({ error: `Ticket inconnu : ${ticketId}` });

    const { order } = req.body ?? {};
    if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
      return reply.code(400).send({ error: "Le champ 'order' doit être un tableau d'identifiants." });
    }
    await reorderModules(ticketId, order);
    return listModules(ticketId);
  });

  app.put<{ Params: { ticketId: string; id: string }; Body: { enabled?: boolean; config?: Record<string, unknown> } }>(
    "/api/tickets/:ticketId/modules/:id",
    async (req, reply) => {
      const { ticketId, id } = req.params;
      if (!(await getTicket(ticketId))) return reply.code(404).send({ error: `Ticket inconnu : ${ticketId}` });

      const { enabled, config } = req.body ?? {};
      const modules = await listModules(ticketId);
      if (!modules.some((m) => m.id === id)) {
        return reply.code(404).send({ error: `Module inconnu : ${id}` });
      }

      if (typeof enabled === "boolean") await setModuleEnabled(ticketId, id, enabled);
      if (config && typeof config === "object") await setModuleConfig(ticketId, id, config);

      return (await listModules(ticketId)).find((m) => m.id === id);
    },
  );
}
