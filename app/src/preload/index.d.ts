import type { PreloadApi } from './index'

declare global {
  interface Window {
    api: PreloadApi
  }
}

export {}
