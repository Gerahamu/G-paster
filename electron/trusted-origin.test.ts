import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  EXPECTED_LOCAL_DEV_ORIGIN,
  getDevServerOrigin,
  getTrustedAppFileUrl,
  isTrustedPageUrl,
  type TrustedOriginPolicy
} from "./trusted-origin";

describe("trusted-origin security policy (M-01)", () => {
  const dummyAppPath = "/mock/Applications/G-paster.app/Contents/Resources/app.asar";
  const expectedAppFileUrl = pathToFileURL(join(dummyAppPath, "dist", "index.html")).href;

  it("produces exact file URL to dist/index.html", () => {
    assert.equal(getTrustedAppFileUrl(dummyAppPath), expectedAppFileUrl);
    assert.ok(expectedAppFileUrl.startsWith("file:///"));
    assert.ok(expectedAppFileUrl.endsWith("/dist/index.html"));
  });

  describe("dev server origin restriction (scripts/dev.mjs)", () => {
    it("allows only the explicit local development address from scripts/dev.mjs", () => {
      assert.equal(getDevServerOrigin("http://127.0.0.1:5173"), EXPECTED_LOCAL_DEV_ORIGIN);
      assert.equal(getDevServerOrigin("http://127.0.0.1:5173/"), EXPECTED_LOCAL_DEV_ORIGIN);
      assert.equal(getDevServerOrigin("http://127.0.0.1:5173/path?query=1"), EXPECTED_LOCAL_DEV_ORIGIN);
    });

    it("strictly rejects arbitrary remote HTTP/HTTPS addresses specified via environment variable", () => {
      assert.equal(getDevServerOrigin("https://attacker.example.com"), null);
      assert.equal(getDevServerOrigin("http://attacker.example.com:5173"), null);
      assert.equal(getDevServerOrigin("http://192.168.1.100:5173"), null);
      assert.equal(getDevServerOrigin("https://remote.internal:5173"), null);
      assert.equal(getDevServerOrigin("http://localhost:5173"), null); // Must strictly match 127.0.0.1:5173
      assert.equal(getDevServerOrigin("http://127.0.0.1:3000"), null); // Non-matching port rejected
      assert.equal(getDevServerOrigin("not-a-valid-url"), null);
      assert.equal(getDevServerOrigin("javascript:alert(1)"), null);
      assert.equal(getDevServerOrigin(""), null);
      assert.equal(getDevServerOrigin(undefined), null);
    });
  });

  describe("production mode (isPackaged === true)", () => {
    const prodPolicyWithInjectedDevUrl: TrustedOriginPolicy = {
      isPackaged: true,
      devServerUrl: "http://127.0.0.1:5173", // Even if valid dev url is injected
      appPath: dummyAppPath
    };

    it("strictly ignores VITE_DEV_SERVER_URL in production", () => {
      assert.equal(
        isTrustedPageUrl("http://127.0.0.1:5173", prodPolicyWithInjectedDevUrl),
        false,
        "Production must NEVER trust devServerUrl"
      );
      assert.equal(
        isTrustedPageUrl("http://attacker.example.com:5173", prodPolicyWithInjectedDevUrl),
        false
      );
    });

    it("strictly matches only the application entry file URL", () => {
      assert.equal(
        isTrustedPageUrl(expectedAppFileUrl, prodPolicyWithInjectedDevUrl),
        true,
        "Must trust exact application entry file"
      );
    });

    it("rejects arbitrary file:// URLs and null/empty origins", () => {
      assert.equal(isTrustedPageUrl("file:///etc/passwd", prodPolicyWithInjectedDevUrl), false);
      assert.equal(isTrustedPageUrl("file:///Users/apple/Desktop/evil.html", prodPolicyWithInjectedDevUrl), false);
      assert.equal(isTrustedPageUrl("file:///mock/Applications/G-paster.app/Contents/Resources/other.html", prodPolicyWithInjectedDevUrl), false);
      assert.equal(isTrustedPageUrl("", prodPolicyWithInjectedDevUrl), false);
      assert.equal(isTrustedPageUrl("about:blank", prodPolicyWithInjectedDevUrl), false);
      assert.equal(isTrustedPageUrl("javascript:void(0)", prodPolicyWithInjectedDevUrl), false);
    });
  });

  describe("development mode (isPackaged === false)", () => {
    const validDevPolicy: TrustedOriginPolicy = {
      isPackaged: false,
      devServerUrl: "http://127.0.0.1:5173",
      appPath: dummyAppPath
    };

    it("trusts matching development server origin and its sub-paths", () => {
      assert.equal(isTrustedPageUrl("http://127.0.0.1:5173", validDevPolicy), true);
      assert.equal(isTrustedPageUrl("http://127.0.0.1:5173/", validDevPolicy), true);
      assert.equal(isTrustedPageUrl("http://127.0.0.1:5173/sub/page", validDevPolicy), true);
    });

    it("rejects non-matching origins in development mode", () => {
      assert.equal(isTrustedPageUrl("http://127.0.0.1:8080", validDevPolicy), false);
      assert.equal(isTrustedPageUrl("http://localhost:5173", validDevPolicy), false);
      assert.equal(isTrustedPageUrl("https://evil.com", validDevPolicy), false);
      assert.equal(isTrustedPageUrl("file:///etc/passwd", validDevPolicy), false);
    });

    it("strictly rejects remote devServerUrl specified via environment variable and falls back to entry file", () => {
      const devPolicyWithRemoteAttackerUrl: TrustedOriginPolicy = {
        isPackaged: false,
        devServerUrl: "https://attacker.example.com",
        appPath: dummyAppPath
      };

      assert.equal(
        isTrustedPageUrl("https://attacker.example.com", devPolicyWithRemoteAttackerUrl),
        false,
        "Remote URL must NOT be trusted even if specified in devServerUrl"
      );
      assert.equal(
        isTrustedPageUrl(expectedAppFileUrl, devPolicyWithRemoteAttackerUrl),
        true,
        "Must safely fall back to local entry file URL"
      );
    });

    it("falls back to entry file if devServerUrl is missing or invalid in development mode", () => {
      const devPolicyNoUrl: TrustedOriginPolicy = {
        isPackaged: false,
        devServerUrl: undefined,
        appPath: dummyAppPath
      };
      assert.equal(isTrustedPageUrl(expectedAppFileUrl, devPolicyNoUrl), true);
      assert.equal(isTrustedPageUrl("http://127.0.0.1:5173", devPolicyNoUrl), false);

      const devPolicyMalformed: TrustedOriginPolicy = {
        isPackaged: false,
        devServerUrl: "bad-url",
        appPath: dummyAppPath
      };
      assert.equal(isTrustedPageUrl(expectedAppFileUrl, devPolicyMalformed), true);
    });
  });
});
