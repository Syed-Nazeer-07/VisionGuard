# Security

VisionGuard is a release candidate, not a certified production traffic-enforcement system.

## Reporting vulnerabilities

Use GitHub's [security reporting page](https://github.com/Syed-Nazeer-07/VisionGuard/security) if private vulnerability reporting is available. Otherwise contact the repository maintainer privately before posting exploit details. Do not include credentials, private footage, personal data or access tokens in public issues or pull requests.

## Security boundaries

- Browser inference does not require automatic upload of original footage.
- Supabase authentication and database policies protect account-scoped metadata when configured.
- Backblaze B2 credentials and privileged Supabase keys belong only in server-side configuration.
- Public Vite environment variables must never contain secrets.
- Camera and browser-tab capture require explicit permission.

The [release checklist](docs/RELEASE_CHECKLIST.md) records outstanding environment-specific security and operational validation.
