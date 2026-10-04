import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { initRedisCache } from "./lib/cache.js";
import { isCloudinaryConfigured } from "./lib/cloudinary.js";
import { recoverStuckChecks } from "./lib/documentChecks.js";
import { initSocket } from "./lib/socket.js";

await connectDb();
const httpServer = createServer(app);
initSocket(httpServer);

if (!isCloudinaryConfigured())
  console.warn("Cloudinary is not configured: document uploads will fail");
if (!initRedisCache())
  console.warn(
    "UPSTASH_REDIS_URL is not set: the dashboard will run without a cache",
  );

const recovered = await recoverStuckChecks();
if (recovered > 0)
  console.log(
    `Re-queued ${recovered} document check(s) interrupted by a restart`,
  );

httpServer.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
