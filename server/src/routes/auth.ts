import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { User } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1),
});

const publicUser = (u: InstanceType<typeof User>) => ({
  id: u.id as string,
  name: u.name,
  email: u.email,
  role: u.role,
  brokerageId: u.brokerageId ? u.brokerageId.toString() : null,
});

router.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await User.findOne({ email }).select("+passwordHash");
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok)
    return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken({
    id: user.id,
    role: user.role,
    brokerageId: user.brokerageId ? user.brokerageId.toString() : null,
  });
  res.json({ token, user: publicUser(user) });
});

router.get("/me", authenticate, async (req, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) return res.status(401).json({ error: "User no longer exists" });
  res.json({ user: publicUser(user) });
});

export default router;
