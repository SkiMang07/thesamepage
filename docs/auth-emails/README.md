# Auth emails

The two Supabase Auth emails a manager actually receives, branded. N-14 in
`docs/PRELAUNCH_BACKLOG.md`.

| Supabase template | File | Subject |
|---|---|---|
| Magic link or OTP | `magic-link.html` | Sign in to The Same Page |
| Confirm sign up | `confirm-signup.html` | Confirm your email for The Same Page |

**Applied 2026-09-24.** Supabase locks a template's subject and body while the
project sends through its built-in mailer, so custom SMTP (Authentication →
Emails → SMTP Settings, sending as ag@thesamepage.xyz) went on first. To change
copy: edit the file here, then paste its HTML (without the leading comment) into
the template's Source tab, set the subject from the table, and save. The files
here are the source of truth.

Voice: `gtm/brand/voice-rules.md`. These are transactional, so literal and even:
what the email is, the one thing to do, and what happens if you didn't ask for it.
No exclamation marks, no "Welcome aboard". The first-contact email carries
Andrew's name, per the lifecycle-email register.

Built for email clients: tables, inline styles, no images (most clients block
them by default, and an SVG logo doesn't render in Gmail), a plain-text link
under the button for clients that strip buttons. Colours are the brand tokens
from `frontend/tailwind.config.js`: carbon `#222B32`, teal `#087E78`.

Template variables are Supabase's own: `{{ .ConfirmationURL }}`, `{{ .Email }}`.
The magic link doesn't state an expiry time. That's a dashboard setting
(Authentication → Sign In / Providers → Email), and a number in the copy would go
stale the day someone changes it.
