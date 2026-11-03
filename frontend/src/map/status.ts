export type MapStatus = 'loading' | 'connected' | 'data-error' | 'startup-error'
export type MapStatusEvent = 'idle' | 'error' | 'startup-error' | 'retry'

export function mapStatusReducer(status: MapStatus, event: MapStatusEvent): MapStatus {
  switch (event) {
    case 'retry': return 'loading'
    case 'startup-error': return 'startup-error'
    case 'error': return 'data-error'
    // MapLibre can become idle after requests fail. Only a clean attempt connects.
    case 'idle': return status === 'loading' ? 'connected' : status
  }
}
