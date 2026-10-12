import validatePlan from './generated/organization-plan.validator.js';
import type { OrganizationPlan } from './generated/organization-plan';

export type { OrganizationPlan, OrganizationPhase, OrganizationFolder, OrganizationAssignment, OrganizationScopeItem, OrganizationRange } from './generated/organization-plan';

export function parseOrganizationPlan(value: unknown): OrganizationPlan {
  if (!validatePlan(value)) throw new Error('INVALID_ORGANIZATION_PLAN');
  return value;
}
