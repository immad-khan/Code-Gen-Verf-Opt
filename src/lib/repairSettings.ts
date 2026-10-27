// Client-side validation of the Repair stage settings (25.8, 25.9).
//
// Mirrors the backend's accepted ranges (22.1–22.4): the six web Repair_Mode
// values (case-sensitive), an integer k from 1 to 3, and a temperature from
// 0.0 to 1.0. The backend still validates; this only keeps an invalid repair
// from starting and names the invalid control inline.

import type { RepairMode } from '../api/types';

export const REPAIR_MODES: readonly RepairMode[] = [
  'dou',
  'dou_no_bt',
  'generic',
  'evidence_only',
  'taxonomy_only',
  'full',
] as const;

export const K_MIN = 1;
export const K_MAX = 3;
export const TEMPERATURE_MIN = 0.0;
export const TEMPERATURE_MAX = 1.0;

/** Raw control values as held in UI state (inputs keep their text). */
export interface RepairSettings {
  mode: RepairMode;
  k: string;
  temperature: string;
}

export const DEFAULT_REPAIR_SETTINGS: Readonly<RepairSettings> = Object.freeze({
  mode: 'dou',
  k: '2',
  temperature: '0.1',
});

/** Validator input: any mode string and any k/temperature text or number. */
export interface RepairSettingsInput {
  mode: string;
  k: string | number;
  temperature: string | number;
}

export type RepairSettingsField = 'mode' | 'k' | 'temperature';

export interface RepairSettingsError {
  field: RepairSettingsField;
  /** Inline message; always names the invalid control. */
  message: string;
}

export interface ValidRepairSettings {
  repairMode: RepairMode;
  k: number;
  temperature: number;
}

export type RepairSettingsValidation =
  | { ok: true; value: ValidRepairSettings }
  | { ok: false; errors: RepairSettingsError[] };

/** Human-readable control names used in validation messages. */
export const CONTROL_LABELS: Record<RepairSettingsField, string> = {
  mode: 'Repair mode',
  k: 'Iterations (k)',
  temperature: 'Temperature',
};

// Plain decimal notation only (no hex, no "Infinity", no empty string).
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseDecimal(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRepairMode(value: string): value is RepairMode {
  return (REPAIR_MODES as readonly string[]).includes(value);
}

/**
 * Accepts iff mode is one of the six backend modes, k is an integer in 1–3,
 * and temperature is a number in 0.0–1.0. Every rejection names its control.
 */
export function validateRepairSettings(input: RepairSettingsInput): RepairSettingsValidation {
  const errors: RepairSettingsError[] = [];

  const mode = input.mode;
  if (!isRepairMode(mode)) {
    errors.push({
      field: 'mode',
      message: `${CONTROL_LABELS.mode} must be one of: ${REPAIR_MODES.join(', ')}.`,
    });
  }

  const k = parseDecimal(input.k);
  if (k === null || !Number.isInteger(k) || k < K_MIN || k > K_MAX) {
    errors.push({
      field: 'k',
      message: `${CONTROL_LABELS.k} must be a whole number from ${K_MIN} to ${K_MAX}.`,
    });
  }

  const temperature = parseDecimal(input.temperature);
  if (temperature === null || temperature < TEMPERATURE_MIN || temperature > TEMPERATURE_MAX) {
    errors.push({
      field: 'temperature',
      message: `${CONTROL_LABELS.temperature} must be a number from 0.0 to 1.0.`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { repairMode: mode as RepairMode, k: k as number, temperature: temperature as number },
  };
}
