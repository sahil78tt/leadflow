import { Types, type Aggregate, type Query, type Schema } from "mongoose";
import { tenantStorage } from "./tenantContext.js";

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

/**
 * The ONLY opt-out for queries. Use it where no tenant exists yet (login, seed).
 * Every call site should be reviewed: `grep -rn skipTenant src`.
 */
export function skipTenant<
  Q extends { setOptions: (options: never) => unknown },
>(query: Q): Q {
  query.setOptions({ skipTenant: true } as never);
  return query;
}

const isSkipped = (options: unknown) =>
  (options as { skipTenant?: boolean } | null | undefined)?.skipTenant === true;

const QUERY_OPS =
  /^(find|findOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|updateOne|updateMany|replaceOne|deleteOne|deleteMany|countDocuments|distinct)$/;

// Cross-collection stages could read another tenant's data, so they are refused outright.
const CROSS_COLLECTION_STAGES = [
  "$lookup",
  "$unionWith",
  "$graphLookup",
  "$facet",
  "$out",
  "$merge",
];

/**
 * Returns the brokerageId to scope to, or null when the call is exempt (skipTenant / platform admin).
 * Throws when there is no usable tenant context: scoped data is never read unscoped by accident.
 */
function resolveTenant(options: unknown): string | null {
  if (isSkipped(options)) return null;
  const ctx = tenantStorage.getStore();
  if (!ctx)
    throw new TenantError("Tenant-scoped operation ran without tenant context");
  if (ctx.role === "platform_admin") return null;
  if (!ctx.brokerageId)
    throw new TenantError("Authenticated user has no brokerage");
  return ctx.brokerageId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopeQuery(this: Query<any, any>) {
  const brokerageId = resolveTenant(this.getOptions());
  if (brokerageId === null) return;

  // Blunt on purpose: any update that mentions brokerageId is refused, so a record cannot change tenant.
  const update = this.getUpdate();
  if (update != null && JSON.stringify(update).includes("brokerageId")) {
    throw new TenantError("brokerageId cannot be modified");
  }

  // Overwrites any caller-supplied brokerageId; all other filter keys stay ANDed with it.
  this.setQuery({ ...this.getFilter(), brokerageId });
}

// estimatedDocumentCount ignores filters, so it cannot be scoped. Refuse it for tenant users.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockEstimatedCount(this: Query<any, any>) {
  if (resolveTenant(this.getOptions()) !== null) {
    throw new TenantError(
      "estimatedDocumentCount cannot be tenant-scoped; use countDocuments",
    );
  }
}

function scopeAggregate(this: Aggregate<unknown[]>) {
  const brokerageId = resolveTenant(undefined);
  if (brokerageId === null) return;

  const pipeline = this.pipeline();
  const serialized = JSON.stringify(pipeline);
  if (
    CROSS_COLLECTION_STAGES.some((stage) => serialized.includes(`"${stage}"`))
  ) {
    throw new TenantError(
      "Cross-collection aggregation stages are not allowed on tenant data",
    );
  }
  pipeline.unshift({
    $match: { brokerageId: new Types.ObjectId(brokerageId) },
  });
}

export function tenantPlugin(schema: Schema) {
  schema.pre(QUERY_OPS, { query: true, document: false }, scopeQuery);
  schema.pre("estimatedDocumentCount", blockEstimatedCount);
  schema.pre("aggregate", scopeAggregate);

  // New documents: take the caller's tenant, refuse a different one.
  // With no context (webhook, seed) the document must already carry brokerageId (schema `required`).
  schema.pre("validate", function () {
    if (!this.isNew) return;
    const ctx = tenantStorage.getStore();
    if (!ctx || ctx.role === "platform_admin") return;
    if (!ctx.brokerageId)
      throw new TenantError("Authenticated user has no brokerage");

    const current = this.get("brokerageId") as unknown;
    if (current == null) {
      this.set("brokerageId", ctx.brokerageId);
    } else if (String(current) !== ctx.brokerageId) {
      throw new TenantError("Cannot create a document for another brokerage");
    }
  });
}
