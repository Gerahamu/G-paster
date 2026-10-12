import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface TrustedOriginPolicy {
  isPackaged: boolean;
  devServerUrl?: string;
  appPath: string;
}

/**
 * The explicit local development server origin configured in scripts/dev.mjs.
 * Arbitrary remote HTTP/HTTPS addresses specified via environment variables are strictly rejected.
 */
export const EXPECTED_LOCAL_DEV_ORIGIN = "http://127.0.0.1:5173";

export function getTrustedAppFileUrl(appPath: string): string {
  return pathToFileURL(join(appPath, "dist", "index.html")).href;
}

export function getDevServerOrigin(devServerUrl?: string): string | null {
  if (!devServerUrl) return null;
  try {
    const parsed = new URL(devServerUrl);
    // Explicitly restrict dev origin to scripts/dev.mjs local address (http://127.0.0.1:5173)
    // Strictly reject arbitrary remote or third-party HTTP/HTTPS origins
    if (parsed.origin === EXPECTED_LOCAL_DEV_ORIGIN) {
      return parsed.origin;
    }
  } catch {
    // Malformed URL falls back to safe behavior
  }
  return null;
}

export function isTrustedPageUrl(url: string, policy: TrustedOriginPolicy): boolean {
  if (!url || typeof url !== "string") return false;

  // Development mode: strictly only when not packaged and dev server matches local dev origin
  if (!policy.isPackaged && policy.devServerUrl) {
    const devOrigin = getDevServerOrigin(policy.devServerUrl);
    if (devOrigin) {
      try {
        return new URL(url).origin === devOrigin;
      } catch {
        return false;
      }
    }
  }

  // Production mode (or when dev server is invalid/remote/missing):
  // Must strictly match the exact application entry file URL.
  // We explicitly reject arbitrary file:// protocols or null origins.
  const appFileUrl = getTrustedAppFileUrl(policy.appPath);
  return url === appFileUrl;
}
