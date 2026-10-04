import { invalidateDashboard } from "./dashboard.js";
import { emitLeadChanged } from "./socket.js";

/**
 * The single place a lead change is announced (webhook, stage move, conversion).
 * Order matters: the cached counts are invalidated BEFORE clients are told, otherwise a dashboard that
 * refetches on the event could read the stale cache.
 */
export async function publishLeadChange(brokerageId: string, lead: object) {
  await invalidateDashboard(brokerageId);
  emitLeadChanged(brokerageId, lead);
}
