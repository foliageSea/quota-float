<script setup lang="ts">
import { NumberFieldInput, type NumberFieldInputProps, useForwardProps } from 'reka-ui'
import { cn } from '@renderer/lib/utils'

const props = defineProps<NumberFieldInputProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <NumberFieldInput
    v-bind="forwarded"
    :class="cn('h-full min-w-[3rem] flex-1 bg-transparent px-2 text-center text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
