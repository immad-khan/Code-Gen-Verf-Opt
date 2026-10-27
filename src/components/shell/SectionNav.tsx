import React from 'react';
import { SECTION_LABELS, SECTIONS, type Section } from './sections';

interface SectionNavProps {
  active: Section;
  onSelect: (section: Section) => void;
}

/**
 * Top-level navigation with exactly two sections (25.1). The active section is
 * marked visually (filled pill + underline, not color alone) and with
 * `aria-current="page"`.
 */
export const SectionNav: React.FC<SectionNavProps> = ({ active, onSelect }) => (
  <nav aria-label="Sections">
    <ul className="flex items-center gap-1">
      {SECTIONS.map((section) => {
        const isActive = section === active;
        return (
          <li key={section}>
            <button
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(section)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[color:var(--color-surface-3)] text-[color:var(--color-ink)] border-[color:var(--color-focus-ring)]'
                  : 'text-[color:var(--color-ink-muted)] border-transparent hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-2)]'
              }`}
            >
              {SECTION_LABELS[section]}
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);
