// 双主题配色：实际色值全部来自 CSS 变量（见 index.css 的 :root 深色 / .light 日间），
// 用 rgb(var(--x) / <alpha-value>) 形式以保留 bg-xxx/50 这类透明度写法
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 工作台主色板
        panel: v('panel'),
        'panel-2': v('panel-2'),
        'panel-3': v('panel-3'),
        edge: 'var(--edge)',
        ink: v('ink'),
        'ink-dim': v('ink-dim'),
        accent: v('accent'),
        // slate 灰阶整体变量化：深色模式保持原 slate 语义，日间模式整套翻转，
        // 存量 slate-* 类名无需改动即可随主题切换
        slate: {
          50: v('slate-50'),
          100: v('slate-100'),
          200: v('slate-200'),
          300: v('slate-300'),
          400: v('slate-400'),
          500: v('slate-500'),
          600: v('slate-600'),
          700: v('slate-700'),
          800: v('slate-800'),
          900: v('slate-900'),
          950: v('slate-950')
        }
      }
    }
  },
  plugins: []
}
