import type { ProviderProfile } from "../../auth";

export const GITHUB_CLIENT_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_GITHUB_CLIENT_ID) ||
  "Ov23libA6ZxKhurjAojQ";

const BACKEND_URL = (
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL?.trim()) ||
  (typeof import.meta !== "undefined" && import.meta.env?.PROD ? "https://code-gen-verf-opt.onrender.com" : "http://localhost:5000")
).replace(/\/+$/, "");

/**
 * Initiates the real GitHub OAuth 2.0 flow via popup or redirect.
 */
export async function signInWithGitHub(): Promise<ProviderProfile> {
  const redirectUri = window.location.origin;
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=user:email,read:user&redirect_uri=${encodeURIComponent(
    redirectUri
  )}`;

  const width = 600;
  const height = 720;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    authUrl,
    "github_oauth",
    `width=${width},height=${height},left=${left},top=${top},status=0,menubar=0,toolbar=0`
  );

  if (!popup) {
    // Popup blocked: redirect directly
    window.location.href = authUrl;
    return new Promise(() => {}); // Execution ends as page unloads
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    // Check popup URL periodically for the returned code
    const checkTimer = window.setInterval(async () => {
      try {
        if (!popup || popup.closed) {
          window.clearInterval(checkTimer);
          if (!resolved) {
            reject(new Error("GitHub authorization popup closed."));
          }
          return;
        }

        // Try reading popup location (accessible once redirected back to same origin)
        const currentUrl = popup.location.href;
        if (currentUrl && currentUrl.includes(window.location.origin)) {
          const urlObj = new URL(currentUrl);
          const code = urlObj.searchParams.get("code");
          const error = urlObj.searchParams.get("error_description") || urlObj.searchParams.get("error");

          if (error) {
            window.clearInterval(checkTimer);
            resolved = true;
            popup.close();
            reject(new Error(error));
            return;
          }

          if (code) {
            window.clearInterval(checkTimer);
            resolved = true;
            popup.close();

            // Exchange code via Backend API
            try {
              const res = await fetch(`${BACKEND_URL}/api/auth/github`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, redirectUri }),
              });

              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `GitHub exchange error ${res.status}`);
              }

              const data = await res.json();
              if (data.ok && data.user) {
                resolve({
                  id: String(data.user.id),
                  name: data.user.name,
                  email: data.user.email,
                });
              } else {
                throw new Error("Invalid response from server");
              }
            } catch (backendErr) {
              reject(backendErr);
            }
          }
        }
      } catch {
        // Cross-origin restriction while on github.com domain - normal and expected until redirect
      }
    }, 400);
  });
}
