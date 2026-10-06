import { describe, expect, it } from "vitest";
import { ompCredentialStoreFrom } from "../src/auth.js";

const credential = { type: "oauth" as const, access: "workos:a", refresh: "r", expires: 1 };

describe("ompCredentialStoreFrom", () => {
  it("uses the OMP 18.7 credentials namespace", async () => {
    const writes: unknown[] = [];
    const credentials = {
      getOAuth(provider: string) {
        expect(this).toBe(credentials);
        return provider === "clinepass" ? credential : undefined;
      },
      async set(provider: string, value: unknown) {
        expect(this).toBe(credentials);
        writes.push([provider, value]);
      },
    };
    const store = ompCredentialStoreFrom({ credentials }, "clinepass");
    expect(store?.read()).toEqual(credential);
    await store?.write(credential);
    expect(writes).toEqual([["clinepass", credential]]);
  });

  it("falls back to the flat pre-18.7 methods", async () => {
    const writes: unknown[] = [];
    const legacy = {
      getOAuthCredential(provider: string) {
        expect(this).toBe(legacy);
        return provider === "clinepass" ? credential : undefined;
      },
      async set(provider: string, value: unknown) {
        writes.push([provider, value]);
      },
    };
    const store = ompCredentialStoreFrom(legacy, "clinepass");
    expect(store?.read()).toEqual(credential);
    await store?.write(credential);
    expect(writes).toEqual([["clinepass", credential]]);
  });

  it("returns undefined for an unknown host shape instead of binding a throwing reader", () => {
    expect(ompCredentialStoreFrom(undefined, "clinepass")).toBeUndefined();
    expect(ompCredentialStoreFrom({ credentials: {} }, "clinepass")).toBeUndefined();
    expect(ompCredentialStoreFrom({ getOAuthCredential: () => credential }, "clinepass")).toBeUndefined();
  });
});
