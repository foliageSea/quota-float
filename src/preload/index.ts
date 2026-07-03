import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type AppConfig = {
  baseUrl: string
  adminApiKey: string
  selectedGroupId: number | 'all'
  refreshIntervalSeconds: number
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

// Custom APIs for renderer
const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('config:save', config),
  getGroups: () => ipcRenderer.invoke('groups:get'),
  getLatestUsage: () => ipcRenderer.invoke('usage:get-latest'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
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
  onUsageUpdated: (callback: (snapshot: UsageSnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: UsageSnapshot): void => callback(snapshot)
    ipcRenderer.on('usage:updated', listener)
    return () => ipcRenderer.removeListener('usage:updated', listener)
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
