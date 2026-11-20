<script setup lang="ts">
import { TOAST_LAYOUT, type NotifyToastItem } from '../../../shared/ipc'

defineProps<{ toasts: NotifyToastItem[] }>()
const emit = defineEmits<{ jump: [conversationId: string] }>()

// 尺寸取自 shared 常量，与主进程弹窗窗口的 bounds 计算保持一致
const cardStyle = {
  width: `${TOAST_LAYOUT.width - TOAST_LAYOUT.padding * 2}px`,
  height: `${TOAST_LAYOUT.cardHeight}px`
}
const stackStyle = {
  right: `${TOAST_LAYOUT.padding}px`,
  bottom: `${TOAST_LAYOUT.padding}px`,
  gap: `${TOAST_LAYOUT.gap}px`
}
</script>

<template>
  <div class="toast-stack" :style="stackStyle">
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
  z-index: 60;
  display: flex;
  flex-direction: column;
  /* 空列表与缝隙不拦截主窗口操作 */
  pointer-events: none;
}

.notify-toast {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #ffffff;
  color: var(--text);
  text-align: left;
  box-shadow: 0 8px 24px rgba(20, 30, 50, 0.16);
  cursor: pointer;
  overflow: hidden;
  pointer-events: auto;
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
