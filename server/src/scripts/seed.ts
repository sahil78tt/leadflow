import bcrypt from "bcrypt";
import mongoose, { type Types } from "mongoose";
import { connectDb } from "../config/db.js";
import { Brokerage } from "../models/Brokerage.js";
import { User, type Role } from "../models/User.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const PASSWORD = process.env.SEED_PASSWORD ?? "ChangeMe123!";

await connectDb();

const passwordHash = await bcrypt.hash(PASSWORD, 12);

async function ensureBrokerage(name: string) {
  return (
    (await Brokerage.findOne({ name })) ?? (await Brokerage.create({ name }))
  );
}

async function ensureUser(
  name: string,
  email: string,
  role: Role,
  brokerageId: Types.ObjectId | null = null,
) {
  if (await skipTenant(User.exists({ email }))) return;

  await User.create({
    name,
    email,
    role,
    brokerageId,
    passwordHash,
  });
}

const a = await ensureBrokerage("Muster Finanz GmbH");
const b = await ensureBrokerage("Hausbau Partner AG");

await ensureUser("Platform Admin", "admin@leadflow.test", "platform_admin");

await ensureUser("Anna Admin", "admin@muster.test", "brokerage_admin", a._id);

await ensureUser("Max Advisor", "advisor@muster.test", "advisor", a._id);

await ensureUser("Bea Advisor", "advisor@hausbau.test", "advisor", b._id);

console.log(`Seeded. Password for all users: ${PASSWORD}`);

await mongoose.disconnect();
