import { describe, expect, it } from 'vitest';
import { DEFAULT_REPAIR_SETTINGS, REPAIR_MODES, validateRepairSettings } from './repairSettings';

describe('validateRepairSettings', () => {
  it('accepts the defaults dou / 2 / 0.1', () => {
    expect(validateRepairSettings(DEFAULT_REPAIR_SETTINGS)).toEqual({
      ok: true,
      value: { repairMode: 'dou', k: 2, temperature: 0.1 },
    });
  });

  it('accepts every backend mode and the range bounds', () => {
    for (const mode of REPAIR_MODES) {
      expect(validateRepairSettings({ mode, k: '1', temperature: '0' }).ok).toBe(true);
      expect(validateRepairSettings({ mode, k: 3, temperature: 1.0 }).ok).toBe(true);
    }
    expect(validateRepairSettings({ mode: 'full', k: ' 2 ', temperature: '1.0' }).ok).toBe(true);
  });

  it.each([
    ['intervenor'],
    ['dou_intervenor'],
    ['DOU'],
    [''],
  ])('rejects mode %j and names the Repair mode control', (mode) => {
    const result = validateRepairSettings({ mode, k: '2', temperature: '0.1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('mode');
      expect(result.errors[0].message).toContain('Repair mode');
    }
  });

  it.each([['0'], ['4'], ['2.5'], [''], ['abc'], ['0x2'], ['-1']])(
    'rejects k %j and names the k control',
    (k) => {
      const result = validateRepairSettings({ mode: 'dou', k, temperature: '0.1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => e.field)).toEqual(['k']);
        expect(result.errors[0].message).toContain('(k)');
      }
    },
  );

  it.each([['-0.1'], ['1.01'], ['2'], [''], ['warm'], ['Infinity']])(
    'rejects temperature %j and names the Temperature control',
    (temperature) => {
      const result = validateRepairSettings({ mode: 'dou', k: '2', temperature });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => e.field)).toEqual(['temperature']);
        expect(result.errors[0].message).toContain('Temperature');
      }
    },
  );

  it('reports every invalid control at once', () => {
    const result = validateRepairSettings({ mode: 'x', k: '9', temperature: '5' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['mode', 'k', 'temperature']);
  });
});
