import type { ComponentType } from 'react'

export interface SlotRegistration {
  name: string
  id: string
  order?: number
  label?: () => string
  inject?: () => Record<string, unknown>
}

export interface SlotsApi {
  inject(slot: string, factory: () => unknown): void
  register(options: SlotRegistration, component: ComponentType<never>): unknown
}

/**
 * The slice of the client root context this plugin consumes. The runtime
 * object is structurally compatible; services arrive via the module's
 * exported `inject` array before apply runs.
 */
export interface ClientCtx {
  slots: SlotsApi
}
