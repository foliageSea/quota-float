import { app, shell, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type AppConfig = {
  baseUrl: string
  adminApiKey: string
  themeColor: string
  selectedGroupId: number | 'all'
  refreshIntervalSeconds: number
  selectedProxyId: number | 'none'
  proxyPollIntervalSeconds: number
  webServerPort: number
  webNetworkAddress: string
  ballPosition: WindowPosition | null
}

type WindowPosition = {
  x: number
  y: number
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

type ApiUsageWindow = {
  utilization?: number
  resets_at?: string
}

type ApiAccountUsage = {
  updated_at?: string
  five_hour?: ApiUsageWindow
  seven_day?: ApiUsageWindow
}

type ApiTodayAccountStats = {
  requests?: number
  tokens?: number
  cost?: number
  standard_cost?: number
  user_cost?: number
}

type TodayStats = {
  requests: number
  tokens: number
  cost: number
}

type ApiProxy = {
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

type ProxyTestResult = {
  success: boolean
  message: string
  latency_ms?: number
  ip_address?: string
  city?: string
  region?: string
  country?: string
  country_code?: string
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

type WebNetworkInterface = {
  name: string
  address: string
}

const defaultConfig: AppConfig = {
  baseUrl: '',
  adminApiKey: '',
  themeColor: '#20c997',
  selectedGroupId: 'all',
  refreshIntervalSeconds: 60,
  selectedProxyId: 'none',
  proxyPollIntervalSeconds: 300,
  webServerPort: 37890,
  webNetworkAddress: 'auto',
  ballPosition: null
}

const collapsedSize = 86
const collapsedWindowWidth = 270

let mainWindow: BrowserWindow | null = null
let ballWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let tray: Tray | null = null
let collapsedDragTimer: ReturnType<typeof setInterval> | null = null
let collapsedDragOffset: { x: number; y: number } | null = null
let usageRefreshTimer: ReturnType<typeof setInterval> | null = null
let latestUsageSnapshot: Awaited<ReturnType<typeof refreshUsage>> | null = null
let latestProxySnapshot: Awaited<ReturnType<typeof refreshProxy>> | null = null
let webServer: Server | null = null

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
      themeColor: normalizeThemeColor(saved.themeColor),
      selectedGroupId: saved.selectedGroupId ?? 'all',
      refreshIntervalSeconds: Math.max(15, Number(saved.refreshIntervalSeconds ?? 60) || 60),
      selectedProxyId: saved.selectedProxyId ?? 'none',
      proxyPollIntervalSeconds: Math.max(15, Number(saved.proxyPollIntervalSeconds ?? 300) || 300),
      webServerPort: normalizeWebServerPort(saved.webServerPort),
      webNetworkAddress: stringValue(saved.webNetworkAddress).trim() || 'auto',
      ballPosition: normalizeWindowPosition(saved.ballPosition)
    }
  } catch {
    return defaultConfig
  }
}

function normalizeWebServerPort(value: unknown): number {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 37890
}

function normalizeThemeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : defaultConfig.themeColor
}

function getThemeForeground(themeColor: string): string {
  const channelLuminance = (value: number): number => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    channelLuminance(Number.parseInt(themeColor.slice(1, 3), 16)) * 0.2126 +
    channelLuminance(Number.parseInt(themeColor.slice(3, 5), 16)) * 0.7152 +
    channelLuminance(Number.parseInt(themeColor.slice(5, 7), 16)) * 0.0722
  return luminance >= 0.19 ? '#111318' : '#ffffff'
}

function getWebNetworkInterfaces(): WebNetworkInterface[] {
  const interfaces: WebNetworkInterface[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        interfaces.push({ name, address: address.address })
      }
    }
  }
  return interfaces
}

function getLocalWebHost(): string {
  const interfaces = getWebNetworkInterfaces()
  const selectedAddress = loadConfig().webNetworkAddress
  if (
    selectedAddress !== 'auto' &&
    interfaces.some((networkInterface) => networkInterface.address === selectedAddress)
  ) {
    return selectedAddress
  }
  return interfaces[0]?.address ?? '127.0.0.1'
}

function normalizeWindowPosition(value: unknown): WindowPosition | null {
  if (!value || typeof value !== 'object') return null

  const position = value as Partial<WindowPosition>
  if (typeof position.x !== 'number' || typeof position.y !== 'number') return null
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null

  return { x: Math.round(position.x), y: Math.round(position.y) }
}

function saveConfig(config: AppConfig): AppConfig {
  const normalized: AppConfig = {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    adminApiKey: config.adminApiKey.trim(),
    themeColor: normalizeThemeColor(config.themeColor),
    selectedGroupId: config.selectedGroupId,
    refreshIntervalSeconds: Math.max(15, Number(config.refreshIntervalSeconds) || 60),
    selectedProxyId: config.selectedProxyId,
    proxyPollIntervalSeconds: Math.max(15, Number(config.proxyPollIntervalSeconds) || 300),
    webServerPort: normalizeWebServerPort(config.webServerPort),
    webNetworkAddress: config.webNetworkAddress.trim() || 'auto',
    ballPosition: normalizeWindowPosition(config.ballPosition)
  }

  writeFileSync(getConfigPath(), JSON.stringify(normalized, null, 2))
  return normalized
}

function hasUsageConfig(config = loadConfig()): boolean {
  return Boolean(config.baseUrl && config.adminApiKey)
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
    url.searchParams.set(
      'timezone',
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    )
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

function mapAccount(account: ApiAccount, usage?: ApiAccountUsage): UsageAccount {
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
    fiveHourPercent: numberValue(usage?.five_hour?.utilization ?? extra.codex_5h_used_percent),
    fiveHourResetAt: stringValue(usage?.five_hour?.resets_at ?? extra.codex_5h_reset_at),
    sevenDayPercent: numberValue(usage?.seven_day?.utilization ?? extra.codex_7d_used_percent),
    sevenDayResetAt: stringValue(usage?.seven_day?.resets_at ?? extra.codex_7d_reset_at),
    updatedAt: stringValue(usage?.updated_at ?? extra.codex_usage_updated_at)
  }
}

async function getGroups(): Promise<ApiGroup[]> {
  return sub2apiFetch<ApiGroup[]>('api/v1/admin/groups/all')
}

async function getProxies(): Promise<ApiProxy[]> {
  const data = await sub2apiFetch<{ items: ApiProxy[] }>(
    'api/v1/admin/proxies?page=1&page_size=200&sort_by=id&sort_order=desc'
  )
  return data.items
}

async function testProxy(proxyId: number): Promise<ProxyTestResult> {
  return sub2apiFetch<ProxyTestResult>(`api/v1/admin/proxies/${proxyId}/test`, { method: 'POST' })
}

async function getAccountUsage(accountId: number): Promise<ApiAccountUsage> {
  return sub2apiFetch<ApiAccountUsage>(`api/v1/admin/accounts/${accountId}/usage`)
}

async function getTodayStats(accountIds: number[]): Promise<TodayStats> {
  if (accountIds.length === 0) return { requests: 0, tokens: 0, cost: 0 }

  const data = await sub2apiFetch<{ stats?: Record<string, ApiTodayAccountStats> }>(
    'api/v1/admin/accounts/today-stats/batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_ids: accountIds })
    }
  )

  return Object.values(data.stats ?? {}).reduce<TodayStats>(
    (total, stats) => ({
      requests: total.requests + numberValue(stats.requests),
      tokens: total.tokens + numberValue(stats.tokens),
      cost: total.cost + numberValue(stats.user_cost ?? stats.cost)
    }),
    { requests: 0, tokens: 0, cost: 0 }
  )
}

async function refreshUsage(): Promise<{
  updatedAt: string
  selectedGroupId: number | 'all'
  groups: ApiGroup[]
  accounts: UsageAccount[]
  summary: UsageSummary
  todayStats: TodayStats
}> {
  return getUsageForGroup(loadConfig().selectedGroupId)
}

async function getUsageForGroup(selectedGroupId: number | 'all'): Promise<{
  updatedAt: string
  selectedGroupId: number | 'all'
  groups: ApiGroup[]
  accounts: UsageAccount[]
  summary: UsageSummary
  todayStats: TodayStats
}> {
  requireConfig()
  const [groups, accountData] = await Promise.all([
    getGroups(),
    sub2apiFetch<{ items: ApiAccount[] }>(
      'api/v1/admin/accounts?page=1&page_size=200&platform=&type=&status=&privacy_mode=&group=&search=&sort_by=name&sort_order=asc&lite=1'
    )
  ])

  const selectedAccounts = accountData.items.filter((account) => {
    const groupIds = account.group_ids ?? account.groups?.map((group) => group.id) ?? []
    return selectedGroupId === 'all' ? true : groupIds.includes(selectedGroupId)
  })

  const [accounts, todayStats] = await Promise.all([
    Promise.all(
      selectedAccounts.map(async (account) => {
        try {
          return mapAccount(account, await getAccountUsage(account.id))
        } catch {
          return mapAccount(account)
        }
      })
    ),
    getTodayStats(selectedAccounts.map((account) => account.id))
  ])

  const fiveHourValues = accounts.map((account) => account.fiveHourPercent)
  const sevenDayValues = accounts.map((account) => account.sevenDayPercent)

  return {
    updatedAt: new Date().toISOString(),
    selectedGroupId,
    groups,
    accounts,
    summary: {
      accountCount: accounts.length,
      fiveHourAverage: average(fiveHourValues),
      fiveHourMax: Math.max(0, ...fiveHourValues),
      sevenDayAverage: average(sevenDayValues),
      sevenDayMax: Math.max(0, ...sevenDayValues)
    },
    todayStats
  }
}

async function refreshProxy(): Promise<{
  updatedAt: string
  selectedProxyId: number | 'none'
  proxies: ApiProxy[]
  result: ProxyTestResult | null
}> {
  const config = requireConfig()
  const proxies = await getProxies()
  const selectedProxyId = config.selectedProxyId
  const result = selectedProxyId === 'none' ? null : await testProxy(selectedProxyId)

  return {
    updatedAt: new Date().toISOString(),
    selectedProxyId,
    proxies,
    result
  }
}

function sendPanelVisibilityChanged(): void {
  const visible = panelWindow?.isVisible() ?? false
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('window:panel-visibility-changed', visible)
  })
}

function broadcastUsageSnapshot(snapshot: Awaited<ReturnType<typeof refreshUsage>>): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('usage:updated', snapshot)
  })
}

function broadcastProxySnapshot(snapshot: Awaited<ReturnType<typeof refreshProxy>>): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('proxy:updated', snapshot)
  })
}

function broadcastConfig(config: AppConfig): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('config:updated', config)
  })
}

async function refreshUsageSnapshot(): Promise<Awaited<ReturnType<typeof refreshUsage>>> {
  latestUsageSnapshot = await refreshUsage()
  broadcastUsageSnapshot(latestUsageSnapshot)
  return latestUsageSnapshot
}

function stopUsagePolling(): void {
  if (usageRefreshTimer) clearInterval(usageRefreshTimer)
  usageRefreshTimer = null
}

function startUsagePolling(): void {
  stopUsagePolling()

  const config = loadConfig()
  if (!hasUsageConfig(config)) return

  const interval = Math.max(15, config.refreshIntervalSeconds) * 1000
  usageRefreshTimer = setInterval(() => {
    refreshUsageSnapshot().catch(() => {
      // Keep polling even if one request fails; manual refresh surfaces the error to the UI.
    })
  }, interval)
}

function resetUsagePolling(): void {
  startUsagePolling()
  if (!hasUsageConfig()) return

  refreshUsageSnapshot().catch(() => {
    // The renderer reports refresh errors when users trigger a manual refresh.
  })
}

async function refreshProxySnapshot(): Promise<Awaited<ReturnType<typeof refreshProxy>>> {
  latestProxySnapshot = await refreshProxy()
  broadcastProxySnapshot(latestProxySnapshot)
  return latestProxySnapshot
}

async function testSelectedProxySnapshot(): Promise<Awaited<ReturnType<typeof refreshProxy>>> {
  const config = requireConfig()
  if (config.selectedProxyId === 'none') throw new Error('请先选择要测试的代理')

  const [proxies, result] = await Promise.all([getProxies(), testProxy(config.selectedProxyId)])
  latestProxySnapshot = {
    updatedAt: new Date().toISOString(),
    selectedProxyId: config.selectedProxyId,
    proxies,
    result
  }
  broadcastProxySnapshot(latestProxySnapshot)
  return latestProxySnapshot
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }
    return entities[character]
  })
}

function formatUsageTime(value: string): string {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN')
}

function parseWebGroupId(value: string | null): number | 'all' {
  if (!value || value === 'all') return 'all'
  if (!/^\d+$/.test(value)) throw new Error('groupId must be a positive integer')

  const groupId = Number(value)
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new Error('groupId must be a positive integer')
  }
  return groupId
}

function sendWebResponse(response: ServerResponse, status: number, content: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(content)
}

function renderWebPage(title: string, content: string): string {
  const themeColor = loadConfig().themeColor
  const themeForeground = getThemeForeground(themeColor)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", sans-serif; color: #172033; background: #f5f7fb; --theme-color: ${themeColor}; --theme-foreground: ${themeForeground}; }
    body { max-width: 980px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0; font-size: 24px; } h2 { font-size: 16px; margin: 0; }
    .page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    button { height: 36px; border: 0; border-radius: 6px; background: var(--theme-color); color: var(--theme-foreground); padding: 0 14px; cursor: pointer; font: inherit; }
    .summary, article, .notice { border: 1px solid #dce2ec; background: #fff; padding: 16px; border-radius: 8px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric { color: #526077; font-size: 13px; } .metric strong { display: block; color: #172033; font-size: 24px; margin-top: 4px; }
    .accounts { display: grid; gap: 12px; } article { display: grid; gap: 12px; }
    .heading, .usage { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    .name { font-weight: 700; } .meta { color: #667085; font-size: 13px; margin-top: 4px; }
    .bar { height: 8px; background: #e6eaf0; border-radius: 4px; overflow: hidden; margin-top: 6px; }
    .bar span { display: block; height: 100%; background: var(--theme-color); } .usage { font-size: 13px; color: #526077; }
    .usage > div { min-width: 160px; } .notice { color: #526077; text-align: center; }
    @media (max-width: 560px) { body { padding: 20px 12px; } .summary { grid-template-columns: 1fr; } .heading, .usage { align-items: start; flex-direction: column; gap: 10px; } }
  </style>
</head>
<body>${content}</body>
</html>`
}

function renderUsageWebPage(snapshot: Awaited<ReturnType<typeof refreshUsage>>): string {
  const selectedGroupId = String(snapshot.selectedGroupId)
  const currentGroup =
    snapshot.selectedGroupId === 'all'
      ? '全部分组'
      : (snapshot.groups.find((group) => group.id === snapshot.selectedGroupId)?.name ??
        `分组 ${snapshot.selectedGroupId}`)
  const accounts = snapshot.accounts.length
    ? snapshot.accounts
        .map(
          (account) => `<article>
            <div class="heading"><div><div class="name">${escapeHtml(account.name)}</div><div class="meta">${escapeHtml(account.email || '--')}</div></div><div class="meta">${escapeHtml(account.status)}</div></div>
            <div class="usage"><div>5 小时: ${account.fiveHourPercent}%<div class="bar"><span style="width:${Math.min(100, Math.max(0, account.fiveHourPercent))}%"></span></div></div><div>7 天: ${account.sevenDayPercent}%<div class="bar"><span style="width:${Math.min(100, Math.max(0, account.sevenDayPercent))}%"></span></div></div></div>
            <div class="meta">下次重置: 5 小时 ${escapeHtml(formatUsageTime(account.fiveHourResetAt))} | 7 天 ${escapeHtml(formatUsageTime(account.sevenDayResetAt))}</div>
          </article>`
        )
        .join('')
    : '<div class="notice">当前分组没有账号。</div>'

  return renderWebPage(
    'Quota Float 用量查询',
    `<header class="page-header"><h1>Quota Float 用量查询</h1><form method="get"><input type="hidden" name="groupId" value="${selectedGroupId}"><button type="submit">刷新</button></form></header>
      <section class="summary"><div class="metric">当前分组<strong>${escapeHtml(currentGroup)}</strong></div><div class="metric">账号数量<strong>${snapshot.summary.accountCount}</strong></div><div class="metric">5h / 7d 平均<strong>${snapshot.summary.fiveHourAverage}% / ${snapshot.summary.sevenDayAverage}%</strong></div></section>
      <section class="accounts">${accounts}</section>`
  )
}

async function handleWebRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method !== 'GET') {
      sendWebResponse(
        response,
        405,
        renderWebPage('Method Not Allowed', '<p>Only GET requests are supported.</p>')
      )
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    const groupId = parseWebGroupId(url.searchParams.get('groupId'))
    if (url.pathname !== '/') {
      sendWebResponse(response, 404, renderWebPage('Not Found', '<p>Not found.</p>'))
      return
    }

    const snapshot = await getUsageForGroup(groupId)
    if (groupId !== 'all' && !snapshot.groups.some((group) => group.id === groupId)) {
      sendWebResponse(response, 404, renderWebPage('Group Not Found', '<p>指定的分组不存在。</p>'))
      return
    }
    sendWebResponse(response, 200, renderUsageWebPage(snapshot))
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询失败'
    sendWebResponse(response, 400, renderWebPage('请求失败', `<p>${escapeHtml(message)}</p>`))
  }
}

async function stopWebServer(): Promise<void> {
  const server = webServer
  webServer = null
  if (!server) return

  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function restartWebServer(): Promise<void> {
  await stopWebServer()
  const config = loadConfig()
  const port = config.webServerPort

  try {
    webServer = await createWebServer(port)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error

    webServer = await createWebServer(0)
    const address = webServer.address()
    if (!address || typeof address === 'string') throw new Error('Web Server 未返回监听端口')

    saveConfig({ ...config, webServerPort: address.port })
    console.warn(`Web Server port ${port} is in use; using ${address.port} instead.`)
  }
}

function createWebServer(port: number): Promise<Server> {
  const server = createServer((request, response) => void handleWebRequest(request, response))

  return new Promise<Server>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.close()
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError)
      server.on('error', (error) => console.error('Web Server error:', error))
      resolve(server)
    })
  })
}

function getRendererUrl(view: 'ball' | 'panel'): string {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!rendererUrl) return ''

  const url = new URL(rendererUrl)
  url.searchParams.set('view', view)
  return url.toString()
}

function loadRenderer(window: BrowserWindow, view: 'ball' | 'panel'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(getRendererUrl(view))
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

function clampPositionToWorkArea(
  position: WindowPosition,
  width = collapsedWindowWidth
): WindowPosition {
  const target = { x: position.x, y: position.y, width, height: collapsedSize }
  const { workArea } = screen.getDisplayMatching(target)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - collapsedSize

  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maxY))
  }
}

function getDefaultBallPosition(): WindowPosition {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - collapsedWindowWidth - 24,
    y: workArea.y + workArea.height - collapsedSize - 64
  }
}

function getSavedBallPosition(): WindowPosition {
  return clampPositionToWorkArea(loadConfig().ballPosition ?? getDefaultBallPosition())
}

function updateBallPosition(position: WindowPosition): void {
  const config = loadConfig()
  saveConfig({ ...config, ballPosition: clampPositionToWorkArea(position) })
}

function saveCurrentBallPosition(): void {
  if (!ballWindow || ballWindow.isDestroyed()) return
  const [x, y] = ballWindow.getPosition()
  updateBallPosition({ x, y })
}

function resetBallPosition(): void {
  if (!ballWindow) createBallWindow()
  if (!ballWindow) return

  const position = clampPositionToWorkArea(getDefaultBallPosition())
  ballWindow.setPosition(position.x, position.y, false)
  updateBallPosition(position)
  if (panelWindow?.isVisible()) positionPanelNearBall()
}

function setFloatingWindowAlwaysOnTop(window: BrowserWindow | null, enabled: boolean): void {
  if (!window || window.isDestroyed()) return
  window.setAlwaysOnTop(enabled, 'screen-saver')
}

function positionPanelNearBall(): void {
  if (!ballWindow || !panelWindow) return

  const expandedSize = { width: 390, height: 580 }
  const bounds = ballWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(bounds)
  const ballCenterX = bounds.x + collapsedSize / 2
  const aboveBallY = bounds.y - expandedSize.height - 8
  const belowBallY = bounds.y + collapsedSize + 8
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - expandedSize.width
  const minY = workArea.y
  const maxY = workArea.y + workArea.height - expandedSize.height
  const x = Math.round(Math.min(Math.max(ballCenterX - expandedSize.width / 2, minX), maxX))
  const preferredY = aboveBallY >= minY ? aboveBallY : belowBallY
  const y = Math.round(Math.min(Math.max(preferredY, minY), maxY))

  panelWindow.setBounds({ x, y, ...expandedSize }, true)
}

function showPanel(): void {
  if (!ballWindow) createBallWindow()
  if (!panelWindow) createPanelWindow()
  if (!panelWindow) return

  stopCollapsedWindowDrag()
  positionPanelNearBall()
  panelWindow.show()
  panelWindow.focus()
  sendPanelVisibilityChanged()
}

function hidePanel(): void {
  panelWindow?.hide()
  sendPanelVisibilityChanged()
}

function setPanelExpanded(expanded: boolean): void {
  if (expanded) showPanel()
  else hidePanel()
}

function startCollapsedWindowDrag(cursorX: number, cursorY: number): void {
  if (!ballWindow) return
  const bounds = ballWindow.getBounds()
  collapsedDragOffset = { x: cursorX - bounds.x, y: cursorY - bounds.y }
  if (collapsedDragTimer) clearInterval(collapsedDragTimer)

  collapsedDragTimer = setInterval(() => {
    if (!ballWindow || !collapsedDragOffset) {
      stopCollapsedWindowDrag()
      return
    }

    const point = screen.getCursorScreenPoint()
    ballWindow.setBounds(
      {
        x: Math.round(point.x - collapsedDragOffset.x),
        y: Math.round(point.y - collapsedDragOffset.y),
        width: collapsedWindowWidth,
        height: collapsedSize
      },
      false
    )

    if (panelWindow?.isVisible()) positionPanelNearBall()
  }, 16)
}

function stopCollapsedWindowDrag(): void {
  if (collapsedDragTimer) clearInterval(collapsedDragTimer)
  collapsedDragTimer = null
  collapsedDragOffset = null
  saveCurrentBallPosition()
}

function openPanel(): void {
  showPanel()
}

function createAppMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: '打开面板', click: openPanel },
    { label: '重置悬浮球位置', click: resetBallPosition },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
}

function showAppMenu(): void {
  createAppMenu().popup({ window: ballWindow ?? panelWindow ?? undefined })
}

function createTray(): void {
  if (tray) return

  const trayIcon =
    process.platform === 'darwin'
      ? nativeImage.createFromPath(icon).resize({ width: 18, height: 18, quality: 'best' })
      : icon

  tray = new Tray(trayIcon)
  tray.setToolTip('Quota Float')
  tray.setContextMenu(createAppMenu())
  tray.on('right-click', showAppMenu)
}

function attachWindowHandlers(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

function createBallWindow(): void {
  if (ballWindow && !ballWindow.isDestroyed()) return

  const position = getSavedBallPosition()

  const window = new BrowserWindow({
    width: collapsedWindowWidth,
    height: collapsedSize,
    x: position.x,
    y: position.y,
    minWidth: collapsedWindowWidth,
    minHeight: collapsedSize,
    maxWidth: collapsedWindowWidth,
    maxHeight: collapsedSize,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  ballWindow = window
  mainWindow = window
  setFloatingWindowAlwaysOnTop(window, true)

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    ballWindow = null
    if (mainWindow === window) mainWindow = panelWindow
  })

  attachWindowHandlers(window)
  loadRenderer(window, 'ball')
}

function createPanelWindow(): void {
  if (panelWindow && !panelWindow.isDestroyed()) return

  const window = new BrowserWindow({
    width: 390,
    height: 580,
    minWidth: 360,
    minHeight: 480,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  panelWindow = window
  setFloatingWindowAlwaysOnTop(window, true)

  window.on('ready-to-show', () => {
    sendPanelVisibilityChanged()
  })

  window.on('hide', sendPanelVisibilityChanged)
  window.on('show', sendPanelVisibilityChanged)

  window.on('closed', () => {
    panelWindow = null
    if (mainWindow === window) mainWindow = ballWindow
    sendPanelVisibilityChanged()
  })

  attachWindowHandlers(window)
  loadRenderer(window, 'panel')
}

function createWindow(): void {
  createBallWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:save', async (_, config: AppConfig) => {
    const savedConfig = saveConfig(config)
    broadcastConfig(savedConfig)
    resetUsagePolling()
    await restartWebServer()
    return loadConfig()
  })
  ipcMain.handle('groups:get', () => getGroups())
  ipcMain.handle('usage:get-latest', () => latestUsageSnapshot)
  ipcMain.handle('usage:refresh', () => refreshUsageSnapshot())
  ipcMain.handle('proxy:get-latest', () => latestProxySnapshot)
  ipcMain.handle('proxy:refresh', () => refreshProxySnapshot())
  ipcMain.handle('proxy:test', () => testSelectedProxySnapshot())
  ipcMain.handle('web:get-network-interfaces', () => getWebNetworkInterfaces())
  ipcMain.handle('web:open-usage', (_, groupId: number | 'all') => {
    const selectedGroupId = groupId === 'all' ? 'all' : Number(groupId)
    if (
      selectedGroupId !== 'all' &&
      (!Number.isSafeInteger(selectedGroupId) || selectedGroupId <= 0)
    ) {
      throw new Error('分组 ID 无效')
    }

    const port = loadConfig().webServerPort
    return shell.openExternal(
      `http://${getLocalWebHost()}:${port}/?groupId=${encodeURIComponent(String(selectedGroupId))}`
    )
  })
  ipcMain.handle('window:show-menu', () => showAppMenu())
  ipcMain.handle('window:show-panel', () => showPanel())
  ipcMain.handle('window:hide-panel', () => hidePanel())
  ipcMain.handle('window:set-expanded', (_, expanded: boolean) => setPanelExpanded(expanded))
  ipcMain.handle('window:start-collapsed-drag', (_, cursorX: number, cursorY: number) =>
    startCollapsedWindowDrag(cursorX, cursorY)
  )
  ipcMain.handle('window:stop-collapsed-drag', () => stopCollapsedWindowDrag())
  ipcMain.handle('window:set-always-on-top', (_, enabled: boolean) => {
    setFloatingWindowAlwaysOnTop(ballWindow, enabled)
    setFloatingWindowAlwaysOnTop(panelWindow, enabled)
  })

  if (process.platform === 'darwin') app.dock?.hide()
  createTray()
  try {
    await restartWebServer()
  } catch (error) {
    console.error('Unable to start Web Server:', error)
  }
  createWindow()
  resetUsagePolling()

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
    stopUsagePolling()
    app.quit()
  }
})

app.on('will-quit', () => {
  stopUsagePolling()
  void stopWebServer()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
