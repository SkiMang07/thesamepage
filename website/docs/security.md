# Credential handling for the marketing site

Read this before running any `hs` command. It exists because the HubSpot CLI
authenticates with a long-lived key, and this repo is pushed to GitHub.

## What the credential is

A **HubSpot Personal Access Key**. It grants the CLI the same access to the
HubSpot account that the granting user has — content, design tools, and whatever
CRM scopes are enabled on the key. Treat it exactly like a password. There is no
"read-only" variant in use here.

## Where it is allowed to live

**One place: `~/.hscli/config.yml`** — the CLI's global config, in the home
directory, outside every repository. HubSpot CLI v7.4.0 and later write here by
default. Because it is outside the repo, it cannot be committed by accident. That
is the point, and it is why this is the required setup rather than a preference.

**Never inside this repo.** Older CLI versions wrote `hubspot.config.yml` into the
current working directory, credentials and all. If that file exists anywhere under
this repo, the setup is wrong — fix it with the migration step below rather than
relying on `.gitignore` to save you.

The only HubSpot config file that may be committed is **`.hsaccount`**, which
contains an account ID and no credentials. It exists to pin which account a
directory targets.

## Verify the setup

```
ls -la ~/.hscli/config.yml
find "$HOME/Desktop/Obsidian/main/01 Projects/The Same Page" -name 'hubspot.config.yml'
```

Expected: the first prints a file, the second prints nothing.

If a `hubspot.config.yml` turns up anywhere in the repo:

```
npx hs config migrate
```

then delete the old file and treat the key as exposed — see below.

## Rules

- Never commit a key. `.gitignore` is a backstop, not the control; keeping the
  file outside the repo is the control.
- Never paste a key into a chat, a document, a commit message, or an issue.
- Never screenshot a terminal window immediately after authenticating without
  reading what is on screen first.
- Do not add the key to GitHub Actions by hand-editing a workflow file. When CI
  is set up, it goes in as a repository secret and is referenced by name.
- One key per machine. Do not copy a key between computers — authenticate again.

## If a key is exposed

Rotation is cheap and takes about two minutes. Do it on any doubt at all rather
than reasoning about whether the exposure was real.

1. HubSpot → your avatar → **Profile & Preferences → Developer → Personal Access
   Key** → deactivate the existing key.
2. Generate a new one.
3. `npx hs account auth` and re-enter it.

Deactivating is immediate. A key that has been deactivated is worthless no matter
where it leaked to, which is why revoking first and investigating second is always
the right order.

## Account reference

The CLI account is named **`tsp-hubspot`**. That name is a local alias only — it
is not a secret and is safe to write down, which is why it appears here.
