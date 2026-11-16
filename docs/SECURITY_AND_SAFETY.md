# Security and safety

REPAIRVERSE gives instructions for interacting with physical equipment. **Physical safety is treated as a security property:** it is enforced server-side, deterministically, and cannot be lowered by an AI model.

## Repair safety classification

`packages/shared/src/safety.ts` is shared by API and web, and enforced by the API.

| Level | Examples | Consumer experience |
|---|---|---|
| **LOW** | External cleaning, inspection, accessible accessories, descaling | Full step-by-step guide |
| **MEDIUM** | Disassembly, component replacement, connector work | Full guide with safety requirements, stop conditions, warranty warnings |
| **HIGH** | Mains electricity, high-voltage circuits (PSU, inverter, flyback, CRT), microwave HV, damaged/swollen lithium cells, refrigerant, gas, industrial machinery (lockout/tagout, hydraulics, three-phase) | **Steps withheld.** "Stop — this repair needs a qualified professional" with reasons and safe actions |

Rules:

- The effective level is `max(declared risk, hazard-pattern matches, category escalation)`. Classification can only **raise** risk.
- High-risk steps are visible only to **verified** technicians and admins (`canViewProcedureSteps`). Unverified technicians are treated as the public.
- High-risk diagnostic *tests* are never suggested to unverified users. Answering one is rejected with 403.
- AI-generated guides are refused up front for high-risk failures. Generated output is re-classified and **withheld** if it escalates (the AI operation is marked `rejected_by_validation`).
- Safety flags in a user's description (burning smell, smoke, swelling, sparks) trigger a stop notice.
- Every guide carries stop conditions and a "Stop — I need a professional" action.
- The developer API treats every caller as the public: high-risk steps are withheld.

## Trust and truthfulness

- Diagnoses are labelled `hypothesis`, with a residual "cause not in the knowledge network" share. Only a technician's `confirmed_diagnosis` finding confirms anything.
- Specifications require a source or an explicit `is_estimate` flag.
- Compatibility requires evidence. Name or appearance similarity is never used. Unverified "confirmed" claims are downgraded to *potential*, and conflicting attributes downgrade confirmed to *potential*.
- Prices appear only from sourced offers (provider or verified manual entry) with seller and observation date. Repair-vs-replace never estimates prices or lifespans.
- Statistics are withheld below 20 verified cases.
- Citations cannot be fabricated: model citations are filtered to retrieved IDs.
- Technician credentials display as verified only after an admin approves a verification request (audited). Admins cannot verify themselves.
- Demo data is flagged at row level, in the API (`isDemo`) and in the UI (badges and a banner).

## Application security

| Control | Implementation |
|---|---|
| Passwords | argon2id (19 MiB, t=2); dummy verification on unknown emails reduces user enumeration via timing |
| Sessions | 256-bit random tokens; only SHA-256 hashes stored; httpOnly, SameSite=Lax, Secure in production; logout deletes the server session; suspension revokes all sessions |
| CSRF | Cookie-authenticated mutations require `X-Requested-With: repairverse`; CORS is not enabled |
| Authorization | Role guards + org-membership checks on every job/device/file access; integration tests assert cross-user and cross-org isolation |
| Input validation | zod contracts (`packages/shared/src/contracts.ts`) on every mutation; UUID checks; parameterised SQL everywhere |
| Rate limiting | Global per user/IP; stricter on auth, uploads, identification, diagnosis, AI; per-key limits + monthly quotas on the public API |
| API keys | `rvk_<prefix>_<secret>`, shown once, stored as SHA-256; scoped; revocable; usage-logged |
| Files | Magic-byte sniffing with an allowlist; images re-encoded (strips EXIF/GPS); size limits; access checks (owner, org-via-job, staff, public); HMAC-signed expiring URLs; `nosniff`; documents served as attachments |
| Headers | helmet with a strict CSP (`script-src 'self'`), no `x-powered-by` |
| CSV export | Formula-injection neutralisation |
| Audit | `audit_logs` (actor, action, entity, IP), `ai_operations`, `api_usage` |
| Prompt injection | See AI_ARCHITECTURE.md §Prompt-injection defences |
| Secrets | Environment only; production refuses to start without `APP_SECRET`; logs redact auth headers, cookies, API keys and passwords |
| Privacy | Public profiles aggregate only verified outcomes without personal data; contributed outcomes are anonymised (no customer name, contact or serial — asserted in tests) |
| Licensing | Document ingestion requires explicit confirmation of rights; sources record licence and access restrictions; sources can be retracted, which removes them from retrieval |

## Reporting and moderation

Any signed-in user can report inaccurate information (`content_reports`) or submit corrections. Moderators work a queue with approve, reject and request-evidence actions. Contributors cannot moderate their own contributions.

## Known limitations

- Password reset and email verification flows are not implemented (no mail provider configured).
- There is no MFA for admin accounts yet; it is recommended before production.
- Malware scanning of uploads is not implemented. Files are type-restricted and re-encoded (images); add ClamAV or a cloud scanner for documents in production.
