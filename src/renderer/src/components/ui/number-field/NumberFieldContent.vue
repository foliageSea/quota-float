<script setup lang="ts">
import { cn } from '@renderer/lib/utils'

defineProps<{
  class?: string
}>()
</script>

<template>
  <div :class="cn('flex h-9 w-full min-w-[128px] items-center rounded-md border border-input bg-background shadow-sm', $props.class)">
    <slot />
  </div>
</template>
