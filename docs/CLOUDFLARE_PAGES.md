# Deploy VisionGuard on Cloudflare (Workers or Pages)

## Your existing `visionguard` Cloudflare Worker

**Keep your existing project.** The dashboard shows **Workers Builds** with
`npx wrangler deploy`. VisionGuard now has a root `wrangler.jsonc` configured
to publish `./apps/web/dist` as static assets and serve React Router paths
with `single-page-application` fallback. The existing `_headers` security
rules also apply to Worker static assets.

In **Workers & Pages → visionguard → Settings → Build**, use:

| Cloudflare setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build:pages` |
| Deploy command | `npx wrangler deploy` |
| Node.js version | `22` (root `.nvmrc` included) |

The latest Cloudflare screenshot now lists the build-variable names. Check
that each value is saved and correct; the list displays names, not values.

In **Settings → Build → Build Variables and Secrets**, add the *build-time*
settings:

- `NODE_VERSION=22`
- `VITE_SUPABASE_URL=https://wpkwxlhwjkgtvyersust.supabase.co`
  (if you are using the existing staging project)
- `VITE_SUPABASE_ANON_KEY` — your **public** Supabase publishable key
- `VITE_VIDEO_STORAGE_PROVIDER=b2`
- `VITE_YOLO_MODEL_URL=https://huggingface.co/SyedNazeer07/visionguard-yolo11s/resolve/main/yolo11s.onnx`
  — your uploaded public model URL. Confirm the model's licence permits public distribution.

**Build variables are different from Workers runtime Variables and Secrets.**
Vite must see the `VITE_*` values at build time. Never expose a Google
OAuth secret, Supabase service-role key or B2 application key as `VITE_*`.

When the build succeeds, your current Worker will use a `workers.dev`
domain, not `pages.dev`. Add your exact deployed domain to Supabase
Authentication → URL Configuration for `/login` and `/reset-password`,
and to your model host's CORS configuration.

If the build still fails, scroll to the **bottom of the build log** for its
first error after `npm run build:pages`. The screenshot's top portion
only shows dependency installation and does not expose the actual error.

Cloudflare references:
[Workers build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[Workers static asset SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
[Workers static response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

---

VisionGuard's React/Vite frontend and YOLO11s browser inference can run on
Cloudflare Workers static assets or Pages. This does **not** host the optional Python/FastAPI backend,
which is unnecessary for the core browser analysis flow.

**Current status:** Repository deployment configuration is prepared. A
Cloudflare account owner must still connect the repository and configure the
external model and Supabase account. A green CI run is not a deployed website.

## 1. Host the YOLO11s model

Cloudflare Workers static assets and Pages impose a **25 MiB per-file maximum**. Model weights are not
tracked in VisionGuard's Git repository, so a Git-based build cannot bundle
untracked local ONNX files.

**No-billing-required model hosting: your existing public Hugging Face model.**

Your [uploaded YOLO11s model](https://huggingface.co/SyedNazeer07/visionguard-yolo11s)
is already available as a public repository. Point the Cloudflare Worker
**build variable** at the file's resolve URL:

~~~text
VITE_YOLO_MODEL_URL=https://huggingface.co/SyedNazeer07/visionguard-yolo11s/resolve/main/yolo11s.onnx
~~~

**CORS fix:** The Cloudflare Worker now streams only this fixed public
Hugging Face model through the same-origin endpoint `/api/model/yolo11s.onnx`.
The browser maps both a mistaken `/blob/main/` URL and a correct
`/resolve/main/` URL to that same-origin route automatically in
production. No additional model host, CORS dashboard edits or R2 billing
are required for this model. The Worker uses a strict fixed upstream URL,
rejects arbitrary URLs, and streams rather than buffering the 38 MB file.
Cloudflare Workers Free has request limits; access to Hugging Face remains
subject to their public download availability and policies.

This 38 MB model cannot be bundled into a Cloudflare static asset because of
the 25 MiB per-file limit. The app loads it from Hugging Face at runtime.
Check that your export matches [the detector contract](MODEL_SETUP.md) and
that its licence permits public distribution. Before treating deployment
as complete, test browser **HEAD and GET** through Hugging Face's redirects,
and ensure CORS works with your exact `workers.dev` website origin.

Public Hugging Face hosting has its own availability and bandwidth policies.
It does **not** require enabling Cloudflare R2 subscription billing.

**Separately, ONNX Runtime Web's JSEP WASM is ~28 MiB.** Vite normally emits
this as a local asset that Cloudflare would reject. The deployment script
removes only this generated duplicate and configures the application's
worker to load the exact installed ONNX Runtime version from the public
jsDelivr CDN. This preserves the WebGPU/WASM execution options, but live
network access to the CDN is required. Verify its CORS and availability;
the CI build cannot prove those external resources will load.

If you later need stronger uptime guarantees, you can migrate the public
model and runtime to your own compatible, licensed CDN or R2 storage, with
its own costs. Do not put original private video uploads in public storage.

A model **no larger than 25 MiB** can alternatively be packaged under
apps/web/public/models/yolo11s.onnx with an explicit provisioning step.
The deployment guard refuses to publish if neither model option is set.

## 2. Optional alternative: create a Cloudflare Pages project

If you prefer Pages instead of keeping the existing Worker, go to
[Cloudflare Dashboard](https://dash.cloudflare.com/) →
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

The command **npm run build:pages** repairs npm's missing Linux native
Rolldown/Oxlint bindings when necessary, builds the frontend, redirects
the oversized ONNX Runtime WASM to its matching-version public CDN,
and verifies that every remaining file is within Cloudflare's 25 MiB
limit. It also checks that Supabase and model URLs are configured.
**npm run test:deploy** tests these release guards.

This validates the **build output**, not the remote Hugging Face model
response, the jsDelivr binary, Cloudflare deployment, or detector accuracy.

## 4. Configure redirects and Google login

After deployment, use your actual Worker URL, for example
https://visionguard.YOUR-ACCOUNT.workers.dev, or the Pages URL if you
created a separate Pages project. In **Supabase → Authentication → URL
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

With your existing Worker, trigger a **new build from the latest `main` commit**,
rather than retrying the older failed commit. Confirm the build details show
the new commit before checking the **real HTTPS deployment**:

1. Landing, signup, confirmation, password recovery and Google OAuth.
2. Model initialization: Hugging Face ONNX HEAD and GET succeed (including
   redirects), the jsDelivr ONNX Runtime JSEP WASM is accessible, and both
   external requests pass CORS. No missing `/assets/*.wasm` requests should
   be used as the production runtime source.
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

Cloudflare Pages Free has **500 builds per month**; Workers and Pages both
have **25 MiB per static asset** and free-tier file-count limits. Static
Pages hosting does not put the application to sleep like an idle Python
service. But Supabase Free can pause or hit quotas, public CDN/Hugging Face services
have fair-use and availability limits, optional Backblaze B2 has its own
storage costs, and inference performance depends on each
visitor's WebGPU/WASM/browser hardware. No plan provides genuinely
unlimited free compute, storage and database use.

References: [Pages build setup](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[R2 public bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
