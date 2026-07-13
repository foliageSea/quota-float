<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Color } from 'reka-ui'
import {
  ColorAreaArea,
  ColorAreaRoot,
  ColorAreaThumb,
  ColorFieldInput,
  ColorFieldRoot,
  ColorSliderRoot,
  ColorSliderThumb,
  ColorSliderTrack,
  ColorSwatch,
  colorToString,
  normalizeColor
} from 'reka-ui'
import { Pipette } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const color = ref<Color>(normalizeColor(props.modelValue))
const hexColor = computed(() => colorToString(color.value, 'hex').toLowerCase())

watch(
  () => props.modelValue,
  (value) => {
    if (/^#[0-9a-f]{6}$/i.test(value) && value.toLowerCase() !== hexColor.value) {
      color.value = normalizeColor(value)
    }
  }
)

function updateColor(value: Color): void {
  color.value = value
  emit('update:modelValue', colorToString(value, 'hex').toLowerCase())
}

function updateHex(value: string | number): void {
  const hex = String(value).trim()
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return
  color.value = normalizeColor(hex)
  emit('update:modelValue', hex.toLowerCase())
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="no-drag flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 font-mono text-sm uppercase text-foreground shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ColorSwatch
          :color="hexColor"
          class="h-4 w-4 rounded-sm border border-white/15"
          :style="{ backgroundColor: 'var(--reka-color-swatch-color)' }"
        />
        <span>{{ hexColor }}</span>
        <Pipette class="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[280px] gap-3 p-3">
      <div class="flex items-center gap-2">
        <ColorSwatch
          :color="hexColor"
          class="h-8 w-8 rounded-md border border-white/15"
          :style="{ backgroundColor: 'var(--reka-color-swatch-color)' }"
        />
        <div class="min-w-0">
          <div class="text-xs font-medium">主题色</div>
          <code class="text-xs uppercase text-muted-foreground">{{ hexColor }}</code>
        </div>
      </div>

      <ColorAreaRoot
        v-slot="{ style }"
        :model-value="color"
        color-space="hsl"
        x-channel="saturation"
        y-channel="lightness"
        @update:color="updateColor"
      >
        <ColorAreaArea
          class="relative h-[128px] w-full overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          :style="style"
        >
          <ColorAreaThumb
            class="block h-4 w-4 cursor-pointer rounded-full border-2 border-white bg-white shadow-md transition-transform hover:scale-110 focus:outline-none"
          />
        </ColorAreaArea>
      </ColorAreaRoot>

      <ColorSliderRoot
        :model-value="color"
        channel="hue"
        color-space="hsl"
        class="relative flex h-5 w-full items-center"
        aria-label="色相"
        @update:color="updateColor"
      >
        <ColorSliderTrack class="color-picker__hue relative h-2 flex-1 rounded-full" />
        <ColorSliderThumb
          class="block h-4 w-4 cursor-pointer rounded-full border-2 border-white bg-white shadow-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </ColorSliderRoot>

      <ColorFieldRoot :model-value="hexColor" @update:model-value="updateHex">
        <ColorFieldInput
          class="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm uppercase text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="#20C997"
          aria-label="十六进制主题色"
        />
      </ColorFieldRoot>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.color-picker__hue {
  background: linear-gradient(
    to right,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
}
</style>
