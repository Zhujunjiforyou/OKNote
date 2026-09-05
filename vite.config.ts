import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command }) => {
  const requestedPort = Number.parseInt(process.env.VITE_PORT || '5173', 10)
  const devPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 5173

  return {
    plugins: [
      react(),
      {
        name: 'oknote-development-csp',
        transformIndexHtml(html) {
          if (command !== 'serve') return html
          return html.replace(
            "connect-src 'none'",
            `connect-src 'self' http://localhost:${devPort} ws://localhost:${devPort} http://127.0.0.1:${devPort} ws://127.0.0.1:${devPort}`,
          )
        },
      },
    ],
    server: command === 'serve' ? { port: devPort, strictPort: true } : undefined,
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
