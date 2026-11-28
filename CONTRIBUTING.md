# Contributing

Keep changes focused and reproducible. VisionGuard has one active browser-side inference pipeline; do not reintroduce a separate server-based analysis path.

## Development

Use Node.js 22, run `npm ci`, configure the model and optional public environment variables using the [README](README.md), then run `npm run dev`.

Before proposing changes:

1. Run lint, the production build and the web test suite.
2. Run the architecture, tracking-evaluation and deployment checks described in the README.
3. Add regression coverage for changed behavior. For UI changes, check desktop and mobile navigation, keyboard interaction and both color themes.
4. For inference changes, report the model, source footage, browser, hardware and evaluation method; distinguish synthetic tests from real-world measurements.

Never commit private footage, model weights without appropriate redistribution rights, local environment files, credentials or generated test output. Preserve migrations and historical-data compatibility unless a migration plan is documented.

Use descriptive commits and record known limitations. For security issues, follow [SECURITY.md](SECURITY.md).
