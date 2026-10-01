import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  brokerageId: string | null;
  role: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();
