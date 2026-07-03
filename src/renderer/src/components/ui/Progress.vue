<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: number
  tone?: 'good' | 'warn' | 'danger'
}>()

const width = computed(() => `${Math.min(100, Math.max(0, props.value))}%`)
const color = computed(() => {
  if (props.tone === 'danger') return 'bg-destructive'
  if (props.tone === 'warn') return 'bg-warning'
  return 'bg-primary'
})
</script>

<template>
  <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
    <div class="h-full rounded-full transition-all" :class="color" :style="{ width }" />
  </div>
</template>
