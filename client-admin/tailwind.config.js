/**
 * 管理端 Tailwind 配置。
 * 关闭 Preflight 并增加前缀，避免影响 Element Plus 与现有桌面样式。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  prefix: 'tw-',
  corePlugins: {
    preflight: false
  },
  theme: {
    screens: {
      md: '768px',
      lg: '960px'
    },
    extend: {}
  },
  plugins: []
}
