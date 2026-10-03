import { Router } from "express";
import multer from "multer";
import { Types } from "mongoose";
import { Client } from "../models/Client.js";
import { ClientDocument, publicDocument } from "../models/ClientDocument.js";
import { User } from "../models/User.js";
import { authenticate, bindTenant, requireRole } from "../middleware/auth.js";
import { storage } from "../lib/cloudinary.js";
import { enqueueCheck } from "../lib/documentChecks.js";
import { MAX_UPLOAD_BYTES, sniffFileType } from "../lib/fileType.js";
import { emitDocumentChanged } from "../lib/socket.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

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

router.get(
  "/documents",
  authenticate,
  requireRole("client"),
  async (req, res) => {
    const client = await Client.findOne({ userId: req.user!.id });
    if (!client) return res.status(404).json({ error: "No case found" });
    const documents = await ClientDocument.find({ clientId: client._id }).sort({
      createdAt: -1,
    });
    res.json({ documents: documents.map(publicDocument) });
  },
);

// authenticate and the role check run BEFORE multer, so anonymous callers never get a file buffered.
router.post(
  "/documents",
  authenticate,
  requireRole("client"),
  upload.single("file"),
  bindTenant,
  async (req, res) => {
    const client = await Client.findOne({ userId: req.user!.id });
    if (!client) return res.status(404).json({ error: "No case found" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "A file is required" });
    const type = sniffFileType(file.buffer);
    if (!type)
      return res
        .status(415)
        .json({ error: "Only PDF, JPEG and PNG files are accepted" });

    // Browsers send UTF-8 names that multer reads as latin1; undo that, then strip path characters.
    const filename = Buffer.from(file.originalname, "latin1")
      .toString("utf8")
      .replace(/[\\/\0]/g, "_")
      .slice(0, 120);

    const stored = await storage.upload(
      file.buffer,
      `leadflow/${client.brokerageId}/${client.id}`,
    );
    const doc = await ClientDocument.create({
      brokerageId: client.brokerageId,
      clientId: client._id,
      uploadedBy: new Types.ObjectId(req.user!.id),
      filename: filename || "document",
      mimeType: type.mime,
      size: file.size,
      publicId: stored.publicId,
      format: stored.format,
    });

    const payload = publicDocument(doc);
    emitDocumentChanged(client.brokerageId.toString(), client.id, payload);
    enqueueCheck({
      id: doc.id,
      brokerageId: client.brokerageId.toString(),
      clientId: client.id,
    });
    res.status(201).json({ document: payload });
  },
);

export default router;
