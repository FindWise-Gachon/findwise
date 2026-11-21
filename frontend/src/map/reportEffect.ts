import type { SearchRecord, SearchedRecord } from './searchRecord.ts'

export type ReportEffect = { report: SearchedRecord; before: SearchedRecord['cells'] }

export function reportEffects(records: readonly SearchRecord[], runKey: string, elapsedSeconds: number,
  original: SearchedRecord['cells']): ReportEffect[] {
  const approvals = records.filter((record): record is SearchedRecord =>
    record.kind === 'searched' && record.runKey === runKey && record.stepSeconds === elapsedSeconds)
    .sort((a, b) => a.sequence - b.sequence)
  const effects: ReportEffect[] = []
  let before = original
  for (const [i, report] of approvals.entries()) {
    // An incomplete chain cannot identify the state immediately before approval.
    if (report.sequence !== i + 1 || approvals[i + 1]?.sequence === report.sequence ||
        report.cells.length !== before.length || report.cells.some(([index], cell) => before[cell][0] !== index)) break
    effects.push({ report, before })
    before = report.cells
  }
  return effects
}
