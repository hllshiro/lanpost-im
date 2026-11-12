<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { X } from '@lucide/vue'
import type { FileTaskInfo } from '../../../shared/domain'

const props = defineProps<{
  file: FileTaskInfo
}>()

const emit = defineEmits<{
  close: []
}>()

const imageUrl = computed(() => `lanpost-file:///${encodeURIComponent(props.file.id)}`)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="viewer"
    role="dialog"
    aria-modal="true"
    :aria-label="file.name"
    @click="emit('close')"
  >
    <img class="viewer-image" :src="imageUrl" :alt="file.name" />
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
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}

.viewer-image {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
  object-fit: contain;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
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
