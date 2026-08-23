import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken } from "../src/crypto";

describe("OAuth secret storage", () => {
  it("tokenをAES-GCMで暗号化し、正しい鍵だけで復号する", async () => {
    const secret = "correct-secret-that-is-longer-than-32-characters";
    const encrypted = await encrypt("refresh-token", secret, (target) => {
      target.fill(7);
      return target;
    });
    expect(encrypted).not.toContain("refresh-token");
    await expect(decrypt(encrypted, secret)).resolves.toBe("refresh-token");
    await expect(decrypt(encrypted, "wrong-secret-that-is-longer-than-32-characters")).rejects.toThrow();
  });

  it("セッショントークンに十分なエントロピーを確保する", () => {
    expect(randomToken(32, (target) => {
      target.fill(3);
      return target;
    })).toHaveLength(43);
  });
});
