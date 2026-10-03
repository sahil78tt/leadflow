import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { initSocket } from "./lib/socket.js";

await connectDb();
const httpServer = createServer(app);
initSocket(httpServer);
httpServer.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
