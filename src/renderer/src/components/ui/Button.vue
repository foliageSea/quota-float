<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@renderer/lib/utils'

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'icon'
    class?: string
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'default',
    size: 'md',
    type: 'button'
  }
)

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    {
      'bg-primary text-primary-foreground hover:bg-primary/90': props.variant === 'default',
      'bg-secondary text-secondary-foreground hover:bg-secondary/80': props.variant === 'secondary',
      'hover:bg-accent hover:text-accent-foreground': props.variant === 'ghost',
      'bg-destructive text-destructive-foreground hover:bg-destructive/90': props.variant === 'danger',
      'h-8 px-3': props.size === 'sm',
      'h-10 px-4': props.size === 'md',
      'h-8 w-8': props.size === 'icon'
    },
    props.class
  )
)
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
