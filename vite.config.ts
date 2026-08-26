import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'oknote-development-csp',
      transformIndexHtml(html) {
        if (command !== 'serve') return html
        return html.replace(
          "connect-src 'none'",
          "connect-src 'self' http://localhost:5199 ws://localhost:5199",
        )
      },
    },
  ],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
