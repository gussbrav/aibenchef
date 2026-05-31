export type {
  RequestContext,
  Tenant,
  TenantInput,
  TenantMembership,
  TenantPlan,
  TenantRole,
  TenantService,
  TenantStatus,
} from "./types";

import { PostgresTenantService } from "./postgres-tenant-service";
import type { TenantService } from "./types";

export { PostgresTenantService } from "./postgres-tenant-service";
export { withRequestContext, executeWithContext } from "./request-context";

let _instance: TenantService | null = null;

export function getTenantService(): TenantService {
  if (_instance === null) _instance = new PostgresTenantService();
  return _instance;
}

export function setTenantService(impl: TenantService | null): void {
  _instance = impl;
}
