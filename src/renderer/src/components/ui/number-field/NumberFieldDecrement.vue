<script setup lang="ts">
import { Minus } from '@lucide/vue'
import { NumberFieldDecrement, type NumberFieldDecrementProps, useForwardProps } from 'reka-ui'
import { cn } from '@renderer/lib/utils'

const props = defineProps<NumberFieldDecrementProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <NumberFieldDecrement
    v-bind="forwarded"
    :class="cn('flex h-full w-8 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50', props.class)"
  >
    <Minus class="h-3.5 w-3.5" />
  </NumberFieldDecrement>
</template>
