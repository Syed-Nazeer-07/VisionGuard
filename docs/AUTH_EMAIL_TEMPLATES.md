# VisionGuard authentication emails

The production Auth project is `wpkwxlhwjkgtvyersust`. Its repository templates require a manual hosted update after the corresponding frontend is deployed.

1. In the VisionGuard Supabase project, open **Authentication → URL Configuration**. Set **Site URL** to `https://visionguard.syednazeerofficial2007.workers.dev` with no trailing slash. Retain the exact production `/login` and `/reset-password` redirects and any authorized localhost equivalents at port 3000. Review other allowlist entries with the project owner.
2. Under **Authentication → Sign In / Providers → Email**, review the **Confirm email** setting against the intended signup policy. The frontend handles either setting.
3. Under **Authentication → Emails → Templates**, set **Confirm signup** subject to **Confirm your VisionGuard account** and paste [confirmation.html](../supabase/templates/confirmation.html). Set **Reset password** subject to **Reset your VisionGuard password** and paste [recovery.html](../supabase/templates/recovery.html).
4. Check **Authentication → Emails → SMTP Settings** for an authorized sender address, verified sender domain and valid credentials. Disable link tracking. Check **Authentication → Rate Limits** and the SMTP provider’s sending quotas. Supabase’s default mail service restricts recipients and throughput, so use the project’s authorized SMTP configuration for external delivery.
5. Under **Authentication → Sign In / Providers → Google**, check the configured provider and client. Confirm the Google OAuth application's redirect is `https://wpkwxlhwjkgtvyersust.supabase.co/auth/v1/callback`. [Google setup](GOOGLE_SIGN_IN.md)
6. With a new authorized mailbox, register, inspect the delivered email in its client, confirm from a private window/device, sign in, request recovery, open the delivered recovery message, update the password, and test both passwords. Test expired, invalid and reused links and record actual provider and inbox outcomes.

The templates put the provider’s `TokenHash` in a URL fragment on the configured Site URL. A user explicitly continues from a branded screen before the app sends the one-time token to Supabase via `verifyOtp`. This supports other browsers and avoids consuming the token on a link preview GET. Existing provider-issued implicit links at `/login` and `/reset-password` remain supported.

[Supabase templates](https://supabase.com/docs/guides/auth/auth-email-templates) · [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
