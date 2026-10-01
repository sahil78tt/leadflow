import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().default(4000),
});

export const env = schema.parse(process.env);
