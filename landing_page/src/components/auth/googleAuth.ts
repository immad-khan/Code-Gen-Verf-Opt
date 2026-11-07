import type { ProviderProfile } from "../../auth";

export const GOOGLE_CLIENT_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID) ||
  "724059477347-65enihkadmge4a1ieuq4k0v4dqcupi0t.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
            error_callback?: (err: unknown) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

/**
 * Loads the Google Identity Services client if not already loaded.
 */
function loadGoogleGsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")));
      // If already loaded before listener attached
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

/**
 * Triggers the official Google OAuth popup and fetches the user profile.
 */
export async function signInWithGoogle(): Promise<ProviderProfile> {
  await loadGoogleGsiScript();

  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services not available");
  }

  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "email profile openid",
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            return reject(new Error(tokenResponse.error_description || tokenResponse.error));
          }

          if (!tokenResponse.access_token) {
            return reject(new Error("No access token returned from Google"));
          }

          try {
            const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
            });

            if (!res.ok) {
              throw new Error(`Google UserInfo error: ${res.status}`);
            }

            const data = await res.json();
            const profile: ProviderProfile = {
              id: data.sub || `google_${Date.now()}`,
              name: data.name || data.email?.split("@")[0] || "Google User",
              email: data.email,
            };

            resolve(profile);
          } catch (fetchErr) {
            reject(fetchErr);
          }
        },
        error_callback: (err) => {
          reject(err);
        },
      });

      // Prompt account selection
      client.requestAccessToken({ prompt: "select_account" });
    } catch (err) {
      reject(err);
    }
  });
}
