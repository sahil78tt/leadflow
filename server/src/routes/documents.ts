import { Router } from "express";
import { Client } from "../models/Client.js";
import { ClientDocument, publicDocument } from "../models/ClientDocument.js";
import {
  authenticate,
  requireRole,
  type AuthUser,
} from "../middleware/auth.js";
import { storage } from "../lib/cloudinary.js";
import { enqueueCheck } from "../lib/documentChecks.js";
import { isObjectId } from "../lib/ids.js";
import { emitDocumentChanged } from "../lib/socket.js";

const router = Router();

// Staff of the brokerage, or the client who owns the document. Anything else is a plain 404 (no existence oracle).
async function loadAccessible(user: AuthUser, id: string) {
  if (!isObjectId(id)) return null;
  const doc = await ClientDocument.findById(id).select("+publicId +format"); // tenant-scoped by the plugin
  if (!doc) return null;
  if (user.role === "client") {
    const own = await Client.findOne({ userId: user.id });
    if (!own || !own._id.equals(doc.clientId)) return null;
  }
  return doc;
}

router.get(
  "/:id/link",
  authenticate,
  requireRole("advisor", "brokerage_admin", "client"),
  async (req, res) => {
    const doc = await loadAccessible(req.user!, String(req.params.id));
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.set("Cache-Control", "no-store");
    res.json({ url: storage.downloadUrl(doc.publicId, doc.format) });
  },
);

router.post(
  "/:id/recheck",
  authenticate,
  requireRole("advisor", "brokerage_admin", "client"),
  async (req, res) => {
    const doc = await loadAccessible(req.user!, String(req.params.id));
    if (!doc) return res.status(404).json({ error: "Not found" });

    // Atomic: only a failed document can be re-queued, and only once.
    const updated = await ClientDocument.findOneAndUpdate(
      { _id: doc._id, status: "failed" },
      {
        $set: { status: "pending" },
        $unset: { failureReason: 1 },
        $inc: { version: 1 },
      },
      { new: true },
    );
    if (!updated)
      return res
        .status(409)
        .json({ error: "Only failed checks can be retried" });

    const brokerageId = updated.brokerageId.toString();
    const clientId = updated.clientId.toString();
    const payload = publicDocument(updated);
    emitDocumentChanged(brokerageId, clientId, payload);
    enqueueCheck({ id: updated.id, brokerageId, clientId });
    res.json({ document: payload });
  },
);

export default router;
