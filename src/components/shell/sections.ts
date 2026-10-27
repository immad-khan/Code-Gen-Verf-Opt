// Top-level sections (25.1): exactly Workbench and Experiments.

export const SECTIONS = ['workbench', 'experiments'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  workbench: 'Workbench',
  experiments: 'Experiments',
};

export const DEFAULT_SECTION: Section = 'workbench';

export function isSection(value: unknown): value is Section {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value);
}
