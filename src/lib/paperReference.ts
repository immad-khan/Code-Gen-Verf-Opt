// Paper_Reference_Values: Dou et al., Table 6 ("Comparison of methods for
// repairing code bugs"), GPT-4 repair success rates in percent after
// iteration 1 and iteration 2, as printed in the paper. They are reference
// values only and are never mixed with this tool's measured runs.

/** Row label used wherever the values are shown (27.6). */
export const PAPER_REFERENCE_SOURCE = 'Reported by Dou et al. (GPT-4)';

export interface PaperReferenceValue {
  /** Method name as printed in Table 6. */
  method: string;
  /** Closest TIVR repair mode, when there is one. */
  repairMode: string | null;
  /** Repair success rate after iteration 1, in percent. */
  rsr1: number;
  /** Repair success rate after iteration 2, in percent. */
  rsr2: number;
}

export const PAPER_REFERENCE_VALUES: ReadonlyArray<PaperReferenceValue> = [
  { method: 'Self-debug', repairMode: null, rsr1: 23.3, rsr2: 27.5 },
  { method: 'Intervenor', repairMode: 'intervenor', rsr1: 22.5, rsr2: 28.3 },
  { method: 'Ours', repairMode: 'dou', rsr1: 24.1, rsr2: 29.2 },
  { method: 'w/o BT', repairMode: 'dou_no_bt', rsr1: 21.7, rsr2: 27.5 },
  { method: 'Ours + Intervenor', repairMode: 'dou_intervenor', rsr1: 25.8, rsr2: 29.2 },
];
