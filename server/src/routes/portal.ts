import { Router } from "express";
import { Client } from "../models/Client.js";
import { User } from "../models/User.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

// The only identity used is the token's user id: there is no id in the URL to guess.
// The brokerage filter is added by tenantPlugin, so this is "own client AND own brokerage".
router.get("/case", authenticate, requireRole("client"), async (req, res) => {
  const client = await Client.findOne({ userId: req.user!.id });
  if (!client) return res.status(404).json({ error: "No case found" });

  const advisor = await User.findById(client.advisorId);
  res.json({
    case: {
      id: client.id as string,
      name: client.name,
      email: client.email,
      phone: client.phone,
      openedAt: client.createdAt,
      advisor: advisor ? { name: advisor.name } : null,
    },
  });
});

export default router;
