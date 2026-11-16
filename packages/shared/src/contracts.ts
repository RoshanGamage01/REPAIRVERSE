import { z } from 'zod';
import {
  COMPATIBILITY_STATES,
  CONTRIBUTION_TYPES,
  DEVICE_EVENT_KINDS,
  JOB_STATUSES,
  PART_CLASSIFICATIONS,
  PROVENANCE_TYPES,
  RISK_LEVELS,
  SOURCE_KINDS,
  API_SCOPES,
} from './domain.js';

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(100_000_000); // cents

export const RegisterInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80),
  accountType: z.enum(['consumer', 'technician']).default('consumer'),
  businessName: z.string().max(120).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const IdentifyInput = z.object({
  text: z.string().max(500).optional(),
  modelNumber: z.string().max(120).optional(),
  barcode: z.string().max(64).optional(),
  fileIds: z.array(uuid).max(8).default([]),
});
export type IdentifyInput = z.infer<typeof IdentifyInput>;

export const ConfirmIdentificationInput = z.object({
  productId: uuid,
  variantId: uuid.nullable().optional(),
  note: z.string().max(500).optional(),
});

export const StartDiagnosisInput = z.object({
  productId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  deviceId: uuid.nullable().optional(),
  jobId: uuid.nullable().optional(),
  description: z.string().min(3).max(4000),
  symptomIds: z.array(uuid).max(20).default([]),
  fileIds: z.array(uuid).max(8).default([]),
});
export type StartDiagnosisInput = z.infer<typeof StartDiagnosisInput>;

export const AnswerProbeInput = z.object({
  probeId: uuid,
  answer: z.string().min(1).max(64),
  note: z.string().max(1000).optional(),
});

export const AddSymptomsInput = z.object({
  symptomIds: z.array(uuid).max(20).default([]),
  text: z.string().max(2000).optional(),
});

export const RepairDecisionInput = z.object({
  diagnosisId: uuid.nullable().optional(),
  productId: uuid.nullable().optional(),
  deviceId: uuid.nullable().optional(),
  failureModeId: uuid.nullable().optional(),
  replacementCostCents: money.nullable().optional(),
  replacementCostSource: z.string().max(300).nullable().optional(),
  laborCostCents: money.nullable().optional(),
  productAgeYears: z.number().min(0).max(80).nullable().optional(),
  underWarranty: z.boolean().nullable().optional(),
  currency: z.string().length(3).default('USD'),
});
export type RepairDecisionInput = z.infer<typeof RepairDecisionInput>;

export const DeviceInput = z.object({
  productId: uuid.nullable().optional(),
  variantId: uuid.nullable().optional(),
  nickname: z.string().min(1).max(80),
  serialNumber: z.string().max(120).nullable().optional(),
  purchaseDate: z.string().date().nullable().optional(),
  warrantyExpires: z.string().date().nullable().optional(),
  purchasePriceCents: money.nullable().optional(),
  currency: z.string().length(3).default('USD'),
  notes: z.string().max(2000).nullable().optional(),
});

export const DeviceEventInput = z.object({
  kind: z.enum(DEVICE_EVENT_KINDS),
  title: z.string().min(1).max(200),
  details: z.string().max(4000).optional(),
  costCents: money.nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  fileId: uuid.nullable().optional(),
  diagnosisId: uuid.nullable().optional(),
  componentTypeId: uuid.nullable().optional(),
});

export const ReminderInput = z.object({ title: z.string().min(1).max(200), dueAt: z.string().datetime() });

export const CreateJobInput = z.object({
  customerName: z.string().min(1).max(120),
  customerContact: z.string().max(200).optional(),
  complaint: z.string().min(3).max(4000),
  intakeCondition: z.string().max(4000).optional(),
  device: z.object({
    productId: uuid.nullable().optional(),
    nickname: z.string().min(1).max(120),
    serialNumber: z.string().max(120).nullable().optional(),
  }),
});

export const JobStatusInput = z.object({ status: z.enum(JOB_STATUSES), note: z.string().max(1000).optional() });

export const JobFindingInput = z.object({
  kind: z.enum(['technician_finding', 'confirmed_diagnosis']),
  failureModeId: uuid.nullable().optional(),
  text: z.string().min(1).max(4000),
});

export const QuoteItemInput = z.object({
  kind: z.enum(['part', 'labor', 'other']),
  description: z.string().min(1).max(300),
  partId: uuid.nullable().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  unitPriceCents: money,
});

export const WorkLogInput = z.object({ text: z.string().min(1).max(4000), minutes: z.number().int().min(0).max(10000).default(0) });

export const ReplacedComponentInput = z.object({
  componentTypeId: uuid,
  partId: uuid.nullable().optional(),
  oldPartNumber: z.string().max(120).nullable().optional(),
  newPartNumber: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export const JobTestInput = z.object({ name: z.string().min(1).max(200), result: z.enum(['pass', 'fail']), notes: z.string().max(2000).optional() });

export const CloseJobInput = z.object({
  succeeded: z.boolean(),
  actualFailureModeId: uuid.nullable().optional(),
  actualFailureText: z.string().max(2000).optional(),
  procedureId: uuid.nullable().optional(),
  contributeToKnowledge: z.boolean().default(true),
});

export const ContributionInput = z.object({
  type: z.enum(CONTRIBUTION_TYPES),
  title: z.string().min(3).max(200),
  targetEntityType: z.string().max(40).nullable().optional(),
  targetEntityId: uuid.nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  evidence: z
    .array(z.object({ kind: z.enum(['url', 'file', 'text']), value: z.string().min(1).max(2000), label: z.string().max(200).optional() }))
    .max(20)
    .default([]),
});
export type ContributionInput = z.infer<typeof ContributionInput>;

export const ReviewContributionInput = z.object({
  decision: z.enum(['approve', 'reject', 'request_evidence']),
  notes: z.string().max(4000).optional(),
  editedPayload: z.record(z.unknown()).optional(),
});

export const ProductInput = z.object({
  categoryId: uuid,
  brandId: uuid.nullable().optional(),
  name: z.string().min(1).max(200),
  modelNumber: z.string().max(120).nullable().optional(),
  releaseYear: z.number().int().min(1900).max(2100).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  isPublic: z.boolean().default(false),
  identifiers: z.array(z.object({ kind: z.enum(['gtin', 'upc', 'ean', 'mpn', 'model_number']), value: z.string().min(1).max(64) })).max(20).default([]),
});

export const ProductSpecInput = z.object({
  key: z.string().min(1).max(80),
  value: z.string().min(1).max(300),
  unit: z.string().max(20).nullable().optional(),
  sourceId: uuid.nullable().optional(),
  isEstimate: z.boolean().default(false),
});

export const ProductComponentInput = z.object({
  componentTypeId: uuid,
  parentId: uuid.nullable().optional(),
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  attributes: z.record(z.string()).default({}),
  sourceId: uuid.nullable().optional(),
});

export const FailureModeInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(''),
  componentTypeId: uuid,
  productId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  riskLevel: z.enum(RISK_LEVELS).default('medium'),
  priorWeight: z.number().min(0.01).max(100).default(1),
  symptoms: z.array(z.object({ symptomId: uuid, likelihood: z.number().min(0.01).max(0.99) })).max(30).default([]),
  sourceIds: z.array(uuid).max(20).default([]),
});

export const ProcedureInput = z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(2000),
  failureModeId: uuid,
  productId: uuid.nullable().optional(),
  difficulty: z.number().int().min(1).max(5),
  estimatedMinutesMin: z.number().int().min(1).max(10000).nullable().optional(),
  estimatedMinutesMax: z.number().int().min(1).max(10000).nullable().optional(),
  riskLevel: z.enum(RISK_LEVELS),
  provenance: z.enum(PROVENANCE_TYPES),
  preparation: z.array(z.string().max(1000)).max(30).default([]),
  safetyNotes: z.array(z.string().max(1000)).max(30).default([]),
  verification: z.array(z.string().max(1000)).max(30).default([]),
  reassembly: z.array(z.string().max(1000)).max(30).default([]),
  toolIds: z.array(uuid).max(30).default([]),
  componentTypeIds: z.array(uuid).max(30).default([]),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(4000),
        expectedObservation: z.string().max(1000).nullable().optional(),
        caution: z.string().max(1000).nullable().optional(),
        provenance: z.enum(PROVENANCE_TYPES),
        sourceId: uuid.nullable().optional(),
      }),
    )
    .min(1)
    .max(60),
  sourceIds: z.array(uuid).max(20).default([]),
});

export const SourceInput = z.object({
  kind: z.enum(SOURCE_KINDS),
  title: z.string().min(1).max(300),
  url: z.string().url().max(2000).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  publishedAt: z.string().date().nullable().optional(),
  license: z.string().max(200).nullable().optional(),
  accessRestrictions: z.string().max(500).nullable().optional(),
  fileId: uuid.nullable().optional(),
});

export const CitationInput = z.object({
  entityType: z.enum(['product', 'product_spec', 'product_component', 'failure_mode', 'repair_procedure', 'procedure_step', 'part_compatibility', 'failure_mode_symptom']),
  entityId: uuid,
  sourceId: uuid,
  locator: z.string().max(200).nullable().optional(),
  excerpt: z.string().max(2000).nullable().optional(),
});

export const PartInput = z.object({
  name: z.string().min(1).max(200),
  partNumber: z.string().max(120).nullable().optional(),
  manufacturerId: uuid.nullable().optional(),
  componentTypeId: uuid,
  classification: z.enum(PART_CLASSIFICATIONS),
  attributes: z.record(z.string()).default({}),
  description: z.string().max(2000).nullable().optional(),
});

export const CompatibilityInput = z.object({
  partId: uuid,
  productId: uuid,
  variantId: uuid.nullable().optional(),
  state: z.enum(COMPATIBILITY_STATES),
  notes: z.string().max(2000).nullable().optional(),
  evidence: z
    .array(z.object({ kind: z.enum(['manufacturer_documentation', 'verified_repair', 'technician_report', 'attribute_match', 'community']), description: z.string().min(1).max(2000), sourceId: uuid.nullable().optional() }))
    .min(1)
    .max(20),
});

export const PartOfferInput = z.object({
  partId: uuid,
  seller: z.string().min(1).max(200),
  url: z.string().url().max(2000).nullable().optional(),
  priceCents: money.nullable().optional(),
  currency: z.string().length(3).default('USD'),
  availability: z.enum(['in_stock', 'limited', 'out_of_stock', 'unknown']).default('unknown'),
});

export const ApiClientInput = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  rateLimitPerMinute: z.number().int().min(1).max(10000).default(60),
  monthlyQuota: z.number().int().min(1).max(100_000_000).default(10000),
});

export const TechnicianProfileInput = z.object({
  headline: z.string().max(200).nullable().optional(),
  bio: z.string().max(4000).nullable().optional(),
  specialties: z.array(z.string().max(80)).max(30).default([]),
  categoryIds: z.array(uuid).max(20).default([]),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  serviceArea: z.string().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  businessName: z.string().max(200).nullable().optional(),
  businessPhone: z.string().max(60).nullable().optional(),
  businessWebsite: z.string().url().max(500).nullable().optional().or(z.literal('')),
});

export const AIModelConfigInput = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(120),
  inputCostPerMTok: z.number().min(0).max(10000),
  outputCostPerMTok: z.number().min(0).max(10000),
  enabled: z.boolean(),
});
