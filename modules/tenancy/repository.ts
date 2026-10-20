import "server-only";

import type { ClinicMembership } from "./types";

/**
 * Data access boundary for tenancy. Implementations must load data for the
 * authenticated user only (RLS-protected queries using that user's session),
 * never for a user id supplied by the client.
 */
export interface TenancyRepository {
  listMemberships(userId: string): Promise<ClinicMembership[]>;
  isPlatformAdmin(userId: string): Promise<boolean>;
}

/**
 * Milestone 0 implementation: deny by default. Tenancy tables arrive in
 * Milestone 1 (docs/MILESTONE_PLAN.md). Until then, authenticated users have no
 * clinic workspace and no platform-admin access.
 */
export const denyAllTenancyRepository: TenancyRepository = {
  async listMemberships() {
    return [];
  },
  async isPlatformAdmin() {
    return false;
  },
};

export function getTenancyRepository(): TenancyRepository {
  return denyAllTenancyRepository;
}
