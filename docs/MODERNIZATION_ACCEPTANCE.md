# Product modernization acceptance

Baseline on November 28, 2026 (India Standard Time) was main at `1040d8f`. Prior work landed via PRs #23 and #25. PRs #2, #16, #21 and #22 were open and outside this branch. The Workers configuration serves the Vite SPA and the existing model proxy. Browser inference, account-scoped history, authorization policies and explicit B2 upload remain the architectural boundaries.

| Area | Acceptance check |
| --- | --- |
| Public site and appearance | Native CTA click targets work at 390 px and 1440 px, desktop and mobile anchor navigation identifies the visible section, light/dark/system persist and follow OS changes, reduced motion suppresses transitions |
| Account | Shared labeled, autofill-friendly fields have space for icons and password controls. Confirmation is provider-verified. Resend is rate-limited. An ordinary session cannot unlock a password reset. |
| Workspace | Seven essential destinations, no ordinary-role badge, working mobile drawer and tab stop action, preserved admin guards |
| Live analysis | One control bar, four recorded rates, keyboard seek and playback, fullscreen includes canvas, existing inference receives decoded frames, live sources offer capture actions, sample sessions are labeled |
| Sources and privacy | YouTube opens an encoded search in a separate tab and keeps the picker ready. The browser grants capture. Rejected streams are released. Original storage stays opt-in. |
| Activity | Overview prioritizes recent sessions and pending review. History is searchable and links originals. Incident queue supports persisted decisions. Analytics panels size independently. |
| Reporting | Four export types, consistent session filters, non-truncated detail, distinct observation populations, safe CSV, PDF page numbering |
| Verification | Local CI-equivalent checks, desktop and mobile screenshots, browser scenarios, hosted auth access and delivery findings, CI run, exact production status |
