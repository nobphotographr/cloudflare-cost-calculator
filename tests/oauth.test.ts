import { describe, expect, it } from "vitest";
import { createOAuthRequest, exchangeCode, refreshToken, revokeTokenSet } from "../src/oauth";

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
    const requests: Array<{ url: string; body: string }> = [];
    const fetcher: typeof fetch = async (request, init) => {
      requests.push({ url: String(request), body: String(init?.body) });
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
    const revoked = await revokeTokenSet({
      clientId: "client",
      clientSecret: "secret",
      accessToken: "new-access",
      refreshToken: "old-refresh",
      fetcher,
    });
    expect(revoked).toBe(true);
    expect(requests).toEqual([
      { url: "https://dash.cloudflare.com/oauth2/token", body: "grant_type=refresh_token&refresh_token=old-refresh" },
      { url: "https://dash.cloudflare.com/oauth2/revoke", body: "token=old-refresh&token_type_hint=refresh_token" },
      { url: "https://dash.cloudflare.com/oauth2/revoke", body: "token=new-access&token_type_hint=access_token" },
    ]);
  });

  it("一方のtoken失効が失敗しても他方を試す", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (_request, init) => {
      const body = String(init?.body);
      requests.push(body);
      return new Response(null, { status: body.includes("refresh_token") ? 400 : 200 });
    };

    const revoked = await revokeTokenSet({
      clientId: "client",
      clientSecret: "secret",
      accessToken: "access",
      refreshToken: "refresh",
      fetcher,
    });

    expect(revoked).toBe(false);
    expect(requests).toEqual([
      "token=refresh&token_type_hint=refresh_token",
      "token=access&token_type_hint=access_token",
    ]);
  });

  it("どちらのtoken失効も拒否された場合は失敗を返す", async () => {
    const fetcher: typeof fetch = async () => new Response(null, { status: 503 });
    await expect(revokeTokenSet({
      clientId: "client",
      clientSecret: "secret",
      accessToken: "access",
      refreshToken: "refresh",
      fetcher,
    })).resolves.toBe(false);
  });
});
