<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, Save, Settings, X } from '@lucide/vue'
import Button from './components/ui/Button.vue'
import Input from './components/ui/Input.vue'
import Progress from './components/ui/Progress.vue'
import type { AppConfig, UsageAccount, UsageSnapshot } from '../../preload/index'

const defaultConfig: AppConfig = {
  baseUrl: '',
  adminApiKey: '',
  selectedGroupId: 'all',
  refreshIntervalSeconds: 60
}

const expanded = ref(false)
const showSettings = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const config = ref<AppConfig>({ ...defaultConfig })
const refreshIntervalInput = ref(String(defaultConfig.refreshIntervalSeconds))
const snapshot = ref<UsageSnapshot | null>(null)
const ballMetric = ref<'fiveHour' | 'sevenDay'>('fiveHour')
let refreshTimer: number | undefined
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let didDragBall = false
let removePanelExpandedListener: (() => void) | undefined

const fiveHourAveragePercent = computed(() => snapshot.value?.summary.fiveHourAverage ?? 0)
const sevenDayAveragePercent = computed(() => snapshot.value?.summary.sevenDayAverage ?? 0)
const ballAveragePercent = computed(() => {
  return ballMetric.value === 'fiveHour' ? fiveHourAveragePercent.value : sevenDayAveragePercent.value
})
const ballMetricLabel = computed(() => (ballMetric.value === 'fiveHour' ? '5小时' : '7天'))
const accountCount = computed(() => snapshot.value?.summary.accountCount ?? 0)
const groups = computed(() => snapshot.value?.groups ?? [])

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

async function setExpanded(value: boolean): Promise<void> {
  expanded.value = value
  await window.api.setPanelExpanded(value)
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
  if (didDragBall) return
  ballMetric.value = ballMetric.value === 'fiveHour' ? 'sevenDay' : 'fiveHour'
}

function showWindowMenu(): void {
  void window.api.showWindowMenu()
}

async function refresh(): Promise<void> {
  if (!config.value.baseUrl || !config.value.adminApiKey) {
    error.value = '请先完成 Sub2API 配置'
    showSettings.value = true
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

async function save(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    const selectedGroupId =
      config.value.selectedGroupId === 'all' ? 'all' : Number(config.value.selectedGroupId)
    config.value = await window.api.saveConfig({
      baseUrl: config.value.baseUrl,
      adminApiKey: config.value.adminApiKey,
      selectedGroupId,
      refreshIntervalSeconds: Number(refreshIntervalInput.value) || 60
    })
    refreshIntervalInput.value = String(config.value.refreshIntervalSeconds)
    showSettings.value = false
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function resetTimer(): void {
  if (refreshTimer) window.clearInterval(refreshTimer)
  const interval = Math.max(15, config.value.refreshIntervalSeconds) * 1000
  refreshTimer = window.setInterval(refresh, interval)
}

watch(
  () => config.value.refreshIntervalSeconds,
  () => resetTimer()
)

onMounted(async () => {
  removePanelExpandedListener = window.api.onPanelExpandedChanged((value) => {
    expanded.value = value
  })
  config.value = await window.api.getConfig()
  refreshIntervalInput.value = String(config.value.refreshIntervalSeconds)
  showSettings.value = !config.value.baseUrl || !config.value.adminApiKey
  await refresh()
  resetTimer()
})

onBeforeUnmount(() => {
  removePanelExpandedListener?.()
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <main class="h-full w-full overflow-hidden p-1 text-foreground">
    <button
      v-if="!expanded"
      class="token-reservoir relative flex h-[70px] w-[70px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/15 shadow-2xl shadow-black/40"
      :style="{ '--water-level': waterLevel, '--water-color': ballTone }"
      :title="`切换到${ballMetric === 'fiveHour' ? '7天' : '5小时'}`"
      @click="toggleBallMetric"
      @pointerdown="startBallDrag"
      @pointermove="trackBallDrag"
      @pointerup="stopBallDrag"
      @pointercancel="stopBallDrag"
      @contextmenu.prevent="showWindowMenu"
    >
      <span class="token-reservoir__glass absolute inset-0 rounded-full" />
      <span class="token-reservoir__water absolute inset-x-0 bottom-0" />
      <span class="token-reservoir__wave token-reservoir__wave--back absolute left-1/2" />
      <span class="token-reservoir__wave token-reservoir__wave--front absolute left-1/2" />
      <span class="token-reservoir__shine absolute rounded-full" />
      <span class="relative z-10 flex flex-col items-center leading-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.55)]">
        <span class="text-lg font-semibold text-white">{{ remainingPercent }}%</span>
        <span class="mt-1 text-[10px] text-white/72">{{ ballMetricLabel }}</span>
      </span>
    </button>

    <section v-else class="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-black/45">
      <header class="drag-region flex h-12 items-center justify-between border-b border-border px-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold leading-4">Token Ball</div>
          <div class="text-[11px] text-muted-foreground">{{ accountCount }} accounts</div>
        </div>
        <div class="no-drag flex items-center gap-1">
          <Button variant="ghost" size="icon" title="刷新" :disabled="loading" @click="refresh">
            <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
          </Button>
          <Button variant="ghost" size="icon" title="设置" @click="showSettings = !showSettings">
            <Settings class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="收起" @click="setExpanded(false)">
            <ChevronDown class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="关闭面板" @click="setExpanded(false)">
            <X class="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div class="panel-scroll flex-1 overflow-y-auto p-3">
        <div v-if="error" class="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <form v-if="showSettings" class="mb-3 space-y-3 rounded-md border border-border bg-background/55 p-3" @submit.prevent="save">
          <label class="block space-y-1">
            <span class="text-xs text-muted-foreground">Sub2API 地址</span>
            <Input v-model="config.baseUrl" placeholder="http://127.0.0.1:37889" />
          </label>
          <label class="block space-y-1">
            <span class="text-xs text-muted-foreground">管理员 API Key</span>
            <Input v-model="config.adminApiKey" type="password" placeholder="admin-..." />
          </label>
          <div class="grid grid-cols-[1fr_96px] gap-2">
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">统计分组</span>
              <select v-model="config.selectedGroupId" class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="all">全部分组</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
              </select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-muted-foreground">刷新秒</span>
              <Input v-model="refreshIntervalInput" type="number" />
            </label>
          </div>
          <Button type="submit" class="w-full" :disabled="saving">
            <Save class="h-4 w-4" />
            保存配置
          </Button>
        </form>

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

      <footer class="flex h-10 items-center justify-between border-t border-border px-3 text-[11px] text-muted-foreground">
        <span>更新 {{ formatDate(snapshot?.updatedAt ?? '') }}</span>
        <button class="no-drag inline-flex items-center gap-1 hover:text-foreground" @click="setExpanded(false)">
          <ChevronUp class="h-3.5 w-3.5" />
          悬浮球
        </button>
      </footer>
    </section>
  </main>
</template>
