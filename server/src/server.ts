import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";

await connectDb();
app.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
