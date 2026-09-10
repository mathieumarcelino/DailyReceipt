import type { FastifyInstance } from "fastify";
import { listModules, reorderModules, setModuleConfig, setModuleEnabled } from "../services/modules.service";

export default async function modulesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/modules", async () => {
    return listModules();
  });

  app.put<{ Body: { order?: string[] } }>("/api/modules/order", async (req, reply) => {
    const { order } = req.body ?? {};
    if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
      return reply.code(400).send({ error: "Le champ 'order' doit être un tableau d'identifiants." });
    }
    await reorderModules(order);
    return listModules();
  });

  app.put<{ Params: { id: string }; Body: { enabled?: boolean; config?: Record<string, unknown> } }>("/api/modules/:id", async (req, reply) => {
    const { id } = req.params;
    const { enabled, config } = req.body ?? {};

    const modules = await listModules();
    if (!modules.some((m) => m.id === id)) {
      return reply.code(404).send({ error: `Module inconnu : ${id}` });
    }

    if (typeof enabled === "boolean") await setModuleEnabled(id, enabled);
    if (config && typeof config === "object") await setModuleConfig(id, config);

    return (await listModules()).find((m) => m.id === id);
  });
}
