import type { FastifyInstance } from "fastify";
import { searchCryptos } from "../modules/crypto.module";

export default async function cryptoRoutes(app: FastifyInstance): Promise<void> {
  // Utilisée par le Constructeur pour le flux "rechercher -> choisir" du module Crypto :
  // plusieurs cryptos peuvent partager un nom proche (clones, forks, jetons homonymes),
  // donc on laisse l'utilisateur choisir explicitement plutôt que de deviner l'identifiant CoinGecko.
  app.get<{ Querystring: { q?: string } }>("/api/crypto/search", async (req, reply) => {
    const q = req.query.q?.trim();
    if (!q) return reply.code(400).send({ error: "Paramètre 'q' requis." });

    try {
      const results = await searchCryptos(q);
      return { results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });
}
