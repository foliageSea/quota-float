<script setup lang="ts">
import { SelectValue, type SelectValueProps } from 'reka-ui'

defineProps<SelectValueProps>()
</script>

<template>
  <SelectValue v-bind="$props" />
</template>
