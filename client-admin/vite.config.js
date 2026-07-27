import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:30001',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (normalizedId.includes('node_modules/echarts') || normalizedId.includes('node_modules/zrender')) {
            return 'vendor-echarts'
          }
          if (normalizedId.includes('node_modules/@popperjs')) {
            return 'vendor-popper'
          }
          if (normalizedId.includes('node_modules/@element-plus/icons-vue')) {
            return 'vendor-element-plus'
          }
          if (normalizedId.includes('node_modules/element-plus/es/components')) {
            return 'vendor-element-plus-components'
          }
          if (normalizedId.includes('node_modules/element-plus')) {
            return 'vendor-element-plus'
          }
        }
      }
    },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  }
})
