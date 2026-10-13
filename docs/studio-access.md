# Studio Ops access

The application has one owner-managed account, configured with `STUDIO_AUTH_USERNAME` and an initial `STUDIO_AUTH_PASSWORD_HASH`. There is no public registration or alternate application sign-in. These variables are server-only and required: missing configuration fails closed.

Passwords use salted scrypt (N=131072, r=8, p=1, 64-byte output). The initial hash format is `scrypt$<32-character hex salt>$<128-character hex key>`. First use seeds `studio_auth_accounts` without replacing an existing account. Password changes persist in that table and are not reset by deployment or by the initial environment value.

An authenticated owner can change the password at `/account/password`. The current password is required, the new password must contain 15–128 characters, and the account update and session replacement are atomic. All previous sessions are revoked. There is no public password-reset endpoint.

Opaque 256-bit session tokens are kept in Secure, HttpOnly, SameSite=Strict, host-only cookies and stored as SHA-256 hashes in `studio_auth_sessions`. Sessions expire after eight hours. The database checks the current password version, expiry and revocation on each protected request. Logout revokes the session and clears the application's browser storage and cache.

`proxy.ts` gates page, API and RSC requests. Every data page, API handler and server action additionally checks authentication before accessing records or performing work. Client pages have authenticated server wrappers. Mutating API handlers require the same origin. Login attempts are throttled in persistent database buckets by client and account. API routes do not accept alternate API keys or bypass headers as application authentication.

The only public application handlers are the login page and the login/logout endpoints. Static framework assets do not contain record data. Protected responses are private and not cached publicly.

Platform protection must also cover immutable older deployments, which cannot inherit newly deployed application code. The Studio Ops project firewall is configured separately to deny requests whose hostname is not `studio-ops-green.vercel.app`. Keep that rule active, and review it when changing the canonical domain. This affects this project's deployment URLs only; it does not change the owner's Vercel account login.

The generated initial login file is kept locally outside this repository. Never add plaintext passwords, session cookies or actual credential hashes to source control. If the account password is changed, the initial local password file no longer represents the current password.
