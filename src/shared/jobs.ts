export type JobItem = { src: string; dest: string; replace: boolean }
export type JobSpec = { op: 'copy' | 'move'; from: string | null; to: string | null; items: JobItem[] }
export type JobState = 'queued' | 'measuring' | 'running' | 'done' | 'failed' | 'cancelled'
export type JobSnapshot = {
  id: string
  spec: JobSpec
  state: JobState
  bytes: number
  total: number | null
  current: string | null
  failed: { path: string; error: string }[]
  started: number | null
  ended: number | null
}
export const routeOf = (s: Pick<JobSpec, 'from' | 'to'>): string => `${s.from ?? 'local'}>${s.to ?? 'local'}`
