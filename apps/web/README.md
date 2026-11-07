# VisionGuard web workspace

This is the React, TypeScript and Vite frontend of [VisionGuard](../../README.md).

Run commands from the repository root:

```powershell
npm install
npm run dev
npm run build
npm run test -w web
```

Or from this folder: `npm run dev`.

The live analysis page uses `public/models/yolo11s.onnx`. Model weights are **not committed**. The viewer supports local video files, device-camera permission and explicitly approved Edge/Chrome browser-tab capture. Camera-sharing permission does not persist across browser restarts.

**Configuration:** Copy `.env.example` to `.env.local` in this **same directory** (not only at repo root) and supply your public Supabase URL/publishable key. Original video cloud uploads use the Backblaze B2 server-side signing service. Do not put private keys in `VITE_*` variables.

See [live video usage](../../docs/LIVE_ANALYSIS.md) and [Google OAuth setup](../../docs/GOOGLE_SIGN_IN.md).
