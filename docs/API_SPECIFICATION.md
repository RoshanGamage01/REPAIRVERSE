# API specification

Two APIs share one server:

| API | Base | Auth | Audience |
|---|---|---|---|
| Application API | `/api/v1` | Session cookie (`rv_session`) + `X-Requested-With: repairverse` on mutations | REPAIRVERSE web clients |
| **Repair Intelligence API** | `/api/public/v1` | `X-API-Key: rvk_…` | External developers and partners |

Both are versioned by path. Errors are always `{"error": {"code", "message", "details?"}, "requestId"}`. Responses include `X-Request-Id`; rate-limited routes include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and, on 429, `Retry-After`.

## Repair Intelligence API (`/api/public/v1`)

The machine-readable OpenAPI 3.1 document is at `GET /api/public/v1/openapi.json` (no key required). Keys are created at `/developers` in the app (`POST /api/v1/developer/clients`); they are shown once and stored hashed.

| Method & path | Scope | Description |
|---|---|---|
| `POST /identify` `{barcode?, modelNumber?}` | `identify:write` | Exact identifier matches with confidence |
| `GET /products?q=` | `products:read` | Search public products |
| `GET /products/{idOrSlug}` | `products:read` | Product intelligence profile (specs + sources, components, failures, procedures, parts, statistics) |
| `GET /products/{idOrSlug}/components?variantId=` | `products:read` | Component tree + relationships |
| `GET /products/{idOrSlug}/failures` | `knowledge:read` | Failure modes with symptoms; statistics only above the minimum sample |
| `GET /procedures/{id}` | `knowledge:read` | Procedure with provenance and safety; high-risk steps withheld |
| `GET /knowledge/verified?since=` | `knowledge:read` | Feed of verified failure modes and procedures |
| `GET /compatibility?partId&productId&variantId` | `compatibility:read` | `confirmed | potential | incompatible | unknown` + basis, reasons, attribute checks, evidence |
| `POST /diagnoses` `{productId?|categoryId?, description, symptomIds?}` | `diagnosis:write` | Start a diagnosis: hypotheses + next questions |
| `GET /diagnoses/{id}` | `diagnosis:write` | Diagnosis (only those created by this key) |
| `POST /diagnoses/{id}/answers` `{probeId, answer}` | `diagnosis:write` | Answer a question; returns the updated diagnosis |
| `POST /outcomes` `{succeeded, productId?, symptomIds?, actualFailureModeId?, …}` | `outcomes:write` | Submit an outcome; enters moderation (202) |

Limits: per-key requests per minute (default 60) and a monthly quota (default 10,000), adjustable by admins. Every request is logged to `api_usage`.

```bash
curl -H "X-API-Key: $KEY" https://<host>/api/public/v1/products?q=aurora
```

## Application API (`/api/v1`) — summary

| Area | Endpoints |
|---|---|
| Status | `GET /status` (AI capability availability, demo-data flag) |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me`; `GET|PUT /auth/me/technician-profile`; `POST /auth/me/verification-requests`; `GET /auth/technicians?lat&lng&radiusKm` |
| Taxonomy | `GET /categories`, `/component-types`, `/tools`, `/brands`, `/manufacturers`, `/symptoms?categoryId` |
| Products | `GET /products?q&categoryId&all`, `GET /products/:idOrSlug`, `GET /components/:id`, `POST /products`, `POST /products/:id/{specs,variants,components,components/from-template,publish}` |
| Saved | `GET /saved`, `POST /saved` |
| Files | `POST /files` (multipart `files[]`; videos produce keyframes), `GET /files/:id/raw`, `GET /files/:id/url` (signed, 15 min), `GET /files/:id/content?exp&sig`, `GET /files/:id/public` |
| Identification | `POST /identifications`, `GET /identifications/:id`, `POST /identifications/:id/confirm` |
| Diagnosis | `POST /diagnoses`, `GET /diagnoses`, `GET /diagnoses/:id`, `POST /diagnoses/:id/{symptoms,answers,complete,reopen,guide}`, `DELETE /diagnoses/:id/observations/:obsId` |
| Guides & decisions | `GET /procedures/:idOrSlug`, `POST /decisions` |
| Voice | `POST /ai/transcribe` (multipart `audio`) — 503 `not_configured` without a provider |
| Parts | `GET /parts?q&partNumber&componentTypeId&productId`, `GET /parts/:id`, `GET /parts/providers`, `GET /parts/for-product/:productId?variantId&componentTypeId`, `GET /parts/compatibility/check`, `POST /parts`, `POST /parts/compatibility`, `POST /parts/:id/offers`, `POST /parts/:id/refresh-offers` |
| Library | `GET|POST /library/devices`, `GET|PATCH|DELETE /library/devices/:id`, `POST|DELETE /library/devices/:id/events[/:eventId]`, `POST /library/devices/:id/reminders`, `PATCH /library/reminders/:id`, `GET /library/reminders`, `GET /library/history`, `GET /library/devices/:id/export?format=json|csv` |
| Professional | `GET|PATCH /pro/organization`, `POST /pro/organizations`, `POST /pro/organization/members`, `GET /pro/overview`, `GET|POST /pro/jobs`, `GET|PATCH /pro/jobs/:id`, `POST /pro/jobs/:id/{status,attachments,diagnose,findings,quote-items,quote/approve,worklog,replaced-components,tests,close}`, `DELETE /pro/jobs/:id/quote-items/:itemId`, `GET /pro/jobs/:id/{quote,report}`, `POST /pro/copilot` (send `X-Org-Id` to select an organization) |
| Contributions | `POST /contributions`, `GET /contributions/mine`, `POST /contributions/:id/evidence`, `POST /contributions/reports` |
| Moderation | `GET /moderation/contributions?status`, `GET /moderation/contributions/:id`, `POST /moderation/contributions/:id/review`, `GET /moderation/reports`, `POST /moderation/reports/:id` |
| Knowledge | `GET /knowledge/search?q`, `GET /knowledge/failure-modes[/:id]`, `POST /knowledge/failure-modes`, `POST /knowledge/failure-modes/:id/probes`, `PATCH /knowledge/failure-modes/:id`, `POST /knowledge/procedures`, `GET|POST /knowledge/sources`, `PATCH /knowledge/sources/:id`, `POST /knowledge/citations`, `GET|POST /knowledge/documents`, `GET /knowledge/documents/:id`, `POST /knowledge/documents/:id/approve`, `POST /knowledge/extracted/:id/review`, `GET /knowledge/graph/stats` |
| Admin | `GET /admin/{overview,metrics,users,organizations,verification-requests,ai/config,ai/usage,ai/content,system/health,jobs,audit-logs,api-clients}`, `PATCH /admin/users/:id`, `POST /admin/verification-requests/:id/review`, `PUT /admin/ai/config/:capability`, `POST /admin/jobs/:id/retry`, `PATCH /admin/api-clients/:id`, `POST /admin/api-clients/:id/revoke` |
| Developer | `GET|POST /developer/clients`, `POST /developer/clients/:id/revoke`, `GET /developer/clients/:id/usage` |
| Jobs | `GET /jobs/:id/events` — **Server-Sent Events** progress stream for background jobs |

Request bodies are defined as zod schemas in `packages/shared/src/contracts.ts`, the single source of truth for validation.

### Key response shapes

**Diagnosis** (`GET /diagnoses/:id`):
```jsonc
{
  "id": "…", "status": "active", "readiness": "needs_more_information|leading_hypothesis|no_further_questions",
  "hypotheses": [{
    "failureModeId": "…", "name": "Display backlight failure", "status": "hypothesis",
    "probability": 0.63, "confidenceBand": "moderate",
    "supportingEvidence": [{"kind": "answer", "label": "Shine a flashlight… → Yes", "strength": 1.8}],
    "contradictingEvidence": [], "missingInformation": [], "recommendedTests": [], "requiredTools": [],
    "procedures": [], "complexity": 3, "safety": {"level": "medium", "hazards": [], "professionalOnly": false},
    "knowledge": {"verificationStatus": "demo", "isDemo": true, "confidence": 0.2, "verifiedCases": 0, "sources": []}
  }],
  "unknownProbability": 0.04,
  "nextQuestions": [{"probeId": "…", "kind": "test", "prompt": "…", "options": [{"value":"yes","label":"Yes"}, …, {"value":"unsure","label":"Not sure"}], "why": "Helps distinguish between …"}],
  "journey": [ … ], "safetyNotice": null, "disclaimer": "These are ranked hypotheses, not confirmed faults…"
}
```

**Compatibility** (`GET /parts/compatibility/check`):
```jsonc
{ "state": "potential", "basis": "attribute_rules",
  "reasons": ["All recorded attributes match, but no documentation or verified repair confirms this fit."],
  "attributeChecks": [{"attribute": "connector_type", "required": "eDP 30-pin", "offered": "eDP 30-pin", "result": "match"}],
  "evidence": [ … ], "isDemo": true, "part": { … }, "product": { … }, "variant": { … } }
```
