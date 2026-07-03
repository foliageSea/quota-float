import { ElectronAPI } from '@electron-toolkit/preload'
import type { ApiGroup, AppConfig, ProxySnapshot, UsageSnapshot } from './index'

export type TokenBallAPI = {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  getGroups: () => Promise<ApiGroup[]>
  getLatestUsage: () => Promise<UsageSnapshot | null>
  refreshUsage: () => Promise<UsageSnapshot>
  getLatestProxy: () => Promise<ProxySnapshot | null>
  refreshProxy: () => Promise<ProxySnapshot>
  showWindowMenu: () => Promise<void>
  onPanelExpandedChanged: (callback: (expanded: boolean) => void) => () => void
  onPanelVisibilityChanged: (callback: (visible: boolean) => void) => () => void
  onUsageUpdated: (callback: (snapshot: UsageSnapshot) => void) => () => void
  onProxyUpdated: (callback: (snapshot: ProxySnapshot) => void) => () => void
  setPanelExpanded: (expanded: boolean) => Promise<void>
  showPanel: () => Promise<void>
  hidePanel: () => Promise<void>
  startCollapsedWindowDrag: (cursorX: number, cursorY: number) => Promise<void>
  stopCollapsedWindowDrag: () => Promise<void>
  setAlwaysOnTop: (enabled: boolean) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TokenBallAPI
  }
}
