import express from "express";
import type { DatabaseConnection } from "../db/connection";
import { registerRoutes } from "./routes";
import { handleError } from "../util/errors";

/** Create the HTTP server and register every API route. */
export function createServer(db: DatabaseConnection) {
  const app = express();
  registerRoutes(app, db);
  app.use(handleRequestError);
  return app;
}

/** Last-resort request error handler. */
export function handleRequestError(error: unknown, _req: unknown, res: { status(code: number): { json(body: unknown): void } }) {
  const { status, body } = handleError(error);
  res.status(status).json(body);
}
