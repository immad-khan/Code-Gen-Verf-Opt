// Property 40: Client repair settings validation.
// **Validates: Requirements 25.8, 25.9**
//
// Each control's generator yields an input tagged with whether it is valid, so
// the oracle never re-implements the parser: accepted iff all three are valid,
// and a rejection lists exactly the invalid controls, each message naming its
// control.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_LABELS,
  REPAIR_MODES,
  validateRepairSettings,
  type RepairSettingsField,
} from './repairSettings';

const NUM_RUNS = 300;

interface Tagged<T> {
  input: T;
  valid: boolean;
  /** Expected parsed value when valid. */
  value?: number | string;
}

const asNumberOrText = (n: number): fc.Arbitrary<number | string> => fc.constantFrom<number | string>(n, String(n));

/** The number a valid input denotes (String(-0) is "0", so parse text inputs). */
const denoted = (input: number | string): number => (typeof input === 'string' ? Number(input) : input);

/** Strings that are clearly not numbers (non-empty after trimming and NaN under Number()). */
const nonNumericText = fc.oneof(
  fc.string({ maxLength: 8 }).filter((s) => s.trim() !== '' && Number.isNaN(Number(s))),
  fc.constantFrom('', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '1,5', '2 3'),
);

const modeArb: fc.Arbitrary<Tagged<string>> = fc.oneof(
  fc.constantFrom(...REPAIR_MODES).map((m) => ({ input: m, valid: true, value: m })),
  fc
    .oneof(
      fc.string({ maxLength: 16 }),
      fc.constantFrom(...REPAIR_MODES).map((m) => m.toUpperCase()),
      fc.constantFrom(...REPAIR_MODES).map((m) => ` ${m}`),
      fc.constantFrom('intervenor', 'dou_intervenor', ''),
    )
    .filter((m) => !(REPAIR_MODES as readonly string[]).includes(m))
    .map((m) => ({ input: m, valid: false })),
);

const kArb: fc.Arbitrary<Tagged<number | string>> = fc.oneof(
  fc
    .integer({ min: 1, max: 3 })
    .chain((n) => asNumberOrText(n).map((input) => ({ input, valid: true, value: denoted(input) }))),
  fc
    .oneof(
      fc.integer({ min: -1000, max: 1000 }).filter((n) => n < 1 || n > 3),
      fc.double({ min: -10, max: 10, noNaN: true }).filter((n) => !Number.isInteger(n)),
    )
    .chain((n) => asNumberOrText(n).map((input) => ({ input, valid: false }))),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY).map((input) => ({ input, valid: false })),
  nonNumericText.map((input) => ({ input, valid: false })),
);

const temperatureArb: fc.Arbitrary<Tagged<number | string>> = fc.oneof(
  fc
    .double({ min: 0, max: 1, noNaN: true })
    .chain((t) => asNumberOrText(t).map((input) => ({ input, valid: true, value: denoted(input) }))),
  fc
    .oneof(
      fc.double({ min: -1e6, max: -Number.MIN_VALUE, noNaN: true }),
      fc.double({ min: 1 + Number.EPSILON, max: 1e6, noNaN: true }),
    )
    .chain((t) => asNumberOrText(t).map((input) => ({ input, valid: false }))),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY).map((input) => ({ input, valid: false })),
  nonNumericText.map((input) => ({ input, valid: false })),
);

describe('Property 40: Client repair settings validation', () => {
  it('accepts iff mode, k and temperature are all valid; each rejection names its control', () => {
    fc.assert(
      fc.property(modeArb, kArb, temperatureArb, (mode, k, temperature) => {
        const result = validateRepairSettings({ mode: mode.input, k: k.input, temperature: temperature.input });
        const expectedInvalid: RepairSettingsField[] = [];
        if (!mode.valid) expectedInvalid.push('mode');
        if (!k.valid) expectedInvalid.push('k');
        if (!temperature.valid) expectedInvalid.push('temperature');

        expect(result.ok).toBe(expectedInvalid.length === 0);
        if (result.ok) {
          expect(result.value.repairMode).toBe(mode.value);
          expect(result.value.k).toBe(k.value);
          expect(result.value.temperature).toBe(temperature.value);
        } else {
          expect(result.errors.map((e) => e.field)).toEqual(expectedInvalid);
          for (const error of result.errors) expect(error.message).toContain(CONTROL_LABELS[error.field]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
