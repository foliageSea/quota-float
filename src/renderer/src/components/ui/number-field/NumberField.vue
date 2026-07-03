<script setup lang="ts">
import { NumberFieldRoot, type NumberFieldRootEmits, type NumberFieldRootProps, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<NumberFieldRootProps>()
const emits = defineEmits<NumberFieldRootEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <NumberFieldRoot v-bind="forwarded">
    <slot />
  </NumberFieldRoot>
</template>
