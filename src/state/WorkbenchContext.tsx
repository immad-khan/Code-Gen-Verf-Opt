// Holds the Workbench reducer above the Workbench / Experiments section switch
// so switching sections keeps the stage, files, statuses, and results (25.2).

import React, { createContext, useContext, useMemo, useReducer } from 'react';
import {
  createInitialState,
  workbenchReducer,
  type WorkbenchAction,
  type WorkbenchState,
} from './workbench';

export interface WorkbenchContextValue {
  state: WorkbenchState;
  dispatch: React.Dispatch<WorkbenchAction>;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

interface WorkbenchProviderProps {
  children: React.ReactNode;
  /** Initial files/prompt/settings; read once on mount. */
  initial?: Parameters<typeof createInitialState>[0];
}

export const WorkbenchProvider: React.FC<WorkbenchProviderProps> = ({ children, initial }) => {
  const [state, dispatch] = useReducer(workbenchReducer, initial, createInitialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
};

export function useWorkbench(): WorkbenchContextValue {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('useWorkbench must be used inside <WorkbenchProvider>.');
  return value;
}
