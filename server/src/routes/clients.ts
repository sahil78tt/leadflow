import { Router } from "express";
import { Client } from "../models/Client.js";
import { ClientDocument, publicDocument } from "../models/ClientDocument.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { isObjectId } from "../lib/ids.js";

const router = Router();

// Staff only. A client id from another brokerage matches nothing (tenantPlugin), so it is a plain 404.
router.get(
  "/:clientId",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const clientId = String(req.params.clientId);
    if (!isObjectId(clientId))
      return res.status(404).json({ error: "Not found" });
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Not found" });

    res.json({
      client: {
        id: client.id as string,
        name: client.name,
        email: client.email,
        phone: client.phone,
        openedAt: client.createdAt,
      },
    });
  },
);

router.get(
  "/:clientId/documents",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const clientId = String(req.params.clientId);
    if (!isObjectId(clientId))
      return res.status(404).json({ error: "Not found" });
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Not found" });

    const documents = await ClientDocument.find({ clientId: client._id }).sort({
      createdAt: -1,
    });
    res.json({ documents: documents.map(publicDocument) });
  },
);

export default router;
