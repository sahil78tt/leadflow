import "dotenv/config";
import { z } from "zod";

// Blank values in .env count as "not set".
const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().default(4000),
  // Checked lazily (see lib/cloudinary.ts) so everything except uploads works without them.
  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,
  // rediss://default:<password>@<host>:6379. Without it the dashboard runs uncached.
  UPSTASH_REDIS_URL: optional,
});

export const env = schema.parse(process.env);
