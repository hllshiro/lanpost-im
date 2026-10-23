<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '../../shared/ipc'

const info = ref<AppInfo | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    info.value = await window.api.app.info()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
})
</script>

<template>
  <main class="boot">
    <div class="logo">✉️</div>
    <h1>{{ info?.name ?? '内网传书' }}</h1>
    <p v-if="info">版本 {{ info.version }} · {{ info.platform }}</p>
    <p v-else-if="error" class="error">无法连接主进程：{{ error }}</p>
    <p v-else>正在加载…</p>
  </main>
</template>

<style scoped>
.boot {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #f5f5f5;
  color: #191919;
}
.logo {
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: #07c160;
  font-size: 36px;
}
h1 {
  margin: 8px 0 0;
  font-size: 20px;
  font-weight: 600;
}
p {
  margin: 0;
  font-size: 13px;
  color: #999999;
}
.error {
  color: #d33b3b;
}
</style>
