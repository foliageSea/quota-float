import { ElectronAPI } from '@electron-toolkit/preload'
import type { ApiGroup, AppConfig, UsageSnapshot } from './index'

export type TokenBallAPI = {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  getGroups: () => Promise<ApiGroup[]>
  refreshUsage: () => Promise<UsageSnapshot>
  setPanelExpanded: (expanded: boolean) => Promise<void>
  setAlwaysOnTop: (enabled: boolean) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TokenBallAPI
  }
}
