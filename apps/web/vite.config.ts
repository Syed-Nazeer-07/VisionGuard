import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vitest/config'

function serveOnnxWasmPlugin(): Plugin {
  return {
    name: 'serve-onnx-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/ort-wasm')) {
          const cleanPath = req.url.split('?')[0]
          const filePath = path.join(process.cwd(), 'public', cleanPath)
          if (fs.existsSync(filePath)) {
            const ext = path.extname(cleanPath)
            res.setHeader('Content-Type', ext === '.wasm' ? 'application/wasm' : 'application/javascript')
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
            res.writeHead(200)
            fs.createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [serveOnnxWasmPlugin(), react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
