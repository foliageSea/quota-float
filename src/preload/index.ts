import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type AppConfig = {
  baseUrl: string
  adminApiKey: string
  themeColor: string
  selectedGroupId: number | 'all'
  refreshIntervalSeconds: number
  selectedProxyId: number | 'none'
  proxyPollIntervalSeconds: number
  webServerPort: number
  webNetworkAddress: string
  ballPosition: { x: number; y: number } | null
}

export type WebNetworkInterface = {
  name: string
  address: string
}

export type ApiGroup = {
  id: number
  name: string
  platform: string
  status: string
  account_count?: number
  active_account_count?: number
}

export type UsageAccount = {
  id: number
  name: string
  email: string
  status: string
  plan: string
  groupIds: number[]
  groupNames: string[]
  fiveHourPercent: number
  fiveHourResetAt: string
  sevenDayPercent: number
  sevenDayResetAt: string
  updatedAt: string
}

export type UsageSnapshot = {
  updatedAt: string
  selectedGroupId: number | 'all'
  groups: ApiGroup[]
  accounts: UsageAccount[]
  summary: {
    accountCount: number
    fiveHourAverage: number
    fiveHourMax: number
    sevenDayAverage: number
    sevenDayMax: number
  }
}

export type ApiProxy = {
  id: number
  name: string
  protocol: string
  host: string
  port: number
  status: string
  latency_ms?: number
  latency_status?: string
  latency_message?: string
  ip_address?: string
  country?: string
  country_code?: string
  region?: string
  city?: string
  quality_status?: string
  quality_score?: number
  quality_grade?: string
  quality_summary?: string
  quality_checked?: number
}

export type ProxySnapshot = {
  updatedAt: string
  selectedProxyId: number | 'none'
  proxies: ApiProxy[]
  result: {
    success: boolean
    message: string
    latency_ms?: number
    ip_address?: string
    city?: string
    region?: string
    country?: string
    country_code?: string
  } | null
}

// Custom APIs for renderer
const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('config:save', config),
  getGroups: () => ipcRenderer.invoke('groups:get'),
  getLatestUsage: () => ipcRenderer.invoke('usage:get-latest'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
  getLatestProxy: () => ipcRenderer.invoke('proxy:get-latest'),
  refreshProxy: () => ipcRenderer.invoke('proxy:refresh'),
  testSelectedProxy: () => ipcRenderer.invoke('proxy:test'),
  openWebUsage: (groupId: number | 'all') => ipcRenderer.invoke('web:open-usage', groupId),
  getWebNetworkInterfaces: () => ipcRenderer.invoke('web:get-network-interfaces'),
  showWindowMenu: () => ipcRenderer.invoke('window:show-menu'),
  onPanelExpandedChanged: (callback: (expanded: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, visible: boolean): void => callback(visible)
    ipcRenderer.on('window:panel-visibility-changed', listener)
    return () => ipcRenderer.removeListener('window:panel-visibility-changed', listener)
  },
  onPanelVisibilityChanged: (callback: (visible: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, visible: boolean): void => callback(visible)
    ipcRenderer.on('window:panel-visibility-changed', listener)
    return () => ipcRenderer.removeListener('window:panel-visibility-changed', listener)
  },
  onConfigUpdated: (callback: (config: AppConfig) => void) => {
    const listener = (_: Electron.IpcRendererEvent, config: AppConfig): void => callback(config)
    ipcRenderer.on('config:updated', listener)
    return () => ipcRenderer.removeListener('config:updated', listener)
  },
  onUsageUpdated: (callback: (snapshot: UsageSnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: UsageSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('usage:updated', listener)
    return () => ipcRenderer.removeListener('usage:updated', listener)
  },
  onProxyUpdated: (callback: (snapshot: ProxySnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: ProxySnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('proxy:updated', listener)
    return () => ipcRenderer.removeListener('proxy:updated', listener)
  },
  setPanelExpanded: (expanded: boolean) => ipcRenderer.invoke('window:set-expanded', expanded),
  showPanel: () => ipcRenderer.invoke('window:show-panel'),
  hidePanel: () => ipcRenderer.invoke('window:hide-panel'),
  startCollapsedWindowDrag: (cursorX: number, cursorY: number) =>
    ipcRenderer.invoke('window:start-collapsed-drag', cursorX, cursorY),
  stopCollapsedWindowDrag: () => ipcRenderer.invoke('window:stop-collapsed-drag'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:set-always-on-top', enabled)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
