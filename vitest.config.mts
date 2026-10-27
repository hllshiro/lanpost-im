import { globSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const misplaced = globSync('src/**/*.test.ts')
if (misplaced.length > 0) {
  throw new Error(`测试文件必须放在 tests/ 下，发现：${misplaced.join(', ')}`)
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
