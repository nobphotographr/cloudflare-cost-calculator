import { randomToken, sha256, toBase64Url } from "./crypto";

export const OAUTH_ENDPOINTS = {
  authorization: "https://dash.cloudflare.com/oauth2/auth",
  token: "https://dash.cloudflare.com/oauth2/token",
  revoke: "https://dash.cloudflare.com/oauth2/revoke",
} as const;

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  scope: string[];
  expiresAt?: string;
};

export async function createOAuthRequest(input: {
  clientId: string;
  redirectUri: string;
  scopeIds: string[];
  nowMs?: number;
}): Promise<{ authorizationUrl: string; state: string; codeVerifier: string; expiresAt: string }> {
  if (!input.clientId.trim()) throw new Error("OAuth client ID is required");
  const redirectUri = new URL(input.redirectUri);
  if (redirectUri.protocol !== "https:" && redirectUri.hostname !== "127.0.0.1" && redirectUri.hostname !== "localhost") {
    throw new Error("OAuth redirect URI must use HTTPS");
  }
  const scopes = [...new Set(input.scopeIds.map((scope) => scope.trim()).filter(Boolean))];
  if (scopes.length === 0) throw new Error("OAuth scopes are required");
  const state = randomToken(32);
  const codeVerifier = randomToken(64);
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const url = new URL(OAUTH_ENDPOINTS.authorization);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", redirectUri.href);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", toBase64Url(new Uint8Array(challengeBytes)));
  url.searchParams.set("code_challenge_method", "S256");
  return {
    authorizationUrl: url.href,
    state,
    codeVerifier,
    expiresAt: new Date((input.nowMs ?? Date.now()) + 10 * 60 * 1000).toISOString(),
  };
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function tokenSet(payload: Record<string, unknown>, nowMs = Date.now(), oldRefreshToken?: string): OAuthTokenSet {
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("OAuth response is missing access_token");
  if (typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer") throw new Error("Unsupported OAuth token type");
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : undefined;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : oldRefreshToken,
    scope: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [],
    expiresAt: expiresIn ? new Date(nowMs + expiresIn * 1000).toISOString() : undefined,
  };
}

async function tokenRequest(body: URLSearchParams, input: {
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
  nowMs?: number;
  oldRefreshToken?: string;
}): Promise<OAuthTokenSet> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      authorization: basicAuthorization(input.clientId, input.clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  };
  const response = input.fetcher
    ? await input.fetcher(OAUTH_ENDPOINTS.token, requestInit)
    : await fetch(OAUTH_ENDPOINTS.token, requestInit);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`OAuth token request failed: ${String(payload.error ?? response.status)}`);
  return tokenSet(payload, input.nowMs, input.oldRefreshToken);
}

export function verifyOAuthCallback(url: URL, expectedState: string): string {
  const error = url.searchParams.get("error");
  if (error) throw new Error(`OAuth authorization failed: ${error}`);
  const state = url.searchParams.get("state") ?? "";
  if (!constantState(state, expectedState)) throw new Error("OAuth state mismatch");
  const code = url.searchParams.get("code")?.trim();
  if (!code) throw new Error("OAuth authorization code is missing");
  return code;
}

function constantState(actual: string, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function exchangeCode(input: {
  clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string; fetcher?: typeof fetch; nowMs?: number;
}): Promise<OAuthTokenSet> {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  }), input);
}

export async function refreshToken(input: {
  clientId: string; clientSecret: string; refreshToken: string; fetcher?: typeof fetch; nowMs?: number;
}): Promise<OAuthTokenSet> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken }), {
    ...input,
    oldRefreshToken: input.refreshToken,
  });
}

export async function revokeToken(input: {
  clientId: string; clientSecret: string; token: string; fetcher?: typeof fetch;
}): Promise<void> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      authorization: basicAuthorization(input.clientId, input.clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token: input.token, token_type_hint: "refresh_token" }),
  };
  const response = input.fetcher
    ? await input.fetcher(OAUTH_ENDPOINTS.revoke, requestInit)
    : await fetch(OAUTH_ENDPOINTS.revoke, requestInit);
  if (!response.ok) throw new Error(`OAuth token revocation failed: HTTP ${response.status}`);
}

export async function stateHash(state: string): Promise<string> {
  return sha256(state);
}
