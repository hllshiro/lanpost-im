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
  // 独立标题：CDP 脚本与窗口列表里据此认出弹窗窗口
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
/* 卡片铺满窗口，页面本身不留底色 */
:root,
html body,
#app {
  margin: 0;
  background: transparent;
}

html,
body {
  overflow: hidden;
}
</style>
