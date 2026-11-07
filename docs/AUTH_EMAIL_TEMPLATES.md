# VisionGuard authentication emails

The repo contains two clean, responsive email HTML references:

- `supabase/templates/confirmation.html` — sign-up email verification
- `supabase/templates/recovery.html` — password-reset emails

Both use Supabase's official `{{ .ConfirmationURL }}` template variable. No
tracking pixels, fonts, third-party images, or external scripts are required.

## Apply to the hosted Supabase Auth project

These files are **not deployed automatically** by Git commits. To update
the emails your users actually receive:

1. Open the **Supabase Dashboard** for your VisionGuard Auth project.
2. Go to **Authentication → Email Templates**.
3. Open **Confirm signup**, set subject to
   `Confirm your VisionGuard account`, and paste the entire HTML from
   `supabase/templates/confirmation.html`.
4. Open **Reset Password**, set subject to
   `Reset your VisionGuard password`, and paste the HTML from
   `supabase/templates/recovery.html`.
5. Save each template. Check your project's Auth email URL/redirect allow
   list includes the **real** origins you will serve:
   - `http://localhost:3000/login`
   - `http://localhost:3000/reset-password`
   - `https://YOUR_PRODUCTION_HOST/login`
   - `https://YOUR_PRODUCTION_HOST/reset-password`
6. Test both flows with a disposable, authorized account: confirmation
   link, expired link, password update, and retry.

Hosted Supabase template variables are processed **server-side** by Supabase
Auth. Never substitute user-entered URLs into an email template. Google
OAuth client credentials and Backblaze B2 secrets should not appear in
email templates or frontend code.

For reliable production email delivery, configure and verify your sending
domain / SMTP provider according to the Supabase dashboard. The default
SMTP service can have sending limits; successfully saving HTML templates
does not guarantee email deliverability.

The React UI's confirmation instructions, sign-in page and password
recovery now use the same light VisionGuard styling.

References:

- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/auth-smtp
