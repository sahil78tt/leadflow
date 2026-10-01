import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../models/User.js";

export interface TokenPayload {
  sub: string;
  role: Role;
  brokerageId: string | null;
}

export function signToken(p: {
  id: string;
  role: Role;
  brokerageId: string | null;
}) {
  return jwt.sign(
    { role: p.role, brokerageId: p.brokerageId },
    env.JWT_SECRET,
    {
      subject: p.id,
      expiresIn: "8h",
    },
  );
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof decoded === "string" ||
    typeof decoded.sub !== "string" ||
    !ROLES.includes(decoded.role)
  ) {
    throw new Error("Malformed token");
  }
  return {
    sub: decoded.sub,
    role: decoded.role,
    brokerageId: decoded.brokerageId ?? null,
  };
}
