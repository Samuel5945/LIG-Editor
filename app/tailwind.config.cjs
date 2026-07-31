module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 深色工作台配色
        panel: '#1b1d23',
        'panel-2': '#22252d',
        'panel-3': '#2a2e38',
        edge: '#33384455',
        ink: '#e2e4ea',
        'ink-dim': '#9aa0ad',
        accent: '#4f8cff'
      }
    }
  },
  plugins: []
}
