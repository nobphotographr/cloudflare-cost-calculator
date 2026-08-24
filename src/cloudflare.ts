import type { AccountOption } from "./session";

export async function listAuthorizedAccounts(accessToken: string, fetcher?: typeof fetch): Promise<AccountOption[]> {
  const requestInit: RequestInit = {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  };
  const response = fetcher
    ? await fetcher("https://api.cloudflare.com/client/v4/accounts?per_page=50", requestInit)
    : await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", requestInit);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.success !== true || !Array.isArray(payload.result)) {
    throw new Error(`Cloudflare account lookup failed: HTTP ${response.status}`);
  }
  return payload.result.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const account = entry as Record<string, unknown>;
    return typeof account.id === "string" && /^[a-f0-9]{32}$/.test(account.id) && typeof account.name === "string"
      ? [{ id: account.id, name: account.name }] : [];
  });
}
