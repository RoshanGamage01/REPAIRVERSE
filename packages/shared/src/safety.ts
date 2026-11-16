import type { RiskLevel, UserRole } from './domain.js';

/**
 * Deterministic repair-safety classifier.
 *
 * The classifier is intentionally conservative: any HIGH-risk hazard signal in the
 * procedure/task text, the product category or the component under repair escalates
 * the whole task. LLM output is always passed through this classifier before display;
 * the model can never lower a risk level that these rules raise.
 */

export interface HazardRule {
  id: string;
  level: RiskLevel;
  label: string;
  /** Lowercase regex patterns evaluated against task text. */
  patterns: RegExp[];
  guidance: string;
}

export const HAZARD_RULES: HazardRule[] = [
  {
    id: 'mains_electricity',
    level: 'high',
    label: 'Mains electricity',
    patterns: [/\bmains\b/, /\b(110|120|220|230|240)\s?v(ac)?\b/, /\bac (power )?supply board\b/, /\bpower supply (board|unit)\b/, /\bpsu\b/, /\blive (wire|terminal)s?\b/, /\bwall (outlet|socket)\b.*\b(open|inside|wiring)\b/],
    guidance: 'Internal mains-powered circuits can deliver a lethal shock, and capacitors can stay charged after unplugging.',
  },
  {
    id: 'high_voltage',
    level: 'high',
    label: 'High-voltage circuits',
    patterns: [/\bhigh[- ]voltage\b/, /\bflyback\b/, /\binverter board\b/, /\bccfl\b/, /\bcrt\b/, /\bbulk capacitor\b/, /\bdischarg(e|ing) (the )?capacitor/],
    guidance: 'High-voltage circuits and stored capacitor charge can cause serious injury or death.',
  },
  {
    id: 'microwave_hv',
    level: 'high',
    label: 'Microwave high-voltage circuit',
    patterns: [/\bmagnetron\b/, /\bmicrowave\b.*\b(capacitor|transformer|diode|inside|internal|cover)\b/, /\bhv (capacitor|transformer|diode)\b/],
    guidance: 'Microwave ovens contain a high-voltage capacitor that can hold a lethal charge after unplugging.',
  },
  {
    id: 'damaged_lithium',
    level: 'high',
    label: 'Damaged lithium battery',
    patterns: [/\bswollen\b/, /\bswelling\b/, /\bpuff(y|ed|ing)\b/, /\bbulging\b/, /\bpunctur(e|ed)\b.*\bbatter/, /\bbatter(y|ies)\b.*\b(hot|smok|leak|hiss|venting|punctur)/, /\bthermal runaway\b/],
    guidance: 'Damaged lithium cells can ignite or explode. Do not puncture, bend, charge or pry them.',
  },
  {
    id: 'refrigerant',
    level: 'high',
    label: 'Refrigerant system',
    patterns: [/\brefrigerant\b/, /\bcompressor\b.*\b(fridge|refrigerator|freezer|air con|a\/c|recharge)\b/, /\bsealed system\b/, /\bregas\b/, /\br-?(134a|600a|410a|32)\b/],
    guidance: 'Refrigerant handling is regulated in most countries and requires certified technicians and equipment.',
  },
  {
    id: 'gas',
    level: 'high',
    label: 'Gas appliance',
    patterns: [/\bgas (valve|line|burner|supply|leak)\b/, /\bpropane\b/, /\bnatural gas\b/],
    guidance: 'Gas appliance work typically legally requires a licensed professional.',
  },
  {
    id: 'industrial_machinery',
    level: 'high',
    label: 'Hazardous industrial machinery',
    patterns: [/\block[- ]?out\b/, /\btag[- ]?out\b/, /\bthree[- ]phase\b/, /\bhydraulic\b/, /\bpneumatic\b.*\bpressur/],
    guidance: 'Industrial equipment may store mechanical, hydraulic or electrical energy and requires formal lockout/tagout.',
  },
  {
    id: 'disassembly',
    level: 'medium',
    label: 'Device disassembly',
    patterns: [/\bdisassembl/, /\bremove (the )?(back|bottom|rear) (cover|panel|case)\b/, /\bopen(ing)? the (case|device|chassis)\b/, /\bunscrew\b/, /\bpry\b/, /\bspudger\b/, /\bheat gun\b/, /\bdisconnect (the )?(battery|ribbon|flex|connector)\b/],
    guidance: 'Opening the device risks damage to fragile connectors and may affect warranty.',
  },
  {
    id: 'component_replacement',
    level: 'medium',
    label: 'Component replacement',
    patterns: [/\breplac(e|ing) (the )?(screen|display|battery|motherboard|logic board|keyboard|fan|ram|ssd|port)\b/, /\bsolder/, /\breflow\b/],
    guidance: 'Component replacement requires the correct compatible part and careful handling.',
  },
];

/** Product categories whose internal repairs are inherently high-risk. */
export const HIGH_RISK_CATEGORY_SLUGS = new Set(['microwave-ovens', 'refrigerators', 'crt-displays', 'small-industrial-equipment']);

export interface SafetyAssessment {
  level: RiskLevel;
  hazards: { id: string; label: string; level: RiskLevel; guidance: string }[];
  /** True when the task must not be presented as a consumer walkthrough. */
  professionalOnly: boolean;
  stopConditions: string[];
}

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(...levels: (RiskLevel | null | undefined)[]): RiskLevel {
  let best: RiskLevel = 'low';
  for (const l of levels) if (l && RANK[l] > RANK[best]) best = l;
  return best;
}

export function classifyRepairSafety(input: {
  text: string;
  declaredRisk?: RiskLevel | null;
  categorySlug?: string | null;
}): SafetyAssessment {
  const text = input.text.toLowerCase();
  const hazards: SafetyAssessment['hazards'] = [];
  for (const rule of HAZARD_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      hazards.push({ id: rule.id, label: rule.label, level: rule.level, guidance: rule.guidance });
    }
  }
  let level = maxRisk(input.declaredRisk ?? 'low', ...hazards.map((h) => h.level));
  if (input.categorySlug && HIGH_RISK_CATEGORY_SLUGS.has(input.categorySlug) && /\b(open|inside|internal|disassembl|cover|panel)\b/.test(text)) {
    level = 'high';
    hazards.push({ id: 'category', label: 'High-risk appliance category', level: 'high', guidance: 'Internal repairs on this type of appliance involve hazardous energy.' });
  }
  const stopConditions = [
    'You smell burning, see smoke, or a component is hot to the touch.',
    'A battery is swollen, punctured, leaking or hissing.',
    'You are unsure whether the device is fully disconnected from power.',
    'A step requires a tool, part or skill you do not have.',
    'The device behaves differently from what the guide says you should observe.',
  ];
  return { level, hazards, professionalOnly: level === 'high', stopConditions };
}

/**
 * Who may see step-by-step instructions at a given risk level.
 * High-risk walkthroughs are restricted to verified technicians and administrators.
 */
export function canViewProcedureSteps(risk: RiskLevel, viewer: { role?: UserRole | null; technicianVerified?: boolean } | null): boolean {
  if (risk !== 'high') return true;
  if (!viewer?.role) return false;
  if (viewer.role === 'admin') return true;
  return viewer.role === 'technician' && viewer.technicianVerified === true;
}
