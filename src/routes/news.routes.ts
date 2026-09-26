import type { FastifyInstance } from "fastify";
import { configStore } from "../config/store";
import { DEFAULT_PROMPT_TEMPLATE } from "../lib/ai-summarizer";

export default async function newsRoutes(app: FastifyInstance): Promise<void> {
  // Permet de forcer un nouveau résumé sans attendre l'expiration naturelle du cache (jusqu'au
  // lendemain) — pratique pour tester une modification (flux, longueur cible...) immédiatement.
  app.post("/api/news/clear-cache", async () => {
    await configStore.updateConfig((draft) => {
      draft.state.newsCache = {};
    });
    return { ok: true };
  });

  // Sert de point de départ à l'édition du prompt d'un sujet dans le Constructeur.
  app.get("/api/news/default-prompt", async () => ({ prompt: DEFAULT_PROMPT_TEMPLATE }));
}
