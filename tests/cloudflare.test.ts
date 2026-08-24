import { describe, expect, it } from "vitest";
import { listAuthorizedAccounts } from "../src/cloudflare";

describe("Cloudflare REST API", () => {
  it("認可済みアカウントだけを選択肢へ変換する", async () => {
    const fetcher: typeof fetch = async (_request, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      return new Response(JSON.stringify({
        success: true,
        result: [
          { id: "a".repeat(32), name: "Production" },
          { id: "invalid", name: "Ignored" },
          { id: "b".repeat(32) },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await expect(listAuthorizedAccounts("access-token", fetcher)).resolves.toEqual([
      { id: "a".repeat(32), name: "Production" },
    ]);
  });
});
