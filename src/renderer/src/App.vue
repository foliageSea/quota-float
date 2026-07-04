<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, ChevronDown, RefreshCw, Save, Wifi } from '@lucide/vue'
import Button from './components/ui/Button.vue'
import Input from './components/ui/Input.vue'
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput
} from './components/ui/number-field'
import Progress from './components/ui/Progress.vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import type { ApiProxy, AppConfig, UsageAccount, UsageSnapshot, ProxySnapshot } from '../../preload/index'

const defaultConfig: AppConfig = {
  baseUrl: '',
  adminApiKey: '',
  selectedGroupId: 'all',
  refreshIntervalSeconds: 60,
  selectedProxyId: 'none',
  proxyPollIntervalSeconds: 300,
  ballPosition: null
}

const view = new URLSearchParams(window.location.search).get('view') === 'panel' ? 'panel' : 'ball'
const isBallView = view === 'ball'
const isPanelView = view === 'panel'
type PanelTab = 'usage' | 'proxy' | 'settings'
const panelVisible = ref(false)
const activePanelTab = ref<PanelTab>('usage')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const config = ref<AppConfig>({ ...defaultConfig })
const refreshIntervalInput = ref(defaultConfig.refreshIntervalSeconds)
const proxyPollIntervalInput = ref(defaultConfig.proxyPollIntervalSeconds)
const snapshot = ref<UsageSnapshot | null>(null)
const proxySnapshot = ref<ProxySnapshot | null>(null)
const ballMetric = ref<'fiveHour' | 'sevenDay'>('fiveHour')
const usageGlowActive = ref(false)
let refreshTimer: number | undefined
let proxyRefreshTimer: number | undefined
let usageGlowTimer: number | undefined
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let didDragBall = false
let removePanelVisibilityListener: (() => void) | undefined
let removeUsageUpdatedListener: (() => void) | undefined
let removeProxyUpdatedListener: (() => void) | undefined

const fiveHourAveragePercent = computed(() => snapshot.value?.summary.fiveHourAverage ?? 0)
const sevenDayAveragePercent = computed(() => snapshot.value?.summary.sevenDayAverage ?? 0)
const ballAveragePercent = computed(() => {
  return ballMetric.value === 'fiveHour' ? fiveHourAveragePercent.value : sevenDayAveragePercent.value
})
const ballMetricLabel = computed(() => (ballMetric.value === 'fiveHour' ? '5小时' : '7天'))
const accountCount = computed(() => snapshot.value?.summary.accountCount ?? 0)
const groups = computed(() => snapshot.value?.groups ?? [])
const proxies = computed(() => proxySnapshot.value?.proxies ?? [])
const selectedProxy = computed<ApiProxy | null>(() => {
  const selectedProxyId = config.value.selectedProxyId
  if (selectedProxyId === 'none') return null
  return proxies.value.find((proxy) => proxy.id === Number(selectedProxyId)) ?? null
})
const proxyStatusTone = computed(() => {
  if (config.value.selectedProxyId === 'none') return '#6b7280'
  if (proxySnapshot.value?.result?.success) return '#20c997'
  if (proxySnapshot.value?.result) return '#ff5d5d'
  const status = selectedProxy.value?.quality_status || selectedProxy.value?.latency_status
  if (status === 'healthy' || status === 'success') return '#20c997'
  if (status) return '#f0b84b'
  return '#6b7280'
})
const proxyStatusLabel = computed(() => {
  if (config.value.selectedProxyId === 'none') return 'OFF'
  if (proxySnapshot.value?.result?.success) return 'OK'
  if (proxySnapshot.value?.result) return 'ERR'
  return selectedProxy.value ? 'IP' : '--'
})
const ballTone = computed(() => {
  if (error.value) return '#ff5d5d'
  if (ballAveragePercent.value >= 90) return '#ff5d5d'
  if (ballAveragePercent.value >= 70) return '#f0b84b'
  return '#20c997'
})

const usedPercent = computed(() => Math.min(100, Math.max(0, ballAveragePercent.value)))

const remainingPercent = computed(() => 100 - usedPercent.value)

const waterLevel = computed(() => {
  return `${remainingPercent.value}%`
})

function progressTone(value: number): 'good' | 'warn' | 'danger' {
  if (value >= 90) return 'danger'
  if (value >= 70) return 'warn'
  return 'good'
}

function formatDate(value: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function accountLabel(account: UsageAccount): string {
  return account.email || account.name
}

function proxyLocation(proxy: ApiProxy | null): string {
  if (!proxy) return '--'
  return [proxy.country, proxy.region, proxy.city].filter(Boolean).join(' / ') || '--'
}

function proxyEndpoint(proxy: ApiProxy | null): string {
  if (!proxy) return '--'
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`
}

function formatLatency(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}ms` : '--'
}

async function setExpanded(value: boolean): Promise<void> {
  panelVisible.value = value
  if (value) await window.api.showPanel()
  else await window.api.hidePanel()
}

function startBallDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  dragPointerId = event.pointerId
  dragStartX = event.screenX
  dragStartY = event.screenY
  didDragBall = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  void window.api.startCollapsedWindowDrag(event.screenX, event.screenY)
}

function trackBallDrag(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return
  if (Math.abs(event.screenX - dragStartX) > 3 || Math.abs(event.screenY - dragStartY) > 3) {
    didDragBall = true
  }
}

function stopBallDrag(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return
  dragPointerId = null
  void window.api.stopCollapsedWindowDrag()
}

function toggleBallMetric(): void {
  ballMetric.value = ballMetric.value === 'fiveHour' ? 'sevenDay' : 'fiveHour'
}

function openPanelFromBall(): void {
  if (didDragBall) return
  if (panelVisible.value) {
    void setExpanded(false)
    return
  }

  toggleBallMetric()
}

function showWindowMenu(): void {
  void window.api.showWindowMenu()
}

function flashUsageGlow(): void {
  if (!isBallView) return
  if (usageGlowTimer) window.clearTimeout(usageGlowTimer)
  usageGlowActive.value = false
  window.requestAnimationFrame(() => {
    usageGlowActive.value = true
    usageGlowTimer = window.setTimeout(() => {
      usageGlowActive.value = false
      usageGlowTimer = undefined
    }, 1200)
  })
}

async function refresh(): Promise<void> {
  if (!config.value.baseUrl || !config.value.adminApiKey) {
    error.value = '请先完成 Sub2API 配置'
    activePanelTab.value = 'settings'
    return
  }

  loading.value = true
  error.value = ''
  try {
    snapshot.value = await window.api.refreshUsage()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '刷新失败'
  } finally {
    loading.value = false
  }
}

async function refreshActiveTab(): Promise<void> {
  if (activePanelTab.value === 'proxy') {
    await refreshProxy()
    return
  }

  if (activePanelTab.value === 'settings') {
    await Promise.all([refresh(), refreshProxy()])
    return
  }

  await refresh()
}

async function refreshProxy(): Promise<void> {
  if (!config.value.baseUrl || !config.value.adminApiKey) return

  try {
    proxySnapshot.value = await window.api.refreshProxy()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '代理监测刷新失败'
  }
}

async function save(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    const selectedGroupId =
      config.value.selectedGroupId === 'all' ? 'all' : Number(config.value.selectedGroupId)
    const ballPosition = config.value.ballPosition
    config.value = await window.api.saveConfig({
      baseUrl: config.value.baseUrl,
      adminApiKey: config.value.adminApiKey,
      selectedGroupId,
      refreshIntervalSeconds: refreshIntervalInput.value || 60,
      selectedProxyId:
        config.value.selectedProxyId === 'none' ? 'none' : Number(config.value.selectedProxyId),
      proxyPollIntervalSeconds: proxyPollIntervalInput.value || 300,
      ballPosition: ballPosition ? { x: ballPosition.x, y: ballPosition.y } : null
    })
    refreshIntervalInput.value = config.value.refreshIntervalSeconds
    proxyPollIntervalInput.value = config.value.proxyPollIntervalSeconds
    activePanelTab.value = 'usage'
    await Promise.all([refresh(), refreshProxy()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function resetTimer(): void {
  if (!isPanelView) return
  if (refreshTimer) window.clearInterval(refreshTimer)
  const interval = Math.max(15, config.value.refreshIntervalSeconds) * 1000
  refreshTimer = window.setInterval(refresh, interval)
}

function resetProxyTimer(): void {
  if (proxyRefreshTimer) window.clearInterval(proxyRefreshTimer)
  const interval = Math.max(15, config.value.proxyPollIntervalSeconds) * 1000
  proxyRefreshTimer = window.setInterval(refreshProxy, interval)
}

watch(
  () => config.value.refreshIntervalSeconds,
  () => resetTimer()
)

watch(
  () => config.value.proxyPollIntervalSeconds,
  () => resetProxyTimer()
)

onMounted(async () => {
  removePanelVisibilityListener = window.api.onPanelVisibilityChanged((value) => {
    panelVisible.value = value
    if (isPanelView && value) void refreshActiveTab()
  })
  removeUsageUpdatedListener = window.api.onUsageUpdated((value) => {
    snapshot.value = value
    flashUsageGlow()
  })
  removeProxyUpdatedListener = window.api.onProxyUpdated((value) => {
    proxySnapshot.value = value
  })
  config.value = await window.api.getConfig()
  refreshIntervalInput.value = config.value.refreshIntervalSeconds
  proxyPollIntervalInput.value = config.value.proxyPollIntervalSeconds
  if (!config.value.baseUrl || !config.value.adminApiKey) activePanelTab.value = 'settings'
  snapshot.value = await window.api.getLatestUsage()
  proxySnapshot.value = await window.api.getLatestProxy()
  if (isPanelView || !snapshot.value) await Promise.all([refresh(), refreshProxy()])
  resetTimer()
  resetProxyTimer()
})

onBeforeUnmount(() => {
  removePanelVisibilityListener?.()
  removeUsageUpdatedListener?.()
  removeProxyUpdatedListener?.()
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (proxyRefreshTimer) window.clearInterval(proxyRefreshTimer)
  if (usageGlowTimer) window.clearTimeout(usageGlowTimer)
})
</script>

<template>
  <main class="h-full w-full overflow-hidden text-foreground" :class="isPanelView && 'p-1'">
    <div v-if="isBallView" class="relative flex h-[78px] w-[78px] items-center justify-center">
      <button
        class="token-reservoir relative flex h-[70px] w-[70px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/15 shadow-2xl shadow-black/40"
        :class="usageGlowActive && 'token-reservoir--glow'"
        :style="{ '--water-level': waterLevel, '--water-color': ballTone, '--remaining-percent': `${remainingPercent}%` }"
        @click="openPanelFromBall"
        @pointerdown="startBallDrag"
        @pointermove="trackBallDrag"
        @pointerup="stopBallDrag"
        @pointercancel="stopBallDrag"
        @contextmenu.prevent="showWindowMenu"
      >
        <span class="token-reservoir__track absolute inset-1 rounded-full" />
        <span class="token-reservoir__center absolute inset-[7px] rounded-full" />
        <span class="relative z-10 flex flex-col items-center leading-none">
          <span class="text-[15px] font-semibold text-white">{{ remainingPercent }}%</span>
          <span class="mt-1 text-[10px] font-medium text-white/64">{{ ballMetricLabel }}</span>
        </span>
      </button>
      <div
        class="absolute bottom-0 right-0 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border border-white/20 bg-black/55 px-1 text-[8px] font-semibold text-white shadow-lg"
        :style="{ color: proxyStatusTone }"
      >
        {{ proxyStatusLabel }}
      </div>
    </div>

    <section v-if="isPanelView" class="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-black/45">
      <header class="drag-region flex h-12 items-center justify-between border-b border-border px-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold leading-4">Quota Float</div>
          <div class="text-[11px] text-muted-foreground">{{ accountCount }} accounts</div>
        </div>
        <div class="no-drag flex items-center gap-1">
          <Button variant="ghost" size="icon" :disabled="loading" @click="refreshActiveTab">
            <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
          </Button>
          <Button variant="ghost" size="icon" @click="setExpanded(false)">
            <ChevronDown class="h-4 w-4" />
          </Button>
        </div>
      </header>

      <nav class="grid grid-cols-3 gap-1 border-b border-border p-2">
        <button
          class="no-drag h-8 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :class="activePanelTab === 'usage' && 'bg-muted text-foreground'"
          @click="activePanelTab = 'usage'"
        >
          用量
        </button>
        <button
          class="no-drag h-8 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :class="activePanelTab === 'proxy' && 'bg-muted text-foreground'"
          @click="activePanelTab = 'proxy'"
        >
          代理
        </button>
        <button
          class="no-drag h-8 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :class="activePanelTab === 'settings' && 'bg-muted text-foreground'"
          @click="activePanelTab = 'settings'"
        >
          设置
        </button>
      </nav>

      <div class="panel-scroll flex-1 overflow-y-auto p-3">
        <div v-if="error" class="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <form v-if="activePanelTab === 'settings'" class="space-y-3 rounded-md border border-border bg-background/55 p-3" @submit.prevent="save">
          <label class="block space-y-1">
            <span class="text-xs text-muted-foreground">Sub2API 地址</span>
            <Input v-model="config.baseUrl" placeholder="http://127.0.0.1:37889" />
          </label>
          <label class="block space-y-1">
            <span class="text-xs text-muted-foreground">管理员 API Key</span>
            <Input v-model="config.adminApiKey" type="password" placeholder="admin-..." />
          </label>
          <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-2">
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">统计分组</span>
              <Select v-model="config.selectedGroupId">
                <SelectTrigger>
                  <SelectValue placeholder="全部分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分组</SelectItem>
                  <SelectItem v-for="group in groups" :key="group.id" :value="group.id">
                    {{ group.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">刷新秒</span>
              <NumberField v-model="refreshIntervalInput" :min="15" :step="15">
                <NumberFieldContent>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
            </label>
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-2">
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">监控代理</span>
              <Select v-model="config.selectedProxyId">
                <SelectTrigger>
                  <SelectValue placeholder="不监控代理" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不监控代理</SelectItem>
                  <SelectItem v-for="proxy in proxies" :key="proxy.id" :value="proxy.id">
                    {{ proxy.name }} · {{ proxy.host }}:{{ proxy.port }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">代理秒</span>
              <NumberField v-model="proxyPollIntervalInput" :min="15" :step="15">
                <NumberFieldContent>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
            </label>
          </div>
          <Button type="submit" class="w-full" :disabled="saving">
            <Save class="h-4 w-4" />
            保存配置
          </Button>
        </form>

        <section v-if="activePanelTab === 'proxy'" class="rounded-md border border-border bg-background/55 p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wifi class="h-3.5 w-3.5" />
                代理监测
              </div>
              <div class="mt-1 truncate text-sm font-medium">
                {{ selectedProxy?.name ?? '未选择代理' }}
              </div>
            </div>
            <span
              class="shrink-0 rounded px-2 py-0.5 text-[11px]"
              :class="proxySnapshot?.result?.success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-secondary text-secondary-foreground'"
            >
              {{ proxySnapshot?.result ? (proxySnapshot.result.success ? '可用' : '异常') : '待监测' }}
            </span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="min-w-0 rounded bg-muted/35 p-2">
              <div class="text-muted-foreground">延迟</div>
              <div class="mt-1 truncate font-medium">{{ formatLatency(proxySnapshot?.result?.latency_ms ?? selectedProxy?.latency_ms) }}</div>
            </div>
            <div class="min-w-0 rounded bg-muted/35 p-2">
              <div class="text-muted-foreground">出口 IP</div>
              <div class="mt-1 truncate font-medium">{{ proxySnapshot?.result?.ip_address ?? selectedProxy?.ip_address ?? '--' }}</div>
            </div>
          </div>
          <div class="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <div class="truncate">{{ proxyEndpoint(selectedProxy) }}</div>
            <div class="truncate">{{ proxyLocation(selectedProxy) }}</div>
            <div class="truncate">{{ proxySnapshot?.result?.message ?? selectedProxy?.quality_summary ?? selectedProxy?.latency_message ?? '暂无结果' }}</div>
          </div>
        </section>

        <div v-if="activePanelTab === 'usage'">
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-md border border-border bg-background/55 p-3">
              <div class="text-xs text-muted-foreground">5h 平均 / 最高</div>
              <div class="mt-1 text-xl font-semibold">{{ snapshot?.summary.fiveHourAverage ?? 0 }}% / {{ snapshot?.summary.fiveHourMax ?? 0 }}%</div>
              <Progress class="mt-2" :value="snapshot?.summary.fiveHourMax ?? 0" :tone="progressTone(snapshot?.summary.fiveHourMax ?? 0)" />
            </div>
            <div class="rounded-md border border-border bg-background/55 p-3">
              <div class="text-xs text-muted-foreground">7d 平均 / 最高</div>
              <div class="mt-1 text-xl font-semibold">{{ snapshot?.summary.sevenDayAverage ?? 0 }}% / {{ snapshot?.summary.sevenDayMax ?? 0 }}%</div>
              <Progress class="mt-2" :value="snapshot?.summary.sevenDayMax ?? 0" :tone="progressTone(snapshot?.summary.sevenDayMax ?? 0)" />
            </div>
          </div>

          <div class="mt-3 space-y-2">
            <article v-for="account in snapshot?.accounts ?? []" :key="account.id" class="rounded-md border border-border bg-background/55 p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">{{ account.name }}</div>
                  <div class="truncate text-xs text-muted-foreground">{{ accountLabel(account) }}</div>
                </div>
                <span class="rounded bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">{{ account.status }}</span>
              </div>
              <div class="mt-3 grid gap-3">
                <div>
                  <div class="mb-1 flex justify-between text-xs">
                    <span class="text-muted-foreground">5h</span>
                    <span>{{ account.fiveHourPercent }}% · {{ formatDate(account.fiveHourResetAt) }}</span>
                  </div>
                  <Progress :value="account.fiveHourPercent" :tone="progressTone(account.fiveHourPercent)" />
                </div>
                <div>
                  <div class="mb-1 flex justify-between text-xs">
                    <span class="text-muted-foreground">7d</span>
                    <span>{{ account.sevenDayPercent }}% · {{ formatDate(account.sevenDayResetAt) }}</span>
                  </div>
                  <Progress :value="account.sevenDayPercent" :tone="progressTone(account.sevenDayPercent)" />
                </div>
              </div>
              <div class="mt-2 truncate text-[11px] text-muted-foreground">
                {{ account.groupNames.join(' / ') || '无分组' }} · 更新 {{ formatDate(account.updatedAt) }}
              </div>
            </article>

            <div v-if="snapshot && snapshot.accounts.length === 0" class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              当前分组没有账号
            </div>
          </div>
        </div>
      </div>

      <footer class="flex h-10 items-center border-t border-border px-3 text-[11px] text-muted-foreground">
        <span>更新 {{ formatDate(snapshot?.updatedAt ?? '') }}</span>
      </footer>
    </section>
  </main>
</template>
