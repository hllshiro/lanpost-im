<script setup lang="ts">
import { X } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmText?: string
    busy?: boolean
    error?: string
  }>(),
  { confirmText: '删除', busy: false, error: '' }
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="confirm-mask" @mousedown.self="props.busy || emit('cancel')">
    <div class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="props.title">
      <header class="confirm-head">
        <h2>{{ props.title }}</h2>
        <button class="confirm-close" title="关闭" :disabled="props.busy" @click="emit('cancel')">
          <X :size="16" />
        </button>
      </header>
      <p class="confirm-message">{{ props.message }}</p>
      <p v-if="props.error" class="confirm-error">{{ props.error }}</p>
      <footer class="confirm-foot">
        <button class="confirm-secondary" :disabled="props.busy" @click="emit('cancel')">
          取消
        </button>
        <button class="confirm-danger" :disabled="props.busy" @click="emit('confirm')">
          {{ props.busy ? '处理中…' : props.confirmText }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(20, 24, 28, 0.42);
}

.confirm-dialog {
  width: 380px;
  max-width: calc(100vw - 48px);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
}

.confirm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 6px;
}

.confirm-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.confirm-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
}

.confirm-close:hover:not(:disabled) {
  background: #f1f2f4;
  color: var(--text);
}

.confirm-message {
  margin: 4px 18px 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.confirm-error {
  margin: 8px 18px 0;
  font-size: 12px;
  color: #c0392b;
}

.confirm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 18px 16px;
}

.confirm-secondary,
.confirm-danger {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12px;
}

.confirm-secondary {
  border: 1px solid #dcdcdc;
  background: #ffffff;
  color: var(--text);
}

.confirm-danger {
  border: 0;
  background: #c0392b;
  color: #ffffff;
}

.confirm-danger:disabled,
.confirm-secondary:disabled {
  opacity: 0.6;
}
</style>
