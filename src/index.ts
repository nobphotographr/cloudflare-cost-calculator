import { demoUsage, loadAccountUsage } from "./analytics";
import { listAuthorizedAccounts } from "./cloudflare";
import { createOAuthRequest, exchangeCode, refreshToken, revokeToken } from "./oauth";
import { cleanupUsageHistory, deleteAccountData, getBudget, loadUsageHistory, saveUsageSnapshot, setBudget } from "./history";
import {
  cleanupSessions,
  connectSession,
  createPendingSession,
  deleteSession,
  openPendingSession,
  readConnectedSession,
  selectAccount,
  updateTokenSet,
} from "./session";

type Env = {
  ASSETS: Fetcher;
  SESSIONS: D1Database;
  ENVIRONMENT?: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_REDIRECT_URI?: string;
  OAUTH_SCOPES?: string;
  SESSION_ENCRYPTION_SECRET?: string;
};

const SECURE_COOKIE = "__Host-cloudcost_session";
const LOCAL_COOKIE = "cloudcost_session";

function cookieName(requestUrl: URL): string {
  return requestUrl.protocol === "https:" ? SECURE_COOKIE : LOCAL_COOKIE;
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function secured(response: Response, requestUrl: URL): Response {
  const next = new Response(response.body, response);
  next.headers.set("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  next.headers.set("x-content-type-options", "nosniff");
  if (requestUrl.protocol === "https:") next.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return next;
}

function cookieValue(request: Request): string {
  const requestUrl = new URL(request.url);
  const expectedName = cookieName(requestUrl);
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === expectedName) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(token: string, requestUrl: URL, maxAge = 30 * 86_400): string {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${cookieName(requestUrl)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie(requestUrl: URL): string {
  return sessionCookie("", requestUrl, 0);
}

function config(env: Env): { clientId: string; clientSecret: string; redirectUri: string; scopes: string[]; encryptionSecret: string } {
  const scopes = (env.OAUTH_SCOPES ?? "").split(/\s+/).filter(Boolean);
  if (!env.OAUTH_CLIENT_ID || !env.OAUTH_CLIENT_SECRET || !env.OAUTH_REDIRECT_URI || !env.SESSION_ENCRYPTION_SECRET || scopes.length === 0) {
    throw new Error("Cloudflare OAuth is not configured");
  }
  return {
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: env.OAUTH_REDIRECT_URI,
    scopes,
    encryptionSecret: env.SESSION_ENCRYPTION_SECRET,
  };
}

async function connected(request: Request, env: Env) {
  const encryptionSecret = env.SESSION_ENCRYPTION_SECRET;
  if (!encryptionSecret) return null;
  return readConnectedSession({ db: env.SESSIONS, cookieToken: cookieValue(request), encryptionSecret });
}

async function freshSession(request: Request, env: Env) {
  const session = await connected(request, env);
  if (!session) return null;
  const expiresAt = session.tokenSet.expiresAt ? Date.parse(session.tokenSet.expiresAt) : Number.POSITIVE_INFINITY;
  if (expiresAt - Date.now() > 60_000 || !session.tokenSet.refreshToken) return session;
  const oauth = config(env);
  const tokenSet = await refreshToken({
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    refreshToken: session.tokenSet.refreshToken,
  });
  await updateTokenSet({ db: env.SESSIONS, sessionHash: session.sessionHash, tokenSet, encryptionSecret: oauth.encryptionSecret });
  return { ...session, tokenSet };
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) {
    return json({ error: "invalid_origin" }, 403);
  }
  if (url.pathname === "/api/health") return json({ ok: true, oauthConfigured: Boolean(env.OAUTH_CLIENT_ID && env.OAUTH_SCOPES) });
  if (url.pathname === "/api/demo/usage") return json(demoUsage());

  if (url.pathname === "/api/connect/start" && request.method === "GET") {
    try {
      const oauth = config(env);
      const authorization = await createOAuthRequest({ clientId: oauth.clientId, redirectUri: oauth.redirectUri, scopeIds: oauth.scopes });
      const cookieToken = await createPendingSession({
        db: env.SESSIONS,
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        encryptionSecret: oauth.encryptionSecret,
        expiresAt: authorization.expiresAt,
      });
      return json({ authorizationUrl: authorization.authorizationUrl }, 200, { "set-cookie": sessionCookie(cookieToken, url, 600) });
    } catch (error) {
      const configured = error instanceof Error && error.message === "Cloudflare OAuth is not configured";
      return json({ error: configured ? "oauth_not_configured" : "oauth_start_failed" }, configured ? 503 : 500);
    }
  }

  if (url.pathname === "/api/connect/callback" && request.method === "GET") {
    let callbackStage = "configuration";
    try {
      const oauth = config(env);
      callbackStage = "session";
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const authorizationError = url.searchParams.get("error");
      if (authorizationError) throw new Error(`OAuth authorization error: ${authorizationError}`);
      if (!code) throw new Error("OAuth code is missing");
      const cookieToken = cookieValue(request);
      const pending = await openPendingSession({
        db: env.SESSIONS,
        cookieToken,
        state,
        encryptionSecret: oauth.encryptionSecret,
      });
      callbackStage = "token_exchange";
      const tokenSet = await exchangeCode({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        redirectUri: oauth.redirectUri,
        code,
        codeVerifier: pending.codeVerifier,
      });
      callbackStage = "account_lookup";
      const accounts = await listAuthorizedAccounts(tokenSet.accessToken);
      if (accounts.length === 0) throw new Error("No authorized Cloudflare account was returned");
      callbackStage = "session_save";
      await connectSession({
        db: env.SESSIONS,
        sessionHash: pending.sessionHash,
        tokenSet,
        accounts,
        encryptionSecret: oauth.encryptionSecret,
      });
      return new Response(null, {
        status: 302,
        headers: {
          location: `${url.origin}/?connected=1`,
          "set-cookie": sessionCookie(cookieToken, url),
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      console.error("oauth_callback_failed", {
        stage: callbackStage,
        message: error instanceof Error ? error.message : "unknown_error",
      });
      return Response.redirect(`${url.origin}/?connection_error=1`, 302);
    }
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const session = await connected(request, env);
    if (!session) return json({ connected: false });
    return json({ connected: true, accounts: session.accounts, selectedAccount: session.selectedAccount, expiresAt: session.expiresAt });
  }

  if (url.pathname === "/api/session/account" && request.method === "POST") {
    const session = await connected(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.accountId !== "string") return json({ error: "invalid_account" }, 400);
    try {
      const selected = await selectAccount({ db: env.SESSIONS, sessionHash: session.sessionHash, accountId: body.accountId, accounts: session.accounts });
      return json({ selectedAccount: selected });
    } catch {
      return json({ error: "invalid_account" }, 400);
    }
  }

  if (url.pathname === "/api/usage" && request.method === "GET") {
    const session = await freshSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    if (!session.selectedAccount) return json({ error: "account_required", accounts: session.accounts }, 409);
    try {
      const snapshot = await loadAccountUsage({ accessToken: session.tokenSet.accessToken, accountId: session.selectedAccount.id });
      await saveUsageSnapshot(env.SESSIONS, session.selectedAccount.id, snapshot);
      return json(snapshot);
    } catch {
      return json({ error: "analytics_failed" }, 502);
    }
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    const session = await connected(request, env);
    if (!session?.selectedAccount) return json({ error: "not_connected" }, 401);
    return json({ points: await loadUsageHistory(env.SESSIONS, session.selectedAccount.id, Number(url.searchParams.get("limit") ?? 90)) });
  }

  if (url.pathname === "/api/budget" && request.method === "GET") {
    const session = await connected(request, env);
    if (!session?.selectedAccount) return json({ error: "not_connected" }, 401);
    return json({ budget: await getBudget(env.SESSIONS, session.selectedAccount.id) });
  }

  if (url.pathname === "/api/budget" && request.method === "POST") {
    const session = await connected(request, env);
    if (!session?.selectedAccount) return json({ error: "not_connected" }, 401);
    const body = await request.json() as Record<string, unknown>;
    try {
      return json({ budget: await setBudget(env.SESSIONS, session.selectedAccount.id, Number(body.monthlyBudgetUsd)) });
    } catch {
      return json({ error: "invalid_budget" }, 400);
    }
  }

  if (url.pathname === "/api/disconnect" && request.method === "POST") {
    const session = await connected(request, env);
    if (session) {
      try {
        const oauth = config(env);
        const token = session.tokenSet.refreshToken ?? session.tokenSet.accessToken;
        await revokeToken({ clientId: oauth.clientId, clientSecret: oauth.clientSecret, token });
      } catch {
        // Local session removal must still complete when Cloudflare is unavailable.
      }
      await deleteAccountData(env.SESSIONS, session.accounts.map((account) => account.id));
      await deleteSession(env.SESSIONS, session.sessionHash);
    }
    return json({ disconnected: true }, 200, { "set-cookie": clearCookie(url) });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return secured(await env.ASSETS.fetch(request), url);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([cleanupSessions(env.SESSIONS), cleanupUsageHistory(env.SESSIONS)]).then(() => undefined));
  },
};
