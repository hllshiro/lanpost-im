<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '../../shared/ipc'

const info = ref<AppInfo | null>(null)

onMounted(async () => {
  info.value = await window.api.app.info()
})
</script>

<template>
  <main class="boot">
    <div class="logo">✉️</div>
    <h1>{{ info?.name ?? '内网传书' }}</h1>
    <p v-if="info">版本 {{ info.version }} · {{ info.platform }}</p>
    <p v-else>正在加载…</p>
  </main>
</template>

<style scoped>
.boot {
  min-height: 100vh;
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
</style>
