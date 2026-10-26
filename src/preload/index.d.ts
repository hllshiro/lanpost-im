import type { Api } from '../shared/ipc'
import type { AppEvent } from '../shared/domain'

declare global {
  interface Window {
    api: Api
  }
}

export type { AppEvent }
