import type { FastifyInstance } from "fastify";
import { searchStocks } from "../modules/stocks.module";

export default async function stocksRoutes(app: FastifyInstance): Promise<void> {
  // Utilisée par le Constructeur pour le flux "rechercher -> choisir" du module Bourse :
  // un même nom peut correspondre à plusieurs cotations (marché principal, ETF, filiale
  // cotée séparément...), donc on laisse l'utilisateur choisir explicitement plutôt que
  // de deviner le symbole.
  app.get<{ Querystring: { q?: string } }>("/api/stocks/search", async (req, reply) => {
    const q = req.query.q?.trim();
    if (!q) return reply.code(400).send({ error: "Paramètre 'q' requis." });

    try {
      const results = await searchStocks(q);
      return { results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });
}
