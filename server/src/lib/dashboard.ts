import { Lead, STAGES, type Stage } from "../models/Lead.js";
import { getCache } from "./cache.js";

export interface PipelineSummary {
  counts: Record<Stage, number>;
  total: number;
  generatedAt: string;
}

// Safety net only: normal freshness comes from invalidation. A missed invalidation can be stale for at most this long.
const TTL_SECONDS = 300;

const epochKey = (brokerageId: string) => `dash:epoch:${brokerageId}`;
const dataKey = (brokerageId: string, epoch: string) =>
  `dash:pipeline:${brokerageId}:${epoch}`;

// Runs inside the caller's tenant context, so tenantPlugin scopes this aggregate to one brokerage.
async function computePipelineSummary(): Promise<PipelineSummary> {
  const rows = await Lead.aggregate<{ _id: Stage; count: number }>([
    { $group: { _id: "$stage", count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    Stage,
    number
  >;
  for (const row of rows) if (row._id in counts) counts[row._id] = row.count;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { counts, total, generatedAt: new Date().toISOString() };
}

/**
 * Cache-aside with an epoch in the key. Invalidation bumps the epoch, it does not delete anything, so a
 * request that read the database just BEFORE a change and writes its (old) result just AFTER it writes to
 * a key that nobody will read again. A plain delete cannot guarantee that.
 */
export async function getPipelineSummary(
  brokerageId: string,
): Promise<{ summary: PipelineSummary; hit: boolean }> {
  const cache = getCache();
  let epoch = "0";
  let cacheUsable = false;

  if (cache) {
    try {
      epoch = (await cache.get(epochKey(brokerageId))) ?? "0";
      const cached = await cache.get(dataKey(brokerageId, epoch));
      cacheUsable = true;
      if (cached)
        return { summary: JSON.parse(cached) as PipelineSummary, hit: true };
    } catch (err) {
      // Redis trouble or a corrupt entry: treat as a miss. If the READ failed we also skip the write below,
      // because without a known epoch we could store the result under the wrong key.
      console.error(
        "dashboard cache read failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const summary = await computePipelineSummary();

  if (cache && cacheUsable) {
    try {
      await cache.set(
        dataKey(brokerageId, epoch),
        JSON.stringify(summary),
        TTL_SECONDS,
      );
    } catch (err) {
      console.error(
        "dashboard cache write failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { summary, hit: false };
}

/** Never throws: a failed invalidation must not fail the lead change that triggered it (the TTL bounds the damage). */
export async function invalidateDashboard(brokerageId: string) {
  const cache = getCache();
  if (!cache) return;
  try {
    await cache.incr(epochKey(brokerageId));
  } catch (err) {
    console.error(
      "dashboard invalidation failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
