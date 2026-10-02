import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: err.issues.map((i) => i.message).join("; ") });
  }
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  ) {
    return res.status(err.status).json({ error: "Bad request" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
