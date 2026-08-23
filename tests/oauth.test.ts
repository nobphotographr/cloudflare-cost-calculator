import { describe, expect, it } from "vitest";
import { createOAuthRequest, exchangeCode, refreshToken, revokeToken } from "../src/oauth";

describe("Cloudflare OAuth", () => {
  it("PKCE付きの認可URLを作る", async () => {
    const request = await createOAuthRequest({
      clientId: "client-id",
      redirectUri: "https://cost.example.com/api/connect/callback",
      scopeIds: ["analytics.read", "analytics.read"],
      nowMs: Date.parse("2026-08-24T00:00:00Z"),
    });
    const url = new URL(request.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("analytics.read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.codeVerifier.length).toBeGreaterThan(40);
    expect(request.expiresAt).toBe("2026-08-24T00:10:00.000Z");
  });

  it("認可コードをtokenへ交換する", async () => {
    const fetcher: typeof fetch = async (_request, init) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
      return new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "bearer",
        expires_in: 3600,
        scope: "analytics.read account.read",
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const token = await exchangeCode({
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://cost.example.com/api/connect/callback",
      code: "code",
      codeVerifier: "verifier",
      fetcher,
      nowMs: Date.parse("2026-08-24T00:00:00Z"),
    });
    expect(token.accessToken).toBe("access");
    expect(token.scope).toEqual(["analytics.read", "account.read"]);
    expect(token.expiresAt).toBe("2026-08-24T01:00:00.000Z");
  });

  it("refresh tokenを引き継ぎ、切断時に失効させる", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (request) => {
      calls += 1;
      if (String(request).endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: "new-access", token_type: "Bearer", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 200 });
    };
    const refreshed = await refreshToken({ clientId: "client", clientSecret: "secret", refreshToken: "old-refresh", fetcher });
    expect(refreshed.refreshToken).toBe("old-refresh");
    await revokeToken({ clientId: "client", clientSecret: "secret", token: "old-refresh", fetcher });
    expect(calls).toBe(2);
  });
});
