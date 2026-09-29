import type { FastifyInstance } from "fastify";
import { configStore } from "../config/store";
import { DEFAULT_PROMPT_TEMPLATE } from "../lib/ai-summarizer";

export default async function newsRoutes(app: FastifyInstance): Promise<void> {
  // Permet de forcer un nouveau résumé sans attendre l'expiration naturelle du cache (jusqu'au
  // lendemain) — pratique pour tester une modification (flux, longueur cible...) immédiatement.
  // Ne vide que les entrées de CE ticket (clé "<ticketId>:<label>", voir news.module.ts) : vider le
  // cache d'un ticket ne doit pas priver les autres tickets de leurs résumés déjà générés.
  app.post<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/news/clear-cache", async (req) => {
    const { ticketId } = req.params;
    const prefix = `${ticketId}:`;
    await configStore.updateConfig((draft) => {
      const newsCache = draft.state.newsCache ?? {};
      draft.state.newsCache = Object.fromEntries(Object.entries(newsCache).filter(([key]) => !key.startsWith(prefix)));
    });
    return { ok: true };
  });

  // Sert de point de départ à l'édition du prompt d'un sujet dans le Constructeur.
  app.get("/api/news/default-prompt", async () => ({ prompt: DEFAULT_PROMPT_TEMPLATE }));
}
