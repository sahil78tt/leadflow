import bcrypt from "bcrypt";
import mongoose, { type Types } from "mongoose";
import { connectDb } from "../config/db.js";
import { Brokerage } from "../models/Brokerage.js";
import { Lead, type Stage } from "../models/Lead.js";
import { User, type Role } from "../models/User.js";
import { Client } from "../models/Client.js";
import { skipTenant } from "../lib/tenantPlugin.js";
import { tenantStorage } from "../lib/tenantContext.js";

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

const sampleLeads: {
  name: string;
  email: string;
  phone: string;
  stage: Stage;
}[] = [
  {
    name: "Max Mustermann",
    email: "max.mustermann@example.de",
    phone: "+491701234567",
    stage: "new",
  },
  {
    name: "Erika Schmidt",
    email: "erika.schmidt@example.de",
    phone: "+491511234567",
    stage: "new",
  },
  {
    name: "Jonas Weber",
    email: "jonas.weber@example.de",
    phone: "+491601234567",
    stage: "contacted",
  },
  {
    name: "Lena Fischer",
    email: "lena.fischer@example.de",
    phone: "+491721234567",
    stage: "contacted",
  },
  {
    name: "Paul Becker",
    email: "paul.becker@example.de",
    phone: "+491731234567",
    stage: "qualified",
  },
  {
    name: "Sophie Wagner",
    email: "sophie.wagner@example.de",
    phone: "+491741234567",
    stage: "proposal",
  },
  {
    name: "Felix Hoffmann",
    email: "felix.hoffmann@example.de",
    phone: "+491751234567",
    stage: "won",
  },
  {
    name: "Clara Neumann",
    email: "clara.neumann@example.de",
    phone: "+491761234567",
    stage: "lost",
  },
];
const otherLeads: typeof sampleLeads = [
  {
    name: "Tim Krüger",
    email: "tim.krueger@example.de",
    phone: "+491771234567",
    stage: "new",
  },
  {
    name: "Nina Roth",
    email: "nina.roth@example.de",
    phone: "+491781234567",
    stage: "qualified",
  },
  {
    name: "Ben Lange",
    email: "ben.lange@example.de",
    phone: "+491791234567",
    stage: "contacted",
  },
];

async function ensureLeads(
  brokerageId: typeof a._id,
  leads: typeof sampleLeads,
) {
  for (const lead of leads) {
    try {
      await Lead.create({ ...lead, brokerageId, source: "seed" });
    } catch (err) {
      // Already seeded, or the email/phone matches an existing lead: the unique indexes doing their job.
      if (
        !(
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === 11000
        )
      )
        throw err;
    }
  }
}

await ensureLeads(a._id, sampleLeads); // Muster Finanz GmbH
await ensureLeads(b._id, otherLeads); // Hausbau Partner AG

await tenantStorage.run(
  { brokerageId: a._id.toString(), role: "seed" },
  async () => {
    const advisor = await skipTenant(
      User.findOne({
        email: "advisor@muster.test",
        role: "advisor",
      }),
    );

    if (!advisor) throw new Error("Seed advisor not found");

    let lead = await Lead.findOne({
      email: "demo.client@leadflow.test",
    });

    if (!lead) {
      lead = await Lead.create({
        name: "Demo Client",
        email: "demo.client@leadflow.test",
        phone: "+491701234599",
        stage: "won",
        source: "seed",
        brokerageId: a._id,
      });
    }

    let user = await User.findOne({
      email: "client@muster.test",
      role: "client",
    });

    if (!user) {
      const passwordHash = await bcrypt.hash("ClientDemo123!", 12);

      user = await User.create({
        name: "Demo Client",
        email: "client@muster.test",
        role: "client",
        brokerageId: a._id,
        passwordHash,
      });
    }

    let client = await Client.findOne({
      leadId: lead._id,
    });

    if (!client) {
      client = await Client.create({
        brokerageId: a._id,
        leadId: lead._id,
        userId: user._id,
        advisorId: advisor._id,
        name: "Demo Client",
        email: "client@muster.test",
        phone: lead.phone,
      });
    }

    if (!lead.clientId) {
      lead.clientId = client._id;
      lead.stage = "won";
      await lead.save();
    }

    console.log("Demo client login: client@muster.test / ClientDemo123!");
  },
);

console.log(`Webhook "Muster Finanz GmbH":   POST /api/leads/webhook/${a.id}`);

console.log(`Webhook "Hausbau Partner AG":   POST /api/leads/webhook/${b.id}`);

console.log(`Seeded. Password for all users: ${PASSWORD}`);

await mongoose.disconnect();
