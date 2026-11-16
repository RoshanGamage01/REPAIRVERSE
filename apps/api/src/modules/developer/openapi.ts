const json = (schema: object = { type: 'object' }) => ({ content: { 'application/json': { schema } } });
const ok = (description: string) => ({ 200: { description, ...json() } });
const errors = { 401: { description: 'Missing or invalid API key' }, 403: { description: 'Missing scope' }, 429: { description: 'Rate limit or monthly quota exceeded' } };
const idParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'REPAIRVERSE Repair Intelligence API',
    version: '1.0.0',
    description:
      'Access the REPAIRVERSE repair knowledge network: products, component breakdowns, failure patterns, repair procedures, part compatibility and diagnosis.\n\n' +
      'Trust model: every knowledge item carries provenance and verification status. Diagnoses return ranked hypotheses, never confirmed faults. ' +
      'High-risk procedure steps are withheld from API responses. Rows marked is_demo are demonstration data and must not be presented as real.',
  },
  servers: [{ url: '/api/public/v1' }],
  components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
  security: [{ ApiKey: [] }],
  paths: {
    '/identify': { post: { summary: 'Identify a product by barcode or model number', description: 'Scope: identify:write', requestBody: json({ type: 'object', properties: { barcode: { type: 'string' }, modelNumber: { type: 'string' } } }), responses: { ...ok('Candidate products with confidence'), ...errors } } },
    '/products': { get: { summary: 'Search public products', description: 'Scope: products:read', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { ...ok('Products'), ...errors } } },
    '/products/{idOrSlug}': { get: { summary: 'Product intelligence profile', description: 'Scope: products:read', parameters: [idParam('idOrSlug')], responses: { ...ok('Profile with specs, components, failures, procedures, parts and sources'), ...errors } } },
    '/products/{idOrSlug}/components': { get: { summary: 'Component breakdown tree', description: 'Scope: products:read', parameters: [idParam('idOrSlug'), { name: 'variantId', in: 'query', schema: { type: 'string' } }], responses: { ...ok('Component tree and relationships'), ...errors } } },
    '/products/{idOrSlug}/failures': { get: { summary: 'Known failure patterns', description: 'Scope: knowledge:read. Statistics are only returned above the minimum sample size.', parameters: [idParam('idOrSlug')], responses: { ...ok('Failure modes'), ...errors } } },
    '/procedures/{id}': { get: { summary: 'Repair procedure', description: 'Scope: knowledge:read. High-risk steps withheld.', parameters: [idParam('id')], responses: { ...ok('Procedure with provenance and safety classification'), ...errors } } },
    '/knowledge/verified': { get: { summary: 'Verified knowledge feed', description: 'Scope: knowledge:read', parameters: [{ name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { ...ok('Verified failure modes and procedures'), ...errors } } },
    '/compatibility': { get: { summary: 'Check part compatibility', description: 'Scope: compatibility:read. Returns confirmed / potential / incompatible / unknown with evidence.', parameters: ['partId', 'productId', 'variantId'].map((n) => ({ name: n, in: 'query', required: n !== 'variantId', schema: { type: 'string' } })), responses: { ...ok('Compatibility verdict'), ...errors } } },
    '/diagnoses': { post: { summary: 'Start a diagnosis', description: 'Scope: diagnosis:write', requestBody: json({ type: 'object', required: ['description'], properties: { productId: { type: 'string' }, categoryId: { type: 'string' }, description: { type: 'string' }, symptomIds: { type: 'array', items: { type: 'string' } } } }), responses: { 201: { description: 'Diagnosis with hypotheses and next questions' }, ...errors } } },
    '/diagnoses/{id}': { get: { summary: 'Get a diagnosis', description: 'Scope: diagnosis:write', parameters: [idParam('id')], responses: { ...ok('Diagnosis'), ...errors } } },
    '/diagnoses/{id}/answers': { post: { summary: 'Answer a diagnostic question', description: 'Scope: diagnosis:write', parameters: [idParam('id')], requestBody: json({ type: 'object', required: ['probeId', 'answer'], properties: { probeId: { type: 'string' }, answer: { type: 'string' } } }), responses: { ...ok('Updated diagnosis'), ...errors } } },
    '/outcomes': { post: { summary: 'Submit a repair outcome', description: 'Scope: outcomes:write. Enters moderation; never applied directly.', requestBody: json({ type: 'object', required: ['succeeded'], properties: { productId: { type: 'string' }, symptomIds: { type: 'array', items: { type: 'string' } }, actualFailureModeId: { type: 'string' }, actualFailureText: { type: 'string' }, succeeded: { type: 'boolean' }, costCents: { type: 'integer' }, durationMinutes: { type: 'integer' } } }), responses: { 202: { description: 'Accepted for review' }, ...errors } } },
  },
};
