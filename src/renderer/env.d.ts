/// <reference types="vite/client" />
import type { Api } from '../preload'

declare global {
  const __VERSION__: string
  interface Window {
    api: Api
  }
}
