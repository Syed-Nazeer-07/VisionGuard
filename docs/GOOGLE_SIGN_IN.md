# Google sign-in setup

VisionGuard's **Continue with Google** button uses Supabase Auth
`signInWithOAuth({ provider: 'google' })`. This does not replace existing
email/password accounts and **never grants Admin access to a new user**.

The frontend OAuth flow is implemented, but the **Google provider must be
configured separately**.
A 7 November 2026 sign-in attempt to the connected staging project was rejected
with HTTP 400 `provider is not enabled` in Supabase Auth logs. This requires
enabling Google's provider on the server side; editing the React button alone
cannot fix it. The login UI now checks public provider availability before
redirecting, when the endpoint is accessible. This configuration cannot be done with a public
Supabase publishable key and cannot be embedded in frontend source code.

## 1. Configure Google Auth Platform

In [Google Cloud Console](https://console.cloud.google.com/auth/overview):

1. Create/select a project and configure the OAuth consent screen (Branding
   and Audience).
2. Create an OAuth **Web application** client ID.
3. Under **Authorized JavaScript origins** add:
   - `http://localhost:3000`
   - Your deployed VisionGuard HTTPS origin when available.
4. Under **Authorized redirect URIs**, add the **Supabase Auth callback**
   from your project's Google provider settings. For the current staging
   project, it is:
   - `https://wpkwxlhwjkgtvyersust.supabase.co/auth/v1/callback`
   Use the callback belonging to the Supabase project configured in
   `apps/web/.env.local`; don't substitute your frontend's `/login` URL.

Keep the Google client secret in Google's/Supabase's server-side
configuration. Never commit it or use `VITE_*` for the secret.

## 2. Enable Google in Supabase

Open the [Supabase dashboard](https://supabase.com/dashboard) for the
same project used by VisionGuard. The connected staging project's
[Google provider settings](https://supabase.com/dashboard/project/wpkwxlhwjkgtvyersust/auth/providers?provider=Google)
must explicitly show **enabled**, with a configured client ID and secret. Navigate to **Authentication → Providers
→ Google**. Enable the provider and enter its Google Client ID and
Client Secret.

Under **Authentication → URL Configuration**, add these application
redirect URLs (plus your production address):

- `http://localhost:3000/login`
- `https://YOUR_DEPLOYED_DOMAIN/login`

A wildcard for the whole origin is optional; the fixed callback above is
all this frontend needs. Keep the Site URL aligned with your deployment.

## 3. Configure Vite

Create `apps/web/.env.local` from `apps/web/.env.example`, with the
matching **public** Supabase URL and `sb_publishable_...` key:

```env
VITE_SUPABASE_URL=https://wpkwxlhwjkgtvyersust.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_YOUR_PROJECTS_PUBLIC_KEY
VITE_VIDEO_STORAGE_PROVIDER=b2
```

Restart `npm run dev` after editing the file. Don't use a service-role,
Google client secret, or B2 application key in browser environment variables.

## 4. Test sign-in

1. Open `http://localhost:3000/login` in a fresh browser session.
2. Click **Continue with Google**.
3. Complete Google's consent process and return to VisionGuard.
4. Confirm you arrive at `/app` authenticated and can see your normal
   workspace.
5. Confirm a **new** account receives the server-managed **Viewer** role
   and cannot access admin-only routes or operations.

Existing users retain their server profile role; client-supplied Google
profile metadata is only used for display names, **never authorization**.

### Troubleshooting

- **Provider is not enabled:** this was confirmed in staging Auth logs on
  7 November 2026. Create the Google OAuth Web client, save its ID and secret
  under Supabase **Authentication → Providers → Google**, and enable the toggle.
  Then retry; no app code can substitute for missing server credentials.
- **redirect_uri_mismatch:** enter the exact Supabase callback under Google
  Authorized redirect URIs. The frontend `/login` goes in Supabase's
  redirect allow list instead.
- **Auth not configured:** check `apps/web/.env.local`, not only the repo
  root; stop and restart Vite.
- **A first-time user sees limited permissions:** expected. A trusted
  existing administrator must assign additional access through the app's
  protected role-management system.

Google login changes **authentication only**. Original uploaded videos
continue to be stored in Backblaze B2 on explicit request, not Supabase
Storage.

Reference: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
