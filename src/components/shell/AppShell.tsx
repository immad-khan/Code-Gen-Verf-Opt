import React, { useState } from 'react';
import { Header } from '../Header';
import type { HealthStatus } from '../../state/useHealth';
import { OfflineIndicator } from './OfflineIndicator';
import { SectionNav } from './SectionNav';
import { DEFAULT_SECTION, SECTION_LABELS, SECTIONS, type Section } from './sections';

export interface AppShellHealth {
  status: HealthStatus;
  checking?: boolean;
  /** Reason of the latest failed check. */
  error?: { message: string } | null;
  /** Runs a health check immediately. */
  checkNow?: () => void;
}

export interface AppShellProps {
  /** Controlled active section. Omit to let the shell manage it. */
  section?: Section;
  /** Initial section when uncontrolled. */
  defaultSection?: Section;
  onSectionChange?: (section: Section) => void;
  /** Backend health (from `useHealth`), drives the header offline indicator. */
  health: AppShellHealth;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  workbench: React.ReactNode;
  experiments: React.ReactNode;
  /** Rendered after the main area (e.g. dialogs). */
  children?: React.ReactNode;
}

/**
 * Application frame: skip link, global header (brand, section navigation,
 * offline indicator, API settings), and the two sections (25.1).
 *
 * Both sections stay mounted and the inactive one is `hidden`, so switching
 * sections never unmounts the Workbench: its stage, files, statuses, results,
 * and any in-flight polling are retained (25.2). The Workbench reducer itself
 * lives above this component (see `WorkbenchProvider`).
 */
export const AppShell: React.FC<AppShellProps> = ({
  section,
  defaultSection = DEFAULT_SECTION,
  onSectionChange,
  health,
  hasApiKey,
  onOpenSettings,
  workbench,
  experiments,
  children,
}) => {
  const [uncontrolled, setUncontrolled] = useState<Section>(defaultSection);
  const active = section ?? uncontrolled;

  const select = (next: Section) => {
    if (section === undefined) setUncontrolled(next);
    onSectionChange?.(next);
  };

  const content: Record<Section, React.ReactNode> = { workbench, experiments };

  return (
    <div className="app-shell min-h-screen text-[color:var(--color-ink)] font-sans flex flex-col antialiased selection:bg-[#7c6cff] selection:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[color:var(--color-ink)] focus:shadow"
      >
        Skip to main content
      </a>
      <Header
        hasApiKey={hasApiKey}
        onOpenSettings={onOpenSettings}
        nav={<SectionNav active={active} onSelect={select} />}
        status={
          <OfflineIndicator
            status={health.status}
            checking={health.checking}
            reason={health.error?.message ?? null}
            onRetry={health.checkNow}
          />
        }
      />
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col">
        {SECTIONS.map((id) => {
          const isActive = id === active;
          return (
            <section
              key={id}
              id={`section-${id}`}
              aria-labelledby={`section-${id}-title`}
              hidden={!isActive}
              className={isActive ? 'flex-1 flex flex-col' : undefined}
            >
              <h1 id={`section-${id}-title`} className="sr-only">
                {SECTION_LABELS[id]}
              </h1>
              {content[id]}
            </section>
          );
        })}
      </main>
      {children}
    </div>
  );
};
