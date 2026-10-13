# Earth Systems Global Control API

This backend provides globally shared system availability for the GitHub Pages app. It stores status in a Cloudflare SQLite-backed Durable Object, so all visitors read the same authoritative state. The admin password and session signing key are stored as Cloudflare Worker secrets, not committed to source or shipped in the frontend bundle.

## Requirements

- A Cloudflare account with Workers enabled.
- Node.js 22 or newer.
- A local checkout of this repository.

GitHub Pages cannot run server-side code. Until this API is deployed and its URL is configured as a GitHub Actions repository variable, the site displays a warning and global admin commands will not work.

## First-time setup

Run these commands from the repository root:

~~~powershell
npx wrangler login
node scripts/generate-control-secrets.mjs
npx wrangler deploy --config control-api/wrangler.jsonc --secrets-file control-api/.secrets.local.json
~~~

The generator prints a new randomly generated 256-bit admin password. Save it in a password manager before continuing. The generated secret file contains that password plus a separate session signing key; it is excluded by the root .gitignore. Never commit or share the file.

Wrangler prints the Worker URL, usually similar to:

~~~text
https://earth-systems-control.<your-workers-subdomain>.workers.dev
~~~

Open the URL followed by /api/health. It should return JSON containing ok: true.

After deployment succeeds, delete control-api/.secrets.local.json securely. Do not commit it.

## Connect the GitHub Pages frontend

1. Open GitHub repository Settings → Secrets and variables → Actions → Variables.
2. Add a repository variable named VITE_SYSTEMS_API_URL. Set its value to the deployed Worker URL, without a trailing slash.
3. Rerun the GitHub Pages workflow (or push a commit). The build workflow injects this public endpoint URL; it does not include the admin password or signing key.
4. Open the site. The global-control warning should disappear after the API status request succeeds.

The Worker only accepts browser requests from https://charlienr.github.io. If the site moves to another origin, update ALLOWED_ORIGIN in control-api/wrangler.jsonc and redeploy.

## Commands

Right-click a system tile on the home screen to open its terminal. Authenticate with the generated password. Supported commands include:

~~~text
help
status
ls
sudo close
sudo open
sudo close mass-space
sudo open plate-lab
~~~

Without a system argument, sudo close / sudo open acts on the system whose terminal was opened. The state is stored in a central Durable Object; visitors read updates on the next frontend poll (every 15 seconds). Admin sessions expire after 15 minutes. Eight incorrect login attempts from one IP trigger a 15-minute lockout.

## Rotate the password

Run the secret generator again after moving or deleting the previous local secret file. Save the new password and redeploy with the new secret file:

~~~powershell
node scripts/generate-control-secrets.mjs
npx wrangler deploy --config control-api/wrangler.jsonc --secrets-file control-api/.secrets.local.json
~~~

This rotates both the password and session signing key, invalidating previous admin sessions.

## Security boundary

The global state is server-side and shared across visitors, unlike localStorage. The password is a randomly generated high-entropy secret held by Cloudflare's Worker secret store. It is not in source code or the deployed JavaScript bundle. Admin requests use short-lived signed tokens and login attempts are rate-limited.

However, system availability is a shared UI switch, not access control for sensitive data. GitHub Pages serves public static files, and someone who modifies their own browser could bypass a UI state. Do not use this for protecting sensitive information or real-world services.