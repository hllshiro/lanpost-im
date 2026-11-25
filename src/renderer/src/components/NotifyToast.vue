<script setup lang="ts">
import { TOAST_LAYOUT, type NotifyToastItem } from '../../../shared/ipc'

defineProps<{ toasts: NotifyToastItem[] }>()
const emit = defineEmits<{ jump: [conversationId: string] }>()

// 高度取自 shared 常量，窗口按卡片数累加高度，卡片铺满整个窗口
const cardStyle = { height: `${TOAST_LAYOUT.cardHeight}px` }
</script>

<template>
  <div class="toast-stack">
    <button
      v-for="item in toasts"
      :key="item.conversationId"
      class="notify-toast"
      :style="cardStyle"
      type="button"
      @click="emit('jump', item.conversationId)"
    >
      <strong>{{ item.title }}</strong>
      <span>{{ item.body }}</span>
    </button>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.notify-toast {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  width: 100%;
  min-height: 0;
  padding: 8px 12px;
  border: 0;
  border-right: 1px solid #c9c9c9;
  border-bottom: 1px solid #c9c9c9;
  border-left: 4px solid var(--accent);
  background: #ffffff;
  color: var(--text);
  text-align: left;
  overflow: hidden;
}

.notify-toast:first-child {
  border-top: 1px solid #c9c9c9;
}

.notify-toast:hover {
  background: #f4f4f4;
}

.notify-toast strong {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-toast span {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
