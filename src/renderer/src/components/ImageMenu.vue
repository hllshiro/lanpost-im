<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { FolderOpen, Link2, Save } from '@lucide/vue'
import type { FileTaskInfo } from '../../../shared/domain'
import { useAppStore } from '../stores/app'
import { errorMessage } from '../utils/errors'

const props = defineProps<{
  file: FileTaskInfo
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useAppStore()

const MENU_WIDTH = 176
const MENU_HEIGHT = 118

const position = computed(() => ({
  left: `${Math.max(8, Math.min(props.x, window.innerWidth - MENU_WIDTH - 8))}px`,
  top: `${Math.max(8, Math.min(props.y, window.innerHeight - MENU_HEIGHT - 8))}px`
}))

// 点完就把菜单收掉：后面的系统对话框会接管界面，不需要菜单再留着
async function run(action: () => Promise<void>): Promise<void> {
  emit('close')
  try {
    await action()
  } catch (reason) {
    store.reportError(errorMessage(reason))
  }
}

function saveAs(): void {
  void run(() => window.api.files.saveAs(props.file.id))
}

function reveal(): void {
  void run(() => window.api.files.reveal(props.file.id))
}

function copyPath(): void {
  void run(() => navigator.clipboard.writeText(props.file.path))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="menu-layer"
    @click="emit('close')"
    @contextmenu.prevent="emit('close')"
    @wheel="emit('close')"
  >
    <div class="menu" role="menu" :style="position" @click.stop>
      <button class="menu-item" role="menuitem" @click="saveAs">
        <Save :size="14" :stroke-width="1.8" />
        <span>另存为…</span>
      </button>
      <button class="menu-item" role="menuitem" @click="reveal">
        <FolderOpen :size="14" :stroke-width="1.8" />
        <span>在文件夹中显示</span>
      </button>
      <button class="menu-item" role="menuitem" @click="copyPath">
        <Link2 :size="14" :stroke-width="1.8" />
        <span>复制图片路径</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-layer {
  position: fixed;
  inset: 0;
  z-index: 110;
}

.menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 176px;
  padding: 4px;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 4px;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}

.menu-item:hover:not(:disabled) {
  background: var(--hover);
}

.menu-item:disabled {
  color: var(--text-muted);
}
</style>
