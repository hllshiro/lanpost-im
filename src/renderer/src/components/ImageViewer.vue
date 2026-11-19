<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import type { FileTaskInfo } from '../../../shared/domain'

const props = defineProps<{
  file: FileTaskInfo
}>()

const emit = defineEmits<{
  close: []
}>()

const imageUrl = computed(() => `lanpost-file:///${encodeURIComponent(props.file.id)}`)

const MIN_ZOOM = 0.2
const MAX_ZOOM = 6

const imageEl = ref<HTMLImageElement | null>(null)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
// 按下后是否发生了位移，用来区分“点击关闭”和“拖动平移”
const dragged = ref(false)

const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`)

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${zoom.value})`
}))

let pointerStart = { x: 0, y: 0 }
let offsetStart = { x: 0, y: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// 图片的可视区域始终留在窗口里：缩小状态下不越界，放大状态下不留空白
function clampOffsets(): void {
  const image = imageEl.value
  if (image === null) return
  const viewer = image.parentElement
  if (viewer === null) return
  const style = window.getComputedStyle(viewer)
  const availableWidth =
    viewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const availableHeight =
    viewer.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  const scaledWidth = image.offsetWidth * zoom.value
  const scaledHeight = image.offsetHeight * zoom.value
  const limitX = Math.abs(scaledWidth - availableWidth) / 2
  const limitY = Math.abs(scaledHeight - availableHeight) / 2
  offsetX.value = clamp(offsetX.value, -limitX, limitX)
  offsetY.value = clamp(offsetY.value, -limitY, limitY)
}

function setZoom(next: number, anchorX = 0, anchorY = 0): void {
  const target = clamp(next, MIN_ZOOM, MAX_ZOOM)
  if (target === zoom.value) return
  // 让光标指住的那个点在缩放前后保持在原地
  const ratio = target / zoom.value
  offsetX.value = anchorX - ratio * (anchorX - offsetX.value)
  offsetY.value = anchorY - ratio * (anchorY - offsetY.value)
  zoom.value = target
  clampOffsets()
}

function onWheel(event: WheelEvent): void {
  const viewer = event.currentTarget as HTMLElement
  const rect = viewer.getBoundingClientRect()
  const anchorX = event.clientX - (rect.left + rect.width / 2)
  const anchorY = event.clientY - (rect.top + rect.height / 2)
  setZoom(zoom.value * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchorX, anchorY)
}

function toggleZoom(): void {
  if (zoom.value > 1.01) {
    zoom.value = 1
    offsetX.value = 0
    offsetY.value = 0
    return
  }
  setZoom(2)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest('button') !== null) return
  dragging.value = true
  dragged.value = false
  pointerStart = { x: event.clientX, y: event.clientY }
  offsetStart = { x: offsetX.value, y: offsetY.value }
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const dx = event.clientX - pointerStart.x
  const dy = event.clientY - pointerStart.y
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged.value = true
  offsetX.value = offsetStart.x + dx
  offsetY.value = offsetStart.y + dy
  clampOffsets()
}

// 不做 setPointerCapture：捕获会把 click 改指向遮罩层，点图片就被当成点空白
function onPointerUp(): void {
  dragging.value = false
}

// 只有点空白处才关闭；拖动结束不算点击
function onBackdropClick(event: MouseEvent): void {
  if (dragged.value) {
    dragged.value = false
    return
  }
  if (event.target !== event.currentTarget) return
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === '0') {
    zoom.value = 1
    offsetX.value = 0
    offsetY.value = 0
  }
  if (event.key === '+' || event.key === '=') setZoom(zoom.value * 1.2)
  if (event.key === '-') setZoom(zoom.value / 1.2)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', clampOffsets)
  window.addEventListener('pointerup', onPointerUp)
  clampOffsets()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', clampOffsets)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <div
    class="viewer"
    :class="{ dragging }"
    role="dialog"
    aria-modal="true"
    :aria-label="file.name"
    @click="onBackdropClick"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <img
      ref="imageEl"
      class="viewer-image"
      :src="imageUrl"
      :alt="file.name"
      :style="imageStyle"
      draggable="false"
      @load="clampOffsets"
      @dblclick.stop="toggleZoom"
    />
    <p class="viewer-hint">滚轮缩放 · 拖动平移 · 双击放大或还原 · 点击空白关闭</p>
    <span class="viewer-zoom">{{ zoomText }}</span>
    <button class="viewer-close" aria-label="关闭" @click.stop="emit('close')">
      <X :size="18" :stroke-width="2" />
    </button>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 28px;
  background: rgba(0, 0, 0, 0.82);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.viewer.dragging {
  cursor: grabbing;
}

.viewer-image {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
  object-fit: contain;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  transform-origin: center center;
  cursor: zoom-in;
}

.viewer-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  margin: 0;
  transform: translateX(-50%);
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  pointer-events: none;
}

.viewer-zoom {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  font-size: 11.5px;
  pointer-events: none;
}

.viewer-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.viewer-close:hover {
  background: rgba(255, 255, 255, 0.26);
}
</style>
