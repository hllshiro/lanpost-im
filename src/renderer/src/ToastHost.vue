<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { NotifyToastItem } from '../../shared/ipc'
import NotifyToast from './components/NotifyToast.vue'

const toasts = ref<NotifyToastItem[]>([])
let unsubscribe: (() => void) | null = null

function handleJump(conversationId: string): void {
  window.api.ui.jumpToConversation(conversationId)
}

onMounted(() => {
  // 独立标题：主进程按标题从同进程的窗口里认出主窗口（弹窗窗口不叫这个名）
  document.title = 'lanpost-toast'
  unsubscribe = window.api.ui.onToastList((payload) => {
    toasts.value = payload.toasts
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <NotifyToast v-if="toasts.length > 0" :toasts="toasts" @jump="handleJump" />
</template>

<style>
/* 弹窗窗口本身透明，内容之外的区域不抢点击 */
html,
body {
  margin: 0;
  background: transparent;
  overflow: hidden;
}
</style>
