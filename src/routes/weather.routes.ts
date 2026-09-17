import type { FastifyInstance } from "fastify";
import { reverseGeocode } from "../modules/weather.module";

export default async function weatherRoutes(app: FastifyInstance): Promise<void> {
  // Utilisée par le Constructeur pour pré-remplir automatiquement le nom de la ville quand
  // l'utilisateur déplace le repère sur la carte du module Météo (le champ reste modifiable ensuite).
  app.get<{ Querystring: { lat?: string; lng?: string } }>("/api/weather/reverse-geocode", async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ error: "Paramètres 'lat' et 'lng' requis." });
    }

    try {
      const city = await reverseGeocode(lat, lng);
      return { city };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });
}
