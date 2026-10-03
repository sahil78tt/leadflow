import { ClientDocument, publicDocument } from "../models/ClientDocument.js";
import { emitDocumentChanged } from "./socket.js";
import { tenantStorage } from "./tenantContext.js";
import { skipTenant } from "./tenantPlugin.js";

// Tunable so tests run instantly and deterministically.
export const checkerConfig = {
  minMs: 3000,
  maxMs: 8000,
  failureRate: 0.15,
  random: Math.random,
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface JobRef {
  id: string;
  brokerageId: string;
  clientId: string;
}

async function run(job: JobRef) {
  // The job runs inside its own tenant, so every query below is scoped by tenantPlugin without any opt-out.
  await tenantStorage.run(
    { brokerageId: job.brokerageId, role: "system" },
    async () => {
      // Atomic claim: only one runner can move a document from pending to checking.
      const claimed = await ClientDocument.findOneAndUpdate(
        { _id: job.id, status: "pending" },
        { $set: { status: "checking" }, $inc: { version: 1 } },
        { new: true },
      );
      if (!claimed) return;
      emitDocumentChanged(
        job.brokerageId,
        job.clientId,
        publicDocument(claimed),
      );

      const { minMs, maxMs, random, failureRate } = checkerConfig;
      await sleep(minMs + random() * (maxMs - minMs)); // the "slow" part of the simulated check
      const failed = random() < failureRate; // the "unreliable" part

      const finished = await ClientDocument.findOneAndUpdate(
        { _id: job.id, status: "checking" },
        failed
          ? {
              $set: {
                status: "failed",
                failureReason: "Automated check failed. Please retry.",
                checkedAt: new Date(),
              },
              $inc: { version: 1 },
            }
          : {
              $set: { status: "verified", checkedAt: new Date() },
              $unset: { failureReason: 1 },
              $inc: { version: 1 },
            },
        { new: true },
      );
      if (finished)
        emitDocumentChanged(
          job.brokerageId,
          job.clientId,
          publicDocument(finished),
        );
    },
  );
}

/** Fire and forget: the HTTP response never waits for the check. */
export function enqueueCheck(job: JobRef) {
  void run(job).catch((err) =>
    console.error("document check crashed", job.id, err),
  );
}

/**
 * Call once at process start. No job of ours can be running yet, so anything left "checking"
 * was orphaned by a restart: put it back to "pending" and run everything that is pending.
 * This is the one cross-tenant operation, so it is the one place that opts out of tenant scoping.
 */
export async function recoverStuckChecks() {
  await skipTenant(
    ClientDocument.updateMany(
      { status: "checking" },
      { $set: { status: "pending" }, $inc: { version: 1 } },
    ),
  );
  const pending = await skipTenant(
    ClientDocument.find({ status: "pending" }).select("brokerageId clientId"),
  );
  for (const doc of pending) {
    enqueueCheck({
      id: doc.id,
      brokerageId: doc.brokerageId.toString(),
      clientId: doc.clientId.toString(),
    });
  }
  return pending.length;
}
