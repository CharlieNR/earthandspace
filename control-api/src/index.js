import { DurableObject } from "cloudflare:workers";

const SYSTEMS = {
  "past-globe": { name: "Past Globe", available: true },
  "mass-space": { name: "Mass in Space", available: true },
  phivolcs: { name: "Global Seismic & Volcanic Monitor", available: true },
  "plate-lab": { name: "Plate Tectonics Laboratory", available: true },
};
const SESSION_TTL_MS = 15 * 60 * 1000;
const AUTH_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function decodeBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}
async function getStateStub(env) {
  return env.SYSTEM_STATE.get(env.SYSTEM_STATE.idFromName("global-system-availability"));
}
async function stateRequest(stub, path, method = "GET", payload) {
  const response = await stub.fetch("https://state.internal" + path, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Shared state service failed.");
  return data;
}
async function checkPassword(candidate, env) {
  if (typeof env.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.length < 32) {
    throw new Error("Admin password is not configured. Generate secrets and deploy the control API again.");
  }
  return constantTimeEqual(await sha256(candidate), await sha256(env.ADMIN_PASSWORD));
}
async function createSessionToken(env) {
  if (typeof env.SESSION_SIGNING_KEY !== "string" || env.SESSION_SIGNING_KEY.length < 32) {
    throw new Error("Session signing key is not configured.");
  }
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({
    sub: "earth-systems-admin",
    exp: Date.now() + SESSION_TTL_MS,
    aud: "earth-systems-control",
  })));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(env.SESSION_SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return { token: payload + "." + encodeBase64Url(new Uint8Array(signature)), expiresInSeconds: SESSION_TTL_MS / 1000 };
}
async function verifySessionToken(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer ([A-Za-z0-9_.-]+)$/u);
  if (!match || !env.SESSION_SIGNING_KEY) return false;
  const pieces = match[1].split(".");
  if (pieces.length !== 2) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(env.SESSION_SIGNING_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    if (!(await crypto.subtle.verify("HMAC", key, decodeBase64Url(pieces[1]), encoder.encode(pieces[0])))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(pieces[0])));
    return payload.sub === "earth-systems-admin"
      && payload.aud === "earth-systems-control"
      && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.ALLOWED_ORIGIN) return null;
  return {
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return json({ error: "Origin not allowed." }, 403);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "earth-systems-control" }, 200, cors);
      }
      if (url.pathname === "/api/status" && request.method === "GET") {
        const state = await stateRequest(await getStateStub(env), "/internal/state");
        return json({ availability: state.availability, updatedAt: state.updatedAt, serverTime: new Date().toISOString() }, 200, cors);
      }
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const password = typeof body?.password === "string" ? body.password : "";
        if (!password || password.length > 512) return json({ error: "Enter a valid password." }, 400, cors);

        const address = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipKey = encodeBase64Url(await sha256(address));
        const stub = await getStateStub(env);
        const attempt = await stateRequest(stub, "/internal/auth/check", "POST", { key: ipKey });
        if (!attempt.allowed) {
          return json({ error: "Too many failed attempts. Try again in " + attempt.retryAfterSeconds + " seconds." }, 429, cors);
        }

        let accepted = false;
        try {
          accepted = await checkPassword(password, env);
        } catch (error) {
          return json({ error: error.message || "Authentication is not configured." }, 503, cors);
        }
        if (!accepted) {
          const failure = await stateRequest(stub, "/internal/auth/fail", "POST", { key: ipKey });
          return json({
            error: failure.blocked
              ? "Access locked after too many failed attempts. Wait 15 minutes before trying again."
              : "Access denied. The password was incorrect.",
          }, 401, cors);
        }
        await stateRequest(stub, "/internal/auth/success", "POST", { key: ipKey });
        return json(await createSessionToken(env), 200, cors);
      }
      if (url.pathname === "/api/admin/system-status" && request.method === "POST") {
        if (!(await verifySessionToken(request, env))) {
          return json({ error: "Admin session expired or invalid. Authenticate again." }, 401, cors);
        }
        const body = await request.json().catch(() => null);
        if (!body || !Object.hasOwn(SYSTEMS, body.systemId) || typeof body.available !== "boolean") {
          return json({ error: "Specify a valid systemId and a boolean available value." }, 400, cors);
        }
        const result = await stateRequest(await getStateStub(env), "/internal/state/set", "POST", {
          systemId: body.systemId, available: body.available,
        });
        return json({ availability: result.availability, updatedAt: result.updatedAt, changedSystem: body.systemId }, 200, cors);
      }
      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      console.error("Control API request failed", error);
      return json({ error: "The global control service encountered an error." }, 500, cors);
    }
  },
};

export class SystemState extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const storage = this.ctx.storage;
    if (url.pathname === "/internal/state" && request.method === "GET") {
      const saved = await storage.get("system-state");
      if (saved) return json(saved);
      const initial = {
        availability: Object.fromEntries(Object.entries(SYSTEMS).map(([id, system]) => [id, system.available])),
        updatedAt: null,
      };
      await storage.put("system-state", initial);
      return json(initial);
    }
    if (url.pathname === "/internal/state/set" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !Object.hasOwn(SYSTEMS, body.systemId) || typeof body.available !== "boolean") {
        return json({ error: "Invalid system state update." }, 400);
      }
      const saved = await storage.get("system-state") || {
        availability: Object.fromEntries(Object.entries(SYSTEMS).map(([id, system]) => [id, system.available])),
        updatedAt: null,
      };
      saved.availability[body.systemId] = body.available;
      saved.updatedAt = new Date().toISOString();
      await storage.put("system-state", saved);
      return json(saved);
    }
    if (url.pathname === "/internal/auth/check" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (typeof body?.key !== "string" || body.key.length > 100) return json({ error: "Invalid rate-limit key." }, 400);
      const rateResult = await storage.transaction(async (transaction) => {
        const now = Date.now();
        const key = "auth:" + body.key;
        const attempts = await transaction.get(key) || { failures: 0, windowStartedAt: now, blockedUntil: 0 };
        if (attempts.blockedUntil > now) {
          return { allowed: false, retryAfterSeconds: Math.ceil((attempts.blockedUntil - now) / 1000) };
        }
        if (now - attempts.windowStartedAt > AUTH_LOCKOUT_MS) await transaction.delete(key);
        return { allowed: true };
      });
      return json(rateResult);
    }
    if (url.pathname === "/internal/auth/fail" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (typeof body?.key !== "string" || body.key.length > 100) return json({ error: "Invalid rate-limit key." }, 400);
      const failureResult = await storage.transaction(async (transaction) => {
        const now = Date.now();
        const key = "auth:" + body.key;
        const old = await transaction.get(key);
        const attempts = !old || now - old.windowStartedAt > AUTH_LOCKOUT_MS
          ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
          : old;
        attempts.failures += 1;
        if (attempts.failures >= MAX_FAILED_ATTEMPTS) attempts.blockedUntil = now + AUTH_LOCKOUT_MS;
        await transaction.put(key, attempts);
        return { blocked: attempts.blockedUntil > now };
      });
      return json(failureResult);
    }
    if (url.pathname === "/internal/auth/success" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (typeof body?.key === "string" && body.key.length <= 100) await storage.delete("auth:" + body.key);
      return json({ cleared: true });
    }
    return json({ error: "Not found." }, 404);
  }
}
