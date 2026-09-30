import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// 与 electron.vite.config.ts 的 renderer/main 别名保持一致：
// 主进程 store 源码用 @shared/... 引入共享类型与纯函数，测试侧必须能同样解析
export default defineConfig({
  // 渲染层组件测试（react-dom/server）走 tsconfig 的 react-jsx 自动运行时；
  // esbuild 默认是 classic，缺这行会在渲染组件时报「React is not defined」
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  }
})
