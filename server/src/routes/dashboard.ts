import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { getPipelineSummary } from "../lib/dashboard.js";

const router = Router();

// The brokerage comes from the verified token only. All advisors of a brokerage share one cached summary.
router.get(
  "/",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const brokerageId = req.user!.brokerageId;
    if (!brokerageId) return res.status(403).json({ error: "Forbidden" });

    const { summary, hit } = await getPipelineSummary(brokerageId);
    res.set("X-Cache", hit ? "HIT" : "MISS"); // visible in DevTools; handy for checking the cache
    res.set("Cache-Control", "no-store"); // browsers must not cache it: the server-side cache is the one that counts
    res.json(summary);
  },
);

export default router;
