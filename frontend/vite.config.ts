import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    rollupOptions: {
      // optional jspdf features we never call (canvas rasterization, .html());
      // leave their lazy imports unresolved instead of bundling them
      external: ['canvg', 'html2canvas', 'dompurify'],
    },
  },
})
