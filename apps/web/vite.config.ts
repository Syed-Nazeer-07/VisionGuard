import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vitest/config'

const require = createRequire(import.meta.url)

/**
 * Dev server: serves ONNX Runtime Web's WebAssembly artifacts straight from the installed
 * `onnxruntime-web` package, so the binaries always match the JS runtime version (no stale copies
 * in /public). Unknown `/ort-wasm*` paths return 404 instead of falling through to the SPA
 * index.html (which is what produced "expected magic word 00 61 73 6d, found 3c 21 64 6f").
 * The worker points `env.wasm.wasmPaths` at '/' in dev only.
 *
 * Production builds need no plugin: Vite resolves ORT's own
 * `new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url)` and emits the matching binary as a
 * hashed asset under /assets.
 */
function onnxRuntimeWasmDevPlugin(): Plugin {
  // The package entry Node resolves (dist/ort.node.min.js) lives alongside the runtime artifacts.
  const ortDist = path.dirname(require.resolve('onnxruntime-web'))
  const ORT_ARTIFACT = /^ort-wasm-simd-threaded(\.[a-z]+)?\.(wasm|mjs)$/

  return {
    name: 'visionguard-onnxruntime-wasm',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? ''
        if (!pathname.startsWith('/ort-wasm')) return next()

        const fileName = pathname.slice(1)
        const filePath = path.join(ortDist, fileName)
        if (!ORT_ARTIFACT.test(fileName) || !fs.existsSync(filePath)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end(`ONNX Runtime artifact not found in onnxruntime-web/dist: ${fileName}`)
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.setHeader('Content-Length', fs.statSync(filePath).size)
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [onnxRuntimeWasmDevPlugin(), react(), tailwindcss()],
  optimizeDeps: {
    // Pre-bundling relocates ORT's module and breaks its import.meta.url-relative loading.
    exclude: ['onnxruntime-web'],
  },
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
