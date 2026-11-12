import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .dev-data 是联调用临时目录，本地 worktree 与临时脚本也不参与测试
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.worktrees/**',
      '**/.tmp-*/**',
      '.dev-data/**'
    ]
  }
})
