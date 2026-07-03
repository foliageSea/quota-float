<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { NumberFieldIncrement, type NumberFieldIncrementProps, useForwardProps } from 'reka-ui'
import { cn } from '@renderer/lib/utils'

const props = defineProps<NumberFieldIncrementProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <NumberFieldIncrement
    v-bind="forwarded"
    :class="cn('flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50', props.class)"
  >
    <Plus class="h-3.5 w-3.5" />
  </NumberFieldIncrement>
</template>
