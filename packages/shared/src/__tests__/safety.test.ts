import { describe, expect, it } from 'vitest';
import { canViewProcedureSteps, classifyRepairSafety, canTransitionJob } from '../index.js';

describe('repair safety classifier', () => {
  it('classifies external cleaning as low risk', () => {
    const r = classifyRepairSafety({ text: 'Wipe the external vents with a soft brush' });
    expect(r.level).toBe('low');
    expect(r.professionalOnly).toBe(false);
  });
  it('classifies disassembly as medium risk', () => {
    expect(classifyRepairSafety({ text: 'Remove the bottom cover and disconnect the battery' }).level).toBe('medium');
  });
  it.each([
    'Discharge the capacitor on the power supply board',
    'The battery is swollen and the case is bulging',
    'Replace the magnetron in the microwave',
    'Recharge the refrigerant in the freezer compressor',
    'Inspect the inverter board of the CCFL backlight',
  ])('escalates "%s" to high risk and professional-only', (text) => {
    const r = classifyRepairSafety({ text });
    expect(r.level).toBe('high');
    expect(r.professionalOnly).toBe(true);
  });
  it('never lowers a declared risk', () => {
    expect(classifyRepairSafety({ text: 'clean it', declaredRisk: 'high' }).level).toBe('high');
  });
  it('restricts high-risk steps to verified technicians and admins', () => {
    expect(canViewProcedureSteps('high', { role: 'consumer' })).toBe(false);
    expect(canViewProcedureSteps('high', { role: 'technician', technicianVerified: false })).toBe(false);
    expect(canViewProcedureSteps('high', { role: 'technician', technicianVerified: true })).toBe(true);
    expect(canViewProcedureSteps('medium', null)).toBe(true);
  });
});

describe('job state machine', () => {
  it('allows only defined transitions', () => {
    expect(canTransitionJob('received', 'diagnosing')).toBe(true);
    expect(canTransitionJob('received', 'completed')).toBe(false);
    expect(canTransitionJob('delivered', 'received')).toBe(false);
  });
});
