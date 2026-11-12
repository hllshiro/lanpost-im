import './assets/app.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// 文件拖到窗口任何位置都不能让浏览器把当前页面替换成那个文件
function blockFileDrop(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
  }
}

window.addEventListener('dragover', blockFileDrop)
window.addEventListener('drop', blockFileDrop)

createApp(App).use(createPinia()).mount('#app')
