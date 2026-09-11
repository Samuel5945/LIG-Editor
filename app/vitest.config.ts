import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// 与 electron.vite.config.ts 的 renderer/main 别名保持一致：
// 主进程 store 源码用 @shared/... 引入共享类型与纯函数，测试侧必须能同样解析
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  }
})
