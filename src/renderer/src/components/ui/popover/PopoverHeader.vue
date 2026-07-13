<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@renderer/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div data-slot="popover-header" :class="cn('flex flex-col gap-1 text-sm', props.class)">
    <slot />
  </div>
</template>
