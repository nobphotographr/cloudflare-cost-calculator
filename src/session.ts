import { constantTimeEqual, decrypt, encrypt, randomToken, sha256 } from "./crypto";
import type { OAuthTokenSet } from "./oauth";

export type AccountOption = { id: string; name: string };

type SessionRow = {
  session_hash: string;
  state_hash: string;
  code_verifier_encrypted: string;
  token_set_encrypted: string | null;
  account_options_json: string;
  selected_account_id: string | null;
  selected_account_name: string | null;
  status: "authorizing" | "connected" | "expired" | "failed";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type ConnectedSession = {
  sessionHash: string;
  tokenSet: OAuthTokenSet;
  accounts: AccountOption[];
  selectedAccount?: AccountOption;
  expiresAt: string;
};

export async function createPendingSession(input: {
  db: D1Database;
  state: string;
  codeVerifier: string;
  encryptionSecret: string;
  expiresAt: string;
  nowMs?: number;
}): Promise<string> {
  const cookieToken = randomToken(32);
  const sessionHash = await sha256(cookieToken);
  const now = new Date(input.nowMs ?? Date.now()).toISOString();
  await input.db.prepare(`INSERT INTO oauth_sessions (
    session_hash, state_hash, code_verifier_encrypted, status, expires_at, created_at, updated_at
  ) VALUES (?1, ?2, ?3, 'authorizing', ?4, ?5, ?5)`).bind(
    sessionHash,
    await sha256(input.state),
    await encrypt(input.codeVerifier, input.encryptionSecret),
    input.expiresAt,
    now,
  ).run();
  return cookieToken;
}

async function rowForCookie(db: D1Database, cookieToken: string): Promise<SessionRow | null> {
  if (!cookieToken || cookieToken.length > 256) return null;
  return db.prepare("SELECT * FROM oauth_sessions WHERE session_hash = ?1").bind(await sha256(cookieToken)).first<SessionRow>();
}

function validAccounts(value: string): AccountOption[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const account = entry as Record<string, unknown>;
      return typeof account.id === "string" && /^[a-f0-9]{32}$/.test(account.id) && typeof account.name === "string"
        ? [{ id: account.id, name: account.name }] : [];
    });
  } catch {
    return [];
  }
}

export async function openPendingSession(input: {
  db: D1Database;
  cookieToken: string;
  state: string;
  encryptionSecret: string;
  nowMs?: number;
}): Promise<{ sessionHash: string; codeVerifier: string }> {
  const row = await rowForCookie(input.db, input.cookieToken);
  const nowMs = input.nowMs ?? Date.now();
  if (!row || row.status !== "authorizing" || Date.parse(row.expires_at) <= nowMs) throw new Error("OAuth session expired");
  const actualStateHash = await sha256(input.state);
  if (!constantTimeEqual(actualStateHash, row.state_hash)) throw new Error("OAuth state mismatch");
  return {
    sessionHash: row.session_hash,
    codeVerifier: await decrypt(row.code_verifier_encrypted, input.encryptionSecret),
  };
}

export async function connectSession(input: {
  db: D1Database;
  sessionHash: string;
  tokenSet: OAuthTokenSet;
  accounts: AccountOption[];
  encryptionSecret: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const selected = input.accounts.length === 1 ? input.accounts[0] : undefined;
  await input.db.prepare(`UPDATE oauth_sessions SET
    token_set_encrypted = ?1,
    account_options_json = ?2,
    selected_account_id = ?3,
    selected_account_name = ?4,
    status = 'connected',
    expires_at = ?5,
    updated_at = ?6
    WHERE session_hash = ?7 AND status = 'authorizing'`).bind(
    await encrypt(JSON.stringify(input.tokenSet), input.encryptionSecret),
    JSON.stringify(input.accounts),
    selected?.id ?? null,
    selected?.name ?? null,
    new Date(nowMs + 30 * 86_400_000).toISOString(),
    now,
    input.sessionHash,
  ).run();
}

export async function readConnectedSession(input: {
  db: D1Database;
  cookieToken: string;
  encryptionSecret: string;
  nowMs?: number;
}): Promise<ConnectedSession | null> {
  const row = await rowForCookie(input.db, input.cookieToken);
  if (!row || row.status !== "connected" || !row.token_set_encrypted || Date.parse(row.expires_at) <= (input.nowMs ?? Date.now())) return null;
  const parsed = JSON.parse(await decrypt(row.token_set_encrypted, input.encryptionSecret)) as OAuthTokenSet;
  if (!parsed || typeof parsed.accessToken !== "string" || !Array.isArray(parsed.scope)) throw new Error("Stored OAuth token is invalid");
  const accounts = validAccounts(row.account_options_json);
  const selectedAccount = row.selected_account_id && row.selected_account_name
    ? { id: row.selected_account_id, name: row.selected_account_name } : undefined;
  return { sessionHash: row.session_hash, tokenSet: parsed, accounts, selectedAccount, expiresAt: row.expires_at };
}

export async function updateTokenSet(input: {
  db: D1Database;
  sessionHash: string;
  tokenSet: OAuthTokenSet;
  encryptionSecret: string;
  nowMs?: number;
}): Promise<void> {
  await input.db.prepare("UPDATE oauth_sessions SET token_set_encrypted = ?1, updated_at = ?2 WHERE session_hash = ?3 AND status = 'connected'").bind(
    await encrypt(JSON.stringify(input.tokenSet), input.encryptionSecret),
    new Date(input.nowMs ?? Date.now()).toISOString(),
    input.sessionHash,
  ).run();
}

export async function selectAccount(input: {
  db: D1Database;
  sessionHash: string;
  accountId: string;
  accounts: AccountOption[];
  nowMs?: number;
}): Promise<AccountOption> {
  const selected = input.accounts.find((account) => account.id === input.accountId);
  if (!selected) throw new Error("Account is not authorized for this session");
  await input.db.prepare("UPDATE oauth_sessions SET selected_account_id = ?1, selected_account_name = ?2, updated_at = ?3 WHERE session_hash = ?4 AND status = 'connected'").bind(
    selected.id,
    selected.name,
    new Date(input.nowMs ?? Date.now()).toISOString(),
    input.sessionHash,
  ).run();
  return selected;
}

export async function deleteSession(db: D1Database, sessionHash: string): Promise<void> {
  await db.prepare("DELETE FROM oauth_sessions WHERE session_hash = ?1").bind(sessionHash).run();
}

export async function cleanupSessions(db: D1Database, now = new Date()): Promise<number> {
  const result = await db.prepare("DELETE FROM oauth_sessions WHERE expires_at <= ?1").bind(now.toISOString()).run();
  return result.meta.changes ?? 0;
}
