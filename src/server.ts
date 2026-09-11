import path from "node:path";
import Fastify, { FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import ejs from "ejs";

import { rescheduleFromConfig } from "./services/scheduler.service";
import pagesRoutes from "./routes/pages.routes";
import configRoutes from "./routes/config.routes";
import modulesRoutes from "./routes/modules.routes";
import printRoutes from "./routes/print.routes";
import sportsRoutes from "./routes/sports.routes";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(fastifyView, {
    engine: { ejs },
    root: path.join(__dirname, "views"),
    viewExt: "ejs",
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
  });

  await app.register(pagesRoutes);
  await app.register(configRoutes);
  await app.register(modulesRoutes);
  await app.register(printRoutes);
  await app.register(sportsRoutes);

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error(err);
    reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Erreur interne" });
  });

  rescheduleFromConfig();

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error("Échec du démarrage de DailyReceipt :", err);
  process.exit(1);
});
