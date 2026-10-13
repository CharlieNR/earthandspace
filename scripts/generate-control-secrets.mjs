import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(process.cwd(), "control-api/.secrets.local.json");
if (existsSync(output)) {
  console.error("Refusing to overwrite control-api/.secrets.local.json. Move or delete it first if rotating credentials.");
  process.exit(1);
}
const password = randomBytes(32).toString("base64url");
const signingKey = randomBytes(32).toString("base64url");
writeFileSync(output, JSON.stringify({
  ADMIN_PASSWORD: password,
  SESSION_SIGNING_KEY: signingKey,
}, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
try { chmodSync(output, 0o600); } catch {}
console.log("");
console.log("Generated a unique 256-bit admin password. Save it in a password manager now:");
console.log(password);
console.log("");
console.log("Password and a separate session-signing key were saved to control-api/.secrets.local.json.");
console.log("This file is excluded by .gitignore. Never commit or share it.");
console.log("");
console.log("Deploy with:");
console.log("npx wrangler deploy --config control-api/wrangler.jsonc --secrets-file control-api/.secrets.local.json");
console.log("After deployment succeeds, securely delete control-api/.secrets.local.json.");
