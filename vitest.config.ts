import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .dev-data 是联调用临时目录，里面的第三方仓库样本不参与测试
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '.dev-data/**']
  }
})
