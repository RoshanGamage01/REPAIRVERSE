/**
 * Core domain vocabulary shared by the API and the web client.
 * These enums are mirrored by PostgreSQL CHECK constraints in the migrations.
 */

export const USER_ROLES = ['consumer', 'technician', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORG_ROLES = ['owner', 'manager', 'technician', 'staff'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Repair safety classification (see SECURITY_AND_SAFETY.md). */
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Provenance of a knowledge item. Ordered from most to least authoritative.
 * `demo` marks demonstration data that must never be presented as verified.
 */
export const PROVENANCE_TYPES = [
  'manufacturer_documentation',
  'expert_reviewed',
  'verified_repair_record',
  'community_contribution',
  'ai_generated',
  'demo',
] as const;
export type Provenance = (typeof PROVENANCE_TYPES)[number];

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  manufacturer_documentation: 'Manufacturer documentation',
  expert_reviewed: 'Expert-reviewed knowledge',
  verified_repair_record: 'Verified repair records',
  community_contribution: 'Community contribution',
  ai_generated: 'AI-generated guidance',
  demo: 'Demonstration data (unverified)',
};

export const VERIFICATION_STATUSES = ['unverified', 'pending_review', 'verified', 'rejected', 'demo'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const COMPATIBILITY_STATES = ['confirmed', 'potential', 'incompatible'] as const;
export type CompatibilityState = (typeof COMPATIBILITY_STATES)[number];

export const PART_CLASSIFICATIONS = ['oem', 'genuine_refurbished', 'aftermarket', 'salvaged', 'unknown'] as const;
export type PartClassification = (typeof PART_CLASSIFICATIONS)[number];

export const SOURCE_KINDS = [
  'manufacturer_manual',
  'technical_documentation',
  'repair_guide',
  'component_specification',
  'expert_submission',
  'repair_report',
  'public_dataset',
  'demo',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Source reliability tiers: 5 = manufacturer primary docs ... 1 = anonymous/unvetted. */
export const SOURCE_RELIABILITY: Record<SourceKind, number> = {
  manufacturer_manual: 5,
  component_specification: 5,
  technical_documentation: 4,
  expert_submission: 3,
  repair_report: 3,
  repair_guide: 3,
  public_dataset: 2,
  demo: 0,
};

export const JOB_STATUSES = [
  'received',
  'inspecting',
  'diagnosing',
  'waiting_for_approval',
  'waiting_for_parts',
  'in_repair',
  'testing',
  'completed',
  'delivered',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  received: 'Received',
  inspecting: 'Inspecting',
  diagnosing: 'Diagnosing',
  waiting_for_approval: 'Waiting for approval',
  waiting_for_parts: 'Waiting for parts',
  in_repair: 'In repair',
  testing: 'Testing',
  completed: 'Completed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Allowed repair-job status transitions. Deterministic workflow, never LLM-driven. */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  received: ['inspecting', 'diagnosing', 'cancelled'],
  inspecting: ['diagnosing', 'cancelled'],
  diagnosing: ['waiting_for_approval', 'waiting_for_parts', 'in_repair', 'cancelled'],
  waiting_for_approval: ['waiting_for_parts', 'in_repair', 'diagnosing', 'cancelled'],
  waiting_for_parts: ['in_repair', 'cancelled'],
  in_repair: ['testing', 'waiting_for_parts', 'diagnosing', 'cancelled'],
  testing: ['completed', 'in_repair', 'diagnosing'],
  completed: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export const CONTRIBUTION_TYPES = [
  'repair_outcome',
  'failure_report',
  'repair_procedure',
  'compatibility',
  'correction',
  'new_product',
  'observation',
  'inaccuracy_report',
] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export const CONTRIBUTION_STATUSES = ['pending', 'needs_evidence', 'approved', 'rejected'] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const REPAIR_RECOMMENDATIONS = [
  'repair_recommended',
  'professional_repair_recommended',
  'more_diagnosis_required',
  'replacement_may_be_more_economical',
] as const;
export type RepairRecommendation = (typeof REPAIR_RECOMMENDATIONS)[number];

export const REPAIR_RECOMMENDATION_LABELS: Record<RepairRecommendation, string> = {
  repair_recommended: 'Repair recommended',
  professional_repair_recommended: 'Professional repair recommended',
  more_diagnosis_required: 'More diagnosis required',
  replacement_may_be_more_economical: 'Replacement may be more economical',
};

export const DEVICE_EVENT_KINDS = [
  'registered',
  'diagnosis',
  'repair_attempt',
  'repair_completed',
  'component_replaced',
  'maintenance',
  'warranty',
  'receipt',
  'note',
] as const;
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number];

export const AI_CAPABILITIES = ['multimodal', 'reasoning', 'embedding', 'transcription'] as const;
export type AICapability = (typeof AI_CAPABILITIES)[number];

export const API_SCOPES = [
  'products:read',
  'knowledge:read',
  'diagnosis:write',
  'compatibility:read',
  'outcomes:write',
  'identify:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Confidence bands used everywhere confidence is displayed. Never "confirmed" from a hypothesis. */
export function confidenceBand(p: number): 'very_low' | 'low' | 'moderate' | 'high' {
  if (p >= 0.75) return 'high';
  if (p >= 0.45) return 'moderate';
  if (p >= 0.2) return 'low';
  return 'very_low';
}
