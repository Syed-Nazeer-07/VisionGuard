import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vitest/config'

const require = createRequire(import.meta.url)

// Resolve the version actually installed by npm after optional native-binding
// repairs. Using the identical ORT build on a public CDN is mandatory:
// different JS/WASM versions can fail to initialize or silently malfunction.
const ortPackagePath = path.resolve(path.dirname(require.resolve('onnxruntime-web')), '..', 'package.json')
const ortVersion = JSON.parse(fs.readFileSync(ortPackagePath, 'utf8')).version as string
const ortWasmCdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
const benchmarkHeaders = process.env.VISIONGUARD_BENCH_ISOLATION === '1' ? {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} : undefined

/**
 * Dev server: serves ONNX Runtime Web's WebAssembly artifacts straight from the installed
 * `onnxruntime-web` package, so the binaries always match the JS runtime version (no stale copies
 * in /public). Unknown `/ort-wasm*` paths return 404 instead of falling through to the SPA
 * index.html (which is what produced "expected magic word 00 61 73 6d, found 3c 21 64 6f").
 * The worker points `env.wasm.wasmPaths` at '/' in dev only.
 *
 * The production CPU runtime uses its bundled, hashed WASM asset.
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
        // The WASM module is also the entry point for Emscripten's nested workers.
        for (const [header, value] of Object.entries(benchmarkHeaders ?? {})) {
          res.setHeader(header, value)
        }
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __ORT_WASM_CDN_BASE__: JSON.stringify(ortWasmCdnBase),
  },
  plugins: [onnxRuntimeWasmDevPlugin(), react(), tailwindcss()],
  optimizeDeps: {
    // Pre-bundling relocates ORT's module and breaks its import.meta.url-relative loading.
    exclude: ['onnxruntime-web', 'onnxruntime-web/webgpu', 'onnxruntime-web/wasm'],
  },
  worker: { format: 'es' },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
    // Opt-in parity with the production headers for local WASM thread benchmarks.
    headers: benchmarkHeaders,
  },
  preview: { headers: benchmarkHeaders },
  test: {
    environment: 'happy-dom',
    // Run both logic tests and React component (.tsx) smoke tests.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
