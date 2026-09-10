import type { FastifyInstance } from "fastify";

export default async function pagesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_req, reply) => {
    return reply.redirect("/printer");
  });

  app.get("/printer", async (_req, reply) => {
    return reply.view("printer.ejs", { active: "printer" });
  });

  app.get("/schedule", async (_req, reply) => {
    return reply.view("schedule.ejs", { active: "schedule" });
  });

  app.get("/builder", async (_req, reply) => {
    return reply.view("builder.ejs", { active: "builder" });
  });
}
