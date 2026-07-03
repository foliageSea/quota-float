<script setup lang="ts">
import { SelectContent, SelectPortal, SelectViewport, type SelectContentProps, useForwardProps } from 'reka-ui'
import { cn } from '@renderer/lib/utils'

const props = defineProps<SelectContentProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="forwarded"
      :class="
        cn(
          'relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
          props.class
        )
      "
    >
      <SelectViewport class="p-1">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
