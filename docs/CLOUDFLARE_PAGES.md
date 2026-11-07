# Deploy VisionGuard on Cloudflare Pages

VisionGuard's React/Vite frontend and YOLO11s browser inference can run on
Cloudflare Pages. This does **not** host the optional Python/FastAPI backend,
which is unnecessary for the core browser analysis flow.

**Current status:** Repository deployment configuration is prepared. A
Cloudflare account owner must still connect the repository and configure the
external model and Supabase account. A green CI run is not a deployed website.

## 1. Host the YOLO11s model

Cloudflare Pages imposes a **25 MiB per-file maximum**. Model weights are not
tracked in VisionGuard's Git repository, so a Git-based build cannot bundle
untracked local ONNX files.

**Recommended: an external, public HTTPS model host such as Cloudflare R2.**

1. Obtain a **licensed YOLO11s ONNX export** compatible with the frontend
   640x640 COCO decoder. See [model setup](MODEL_SETUP.md).
2. Create a **separate public R2 bucket for model weights**, not the private
   Backblaze B2 user video bucket, and upload the ONNX model.
3. Use a **custom domain** for production R2 traffic. The r2.dev development
   endpoint is rate-limited and not intended for production.
4. Configure R2 CORS to allow **GET and HEAD** from your exact website origin,
   for example https://YOUR-SITE.pages.dev. Add localhost:3000 separately
   only for local development as needed.
5. Verify that both HEAD and GET succeed and return an ONNX binary response,
   not an HTML fallback/error page.
6. Set the public, HTTPS object URL ending in .onnx as VITE_YOLO_MODEL_URL.

A model **no larger than 25 MiB** may alternatively be packaged under
apps/web/public/models/yolo11s.onnx if you arrange a compliant model
provisioning step before the Git build. The app's production guard will fail
when neither model option is configured.

**Public R2 weights can be downloaded by anyone.** Confirm the model license
allows hosting/distribution and do not put secrets in model URLs.

## 2. Create the Cloudflare Pages project

Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) →
**Workers & Pages → Create → Pages → Connect to Git**, and select the
**Syed-Nazeer-07/VisionGuard** GitHub repository.

Use these precise values:

| Cloudflare setting | Value |
| --- | --- |
| Production branch | main |
| Framework preset | Vite (or None with these manual settings) |
| Root directory | / (repository root) |
| Build command | npm run build:pages |
| Build output directory | apps/web/dist |
| Node.js version | 22 |

The root matters because VisionGuard uses npm workspaces. Cloudflare installs
dependencies during Git builds. Set NODE_VERSION=22 as a Pages build variable.

## 3. Set production build variables

In Pages **Settings → Variables and Secrets** configure:

| Variable | Value |
| --- | --- |
| NODE_VERSION | 22 |
| VITE_SUPABASE_URL | HTTPS URL for your real Supabase project |
| VITE_SUPABASE_ANON_KEY | **Public** Supabase publishable key |
| VITE_VIDEO_STORAGE_PROVIDER | b2 |
| VITE_YOLO_MODEL_URL | HTTPS public URL for the compatible ONNX file |

These VITE_* values are embedded into browser JavaScript. Never insert
Supabase secret/service-role keys, Google OAuth client secrets, B2 application
keys, or private signed video links.

The command **npm run build:pages** builds the frontend and checks that public
Supabase configuration and a model location are supplied, that the static
security headers are present, and that no generated file exceeds Pages'
25 MiB maximum. **npm run test:deploy** tests these release checks.
Passing this guard does **not** guarantee the external model actually works.

## 4. Configure redirects and Google login

After your first deploy, Cloudflare gives you the actual site URL, e.g.
https://YOUR-SITE.pages.dev. In **Supabase → Authentication → URL
Configuration**, set that site's URL and allow:

- https://YOUR-SITE.pages.dev/login (signup confirmation and OAuth)
- https://YOUR-SITE.pages.dev/reset-password (email password reset)
- Localhost:3000 equivalents, only if needed for local development

For Google OAuth, the Google Cloud Web Client must authorize **Supabase's**
callback, not the frontend login route. The staging project uses:

~~~text
https://wpkwxlhwjkgtvyersust.supabase.co/auth/v1/callback
~~~

The Google provider in Supabase must also be enabled with its server-side
client ID and secret. See [Google sign-in guide](GOOGLE_SIGN_IN.md).
The staging project previously returned **provider is not enabled**.

## 5. Deploy and verify

Click **Save and Deploy** in Pages; subsequent main-branch pushes will
automatically trigger new builds. Verify the **real HTTPS deployment**:

1. Landing, signup, confirmation, password recovery and Google OAuth.
2. Model initialization: public ONNX HEAD and GET succeed, proper CORS,
   binary model rather than index.html or an HTML error.
3. Vehicle tracking, disappearing boxes, approximate speeds, fullscreen,
   auto-generated **pending-review** incidents, and the original video controls.
4. Browser-tab sharing consent, focus changes and webcam permissions.
5. Dashboard, Analytics, History, Incidents and report exports after a reload.
6. If configured, Backblaze B2 signed upload, CORS/GET/Range, playback and
   re-analysis. Keep all user video objects private.
7. Cross-account isolation, server RLS, backups, rate limits and device tests.

See the [release acceptance checklist](RELEASE_CHECKLIST.md).
The existing apps/web/public/_headers carries Cloudflare security/cache
headers. The external model host must support the required CORS; never
remove isolation controls merely to conceal CORS failures.

## Limits, availability and costs

Cloudflare Pages Free has **500 builds per month**, **25 MiB per static
asset** and **20,000 static files** under current published limits. Static
Pages hosting does not put the application to sleep like an idle Python
service. But Supabase Free can pause or hit quotas, R2 and Backblaze B2
have their own limits/costs, and inference performance depends on each
visitor's WebGPU/WASM/browser hardware. No plan provides genuinely
unlimited free compute, storage and database use.

References: [Pages build setup](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[R2 public bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
