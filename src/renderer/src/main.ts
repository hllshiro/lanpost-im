import './assets/app.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ToastHost from './ToastHost.vue'
import TrayPopup from './TrayPopup.vue'

// 文件拖到窗口任何位置都不能让浏览器把当前页面替换成那个文件
function blockFileDrop(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
  }
}

window.addEventListener('dragover', blockFileDrop)
window.addEventListener('drop', blockFileDrop)

// 主窗口、通知弹窗窗口、悬停未读列表共用一个入口，按查询参数分支
const windowKind = new URLSearchParams(window.location.search).get('window')
const root = windowKind === 'toast' ? ToastHost : windowKind === 'tray-popup' ? TrayPopup : App
createApp(root).use(createPinia()).mount('#app')
