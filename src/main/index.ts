import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type AppConfig = {
  baseUrl: string
  adminApiKey: string
  selectedGroupId: number | 'all'
  refreshIntervalSeconds: number
}

type ApiGroup = {
  id: number
  name: string
  platform: string
  status: string
  account_count?: number
  active_account_count?: number
}

type ApiAccount = {
  id: number
  name: string
  status: string
  credentials?: {
    email?: string
    plan_type?: string
  }
  extra?: Record<string, unknown>
  group_ids?: number[]
  groups?: ApiGroup[]
}

type UsageAccount = {
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

type UsageSummary = {
  accountCount: number
  fiveHourAverage: number
  fiveHourMax: number
  sevenDayAverage: number
  sevenDayMax: number
}

const defaultConfig: AppConfig = {
  baseUrl: '',
  adminApiKey: '',
  selectedGroupId: 'all',
  refreshIntervalSeconds: 60
}

let mainWindow: BrowserWindow | null = null
let panelExpanded = false
let collapsedPosition: { x: number; y: number } | null = null
let collapsedDragTimer: ReturnType<typeof setInterval> | null = null
let collapsedDragOffset: { x: number; y: number } | null = null

function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) return defaultConfig

  try {
    const saved = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<AppConfig>
    return {
      ...defaultConfig,
      ...saved,
      selectedGroupId: saved.selectedGroupId ?? 'all',
      refreshIntervalSeconds: Math.max(15, Number(saved.refreshIntervalSeconds ?? 60) || 60)
    }
  } catch {
    return defaultConfig
  }
}

function saveConfig(config: AppConfig): AppConfig {
  const normalized: AppConfig = {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    adminApiKey: config.adminApiKey.trim(),
    selectedGroupId: config.selectedGroupId,
    refreshIntervalSeconds: Math.max(15, Number(config.refreshIntervalSeconds) || 60)
  }

  writeFileSync(getConfigPath(), JSON.stringify(normalized, null, 2))
  return normalized
}

function requireConfig(): AppConfig {
  const config = loadConfig()
  if (!config.baseUrl || !config.adminApiKey) {
    throw new Error('请先配置 Sub2API 地址和管理员 API Key')
  }
  return config
}

async function sub2apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const config = requireConfig()
  const url = new URL(path, `${config.baseUrl}/`)
  if (!url.searchParams.has('timezone')) {
    url.searchParams.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
  }

  const authHeaders = getAuthHeaderCandidates(config.adminApiKey)
  let lastStatus = 0

  for (const authHeader of authHeaders) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...authHeader,
        ...(init?.headers ?? {})
      }
    })

    lastStatus = response.status
    if (response.status === 401 && authHeaders.length > 1) continue
    if (!response.ok) throw new Error(`Sub2API 请求失败：${response.status}`)

    const payload = (await response.json()) as { code: number; message?: string; data: T }
    if (payload.code !== 0) throw new Error(payload.message || 'Sub2API 返回错误')
    return payload.data
  }

  throw new Error(`Sub2API 认证失败：${lastStatus}，请检查管理员 API Key 或登录 JWT`)
}

function getAuthHeaderCandidates(secret: string): Record<string, string>[] {
  const value = secret.trim()
  if (value.toLowerCase().startsWith('bearer ')) return [{ Authorization: value }]
  if (value.startsWith('eyJ')) return [{ Authorization: `Bearer ${value}` }]
  if (value.startsWith('admin-')) {
    return [{ 'X-API-Key': value }, { Authorization: value }, { Authorization: `Bearer ${value}` }]
  }
  return [{ Authorization: `Bearer ${value}` }, { 'X-API-Key': value }, { Authorization: value }]
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

function mapAccount(account: ApiAccount): UsageAccount {
  const extra = account.extra ?? {}
  const groups = account.groups ?? []
  return {
    id: account.id,
    name: account.name,
    email: account.credentials?.email || stringValue(extra.email),
    status: account.status,
    plan: account.credentials?.plan_type || '',
    groupIds: account.group_ids ?? groups.map((group) => group.id),
    groupNames: groups.map((group) => group.name),
    fiveHourPercent: numberValue(extra.codex_5h_used_percent),
    fiveHourResetAt: stringValue(extra.codex_5h_reset_at),
    sevenDayPercent: numberValue(extra.codex_7d_used_percent),
    sevenDayResetAt: stringValue(extra.codex_7d_reset_at),
    updatedAt: stringValue(extra.codex_usage_updated_at)
  }
}

async function getGroups(): Promise<ApiGroup[]> {
  return sub2apiFetch<ApiGroup[]>('api/v1/admin/groups/all')
}

async function refreshUsage(): Promise<{
  updatedAt: string
  selectedGroupId: number | 'all'
  groups: ApiGroup[]
  accounts: UsageAccount[]
  summary: UsageSummary
}> {
  const config = requireConfig()
  const [groups, accountData] = await Promise.all([
    getGroups(),
    sub2apiFetch<{ items: ApiAccount[] }>(
      'api/v1/admin/accounts?page=1&page_size=200&platform=&type=&status=&privacy_mode=&group=&search=&sort_by=name&sort_order=asc&lite=1'
    )
  ])

  const accounts = accountData.items
    .map(mapAccount)
    .filter((account) =>
      config.selectedGroupId === 'all' ? true : account.groupIds.includes(config.selectedGroupId)
    )

  const fiveHourValues = accounts.map((account) => account.fiveHourPercent)
  const sevenDayValues = accounts.map((account) => account.sevenDayPercent)

  return {
    updatedAt: new Date().toISOString(),
    selectedGroupId: config.selectedGroupId,
    groups,
    accounts,
    summary: {
      accountCount: accounts.length,
      fiveHourAverage: average(fiveHourValues),
      fiveHourMax: Math.max(0, ...fiveHourValues),
      sevenDayAverage: average(sevenDayValues),
      sevenDayMax: Math.max(0, ...sevenDayValues)
    }
  }
}

function setPanelExpanded(expanded: boolean): void {
  if (!mainWindow) return
  if (expanded) stopCollapsedWindowDrag()
  const collapsedSize = 78
  const expandedSize = { width: 390, height: 580 }

  if (expanded && !panelExpanded) {
    const bounds = mainWindow.getBounds()
    collapsedPosition = { x: bounds.x, y: bounds.y }
    const { workArea } = screen.getDisplayMatching(bounds)
    const ballCenterX = bounds.x + bounds.width / 2
    const aboveBallY = bounds.y - expandedSize.height - 8
    const minX = workArea.x
    const maxX = workArea.x + workArea.width - expandedSize.width
    const minY = workArea.y
    const maxY = workArea.y + workArea.height - expandedSize.height
    const x = Math.round(Math.min(Math.max(ballCenterX - expandedSize.width / 2, minX), maxX))
    const y = Math.round(Math.min(Math.max(aboveBallY, minY), maxY))

    panelExpanded = true
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(360, 480)
    mainWindow.setBounds({ x, y, ...expandedSize }, true)
    mainWindow.setResizable(false)
    return
  }

  if (!expanded && panelExpanded) {
    const position = collapsedPosition ?? mainWindow.getBounds()

    panelExpanded = false
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(collapsedSize, collapsedSize)
    mainWindow.setBounds({ x: position.x, y: position.y, width: collapsedSize, height: collapsedSize }, true)
    mainWindow.setResizable(false)
    return
  }

  panelExpanded = expanded
  mainWindow.setResizable(true)
  mainWindow.setSize(expanded ? expandedSize.width : collapsedSize, expanded ? expandedSize.height : collapsedSize, true)
  mainWindow.setMinimumSize(expanded ? 360 : collapsedSize, expanded ? 480 : collapsedSize)
  mainWindow.setResizable(false)
}

function startCollapsedWindowDrag(cursorX: number, cursorY: number): void {
  if (!mainWindow || panelExpanded) return
  const bounds = mainWindow.getBounds()
  collapsedDragOffset = { x: cursorX - bounds.x, y: cursorY - bounds.y }
  if (collapsedDragTimer) clearInterval(collapsedDragTimer)

  collapsedDragTimer = setInterval(() => {
    if (!mainWindow || !collapsedDragOffset || panelExpanded) {
      stopCollapsedWindowDrag()
      return
    }

    const point = screen.getCursorScreenPoint()
    mainWindow.setPosition(
      Math.round(point.x - collapsedDragOffset.x),
      Math.round(point.y - collapsedDragOffset.y),
      false
    )
  }, 16)
}

function stopCollapsedWindowDrag(): void {
  if (collapsedDragTimer) clearInterval(collapsedDragTimer)
  collapsedDragTimer = null
  collapsedDragOffset = null
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 78,
    height: 78,
    minWidth: 78,
    minHeight: 78,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    hasShadow: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:save', (_, config: AppConfig) => saveConfig(config))
  ipcMain.handle('groups:get', () => getGroups())
  ipcMain.handle('usage:refresh', () => refreshUsage())
  ipcMain.handle('window:set-expanded', (_, expanded: boolean) => setPanelExpanded(expanded))
  ipcMain.handle('window:start-collapsed-drag', (_, cursorX: number, cursorY: number) =>
    startCollapsedWindowDrag(cursorX, cursorY)
  )
  ipcMain.handle('window:stop-collapsed-drag', () => stopCollapsedWindowDrag())
  ipcMain.handle('window:set-always-on-top', (_, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
