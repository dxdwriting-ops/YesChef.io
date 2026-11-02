import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config, { listen } from "@colyseus/tools";
import express from "express";
import { KitchenRoom } from "./KitchenRoom";

// Hosts (Render, etc.) hand us PORT. Locally the dev script sets GAME_PORT=2567 so it never
// collides with a PORT meant for the Vite dev server.
const port = Number(process.env.GAME_PORT ?? process.env.PORT ?? 2567);
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

await listen(
  config({
    initializeGameServer: (gameServer) => {
      // Quick play matches chefs by mode and restaurant. Career, challenge and training rooms are
      // created privately by the client (client.create), so nobody else lands in them.
      gameServer.define("kitchen", KitchenRoom).filterBy(["mode", "tier"]);
    },
    initializeExpress: (app) => {
      app.get("/health", (_req, res) => {
        res.send("ok");
      });
      // In production the same server also serves the built game, so one service hosts everything.
      if (existsSync(dist)) app.use(express.static(dist));
    },
  }),
  port,
);
console.log(`chef.io kitchen server listening on port ${port}`);
