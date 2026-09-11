import type { FastifyInstance } from "fastify";
import { searchTeams } from "../modules/sports.module";

export default async function sportsRoutes(app: FastifyInstance): Promise<void> {
  // Utilisée par le Constructeur pour le flux "rechercher -> choisir" du module Sports :
  // ESPN peut renvoyer plusieurs équipes pour un même nom (homonymes, équipes féminines,
  // jeunes...), donc on laisse l'utilisateur choisir explicitement plutôt que de deviner.
  app.get<{ Querystring: { q?: string } }>("/api/sports/search-teams", async (req, reply) => {
    const q = req.query.q?.trim();
    if (!q) return reply.code(400).send({ error: "Paramètre 'q' requis." });

    try {
      const teams = await searchTeams(q);
      return { teams };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });
}
