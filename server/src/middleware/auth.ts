import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/jwt.js";
import { tenantStorage } from "../lib/tenantContext.js";
import type { Role } from "../models/User.js";

export interface AuthUser {
  id: string;
  role: Role;
  brokerageId: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  try {
    const p = verifyToken(header.slice(7));
    req.user = { id: p.sub, role: p.role, brokerageId: p.brokerageId };
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  // Everything downstream (incl. async DB calls) runs inside this context; M2's plugin reads it.
  tenantStorage.run(
    { brokerageId: req.user.brokerageId, role: req.user.role },
    next,
  );
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
