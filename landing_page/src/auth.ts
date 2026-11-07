export type SessionUser = { name: string; email: string; phone?: string };
export type OtpChannel = "sms" | "email";
export type Provider = "github" | "google";
export type AuthVia = OtpChannel | Provider;
export type ProviderProfile = { id: string; name: string; email: string };

type StoredUser = SessionUser & {
  hash: string;
  createdAt: number;
  providers?: Partial<Record<Provider, string>>;
};

export const OTP_LENGTH = 6;
export const OTP_TTL_MIN = 5;
export const RESEND_COOLDOWN_S = 30;
const OTP_MAX_ATTEMPTS = 5;

const USERS_KEY = "vf.users";
const SESSION_KEY = "vf.session";
const PROVIDER_ACCOUNTS_KEY = "vf.providerAccounts";
const LEGACY_DEMO_EMAIL = "demo@veriflow.dev"; // seeded by an earlier build, now purged

const BACKEND_URL = (
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL?.trim()) ||
  (typeof import.meta !== "undefined" && import.meta.env?.PROD ? 'https://code-gen-verf-opt.onrender.com' : 'http://localhost:5000')
).replace(/\/+$/, '');

async function syncUserToBackend(user: { name: string; email: string; phone?: string; password?: string; provider?: string; providerId?: string }) {
  try {
    await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        password: user.password || 'OAuthUser!2026',
        provider: user.provider || 'local',
        providerId: user.providerId || null,
      }),
    });
  } catch (e) {
    console.debug('Backend auth sync skipped:', e);
  }
}

async function syncGoogleUserToBackend(profile: ProviderProfile) {
  try {
    await fetch(`${BACKEND_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: profile.email,
        name: profile.name,
        providerId: profile.id,
      }),
    });
  } catch (e) {
    console.debug('Backend Google auth sync skipped:', e);
  }
}

/* ------------------------------------------------------------------ */
/* local user store                                                    */
/* ------------------------------------------------------------------ */

function readUsers(): StoredUser[] {
  try {
    const all = JSON.parse(localStorage.getItem(USERS_KEY) || "[]") as StoredUser[];
    return all.filter((u) => u.email !== LEGACY_DEMO_EMAIL);
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function hashPassword(pw: string): Promise<string> {
  const input = "vf::" + pw;
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "fb_" + djb2(input);
  }
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function toSession(u: StoredUser): SessionUser {
  return { name: u.name, email: u.email, phone: u.phone };
}

export type FieldError = { ok: false; field: "email" | "phone" | "password" | "form"; error: string };
export type AuthResult = { ok: true; user: SessionUser } | FieldError;
export type AvailabilityResult = { ok: true } | FieldError;

function findConflict(users: StoredUser[], email: string, phone: string): FieldError | null {
  if (users.some((u) => u.email === email)) {
    return { ok: false, field: "email", error: "An account with this email already exists. Log in instead." };
  }
  if (users.some((u) => u.phone === phone)) {
    return { ok: false, field: "phone", error: "This phone number is already registered. Log in instead." };
  }
  return null;
}

/** Early duplicate check so people learn about conflicts before a code is sent. */
export async function checkAvailable(email: string, phone: string): Promise<AvailabilityResult> {
  const conflict = findConflict(readUsers(), email.trim().toLowerCase(), phone);
  return conflict ?? { ok: true };
}

/**
 * Creates the account. Called after the one-time code is verified, or after a
 * GitHub / Google profile has been completed with a phone number and password.
 */
export async function createAccount(
  input: { name: string; email: string; phone: string; password: string; provider?: { name: Provider; id: string } },
  remember: boolean
): Promise<AuthResult> {
  const users = readUsers();
  const email = input.email.trim().toLowerCase();
  const conflict = findConflict(users, email, input.phone);
  if (conflict) return conflict;
  const user: StoredUser = {
    name: input.name.trim(),
    email,
    phone: input.phone,
    hash: await hashPassword(input.password),
    createdAt: Date.now(),
    ...(input.provider ? { providers: { [input.provider.name]: input.provider.id } } : {}),
  };
  users.push(user);
  writeUsers(users);
  const session = toSession(user);
  setSession(session, remember);
  void syncUserToBackend({
    name: input.name,
    email,
    phone: input.phone,
    password: input.password,
    provider: input.provider?.name,
    providerId: input.provider?.id,
  });
  return { ok: true, user: session };
}

export async function signIn(email: string, password: string, remember: boolean): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();
  const user = readUsers().find((u) => u.email === normalized);
  if (!user) {
    return { ok: false, field: "email", error: "No account found for this email. Create one first." };
  }
  if ((await hashPassword(password)) !== user.hash) {
    return { ok: false, field: "password", error: "Incorrect password. Try again." };
  }
  const session = toSession(user);
  setSession(session, remember);
  if (provider === "google") {
    void syncGoogleUserToBackend(profile);
  }
  return { ok: true, user: session };
}

export async function requestReset(email: string): Promise<void> {
  void email;
}

/* ------------------------------------------------------------------ */
/* GitHub / Google                                                     */
/*                                                                     */
/* PREVIEW IMPLEMENTATION. Real OAuth needs a backend to exchange the  */
/* authorization code, so the provider screen is simulated in the      */
/* browser and hands back a profile {id, name, email}. In production,  */
/* replace ProviderModal with a redirect to your OAuth endpoint and    */
/* call signInWithProvider() with the profile your backend returns.    */
/* ------------------------------------------------------------------ */

export type ProviderSignInResult = { ok: true; user: SessionUser } | { ok: false; reason: "no_account" };

/** Signs in if an account is linked to this provider id or shares its (provider-verified) email. */
export async function signInWithProvider(provider: Provider, profile: ProviderProfile, remember: boolean): Promise<ProviderSignInResult> {
  const users = readUsers();
  const email = profile.email.trim().toLowerCase();
  const user = users.find((u) => u.providers?.[provider] === profile.id) ?? users.find((u) => u.email === email);
  if (!user) return { ok: false, reason: "no_account" };
  if (user.providers?.[provider] !== profile.id) {
    user.providers = { ...(user.providers ?? {}), [provider]: profile.id };
    writeUsers(users);
  }
  const session = toSession(user);
  setSession(session, remember);
  if (provider === "google") {
    void syncGoogleUserToBackend(profile);
  }
  return { ok: true, user: session };
}

/** Stable id for a simulated provider account, so the same email maps to the same account. */
export function providerAccountId(provider: Provider, email: string): string {
  return `${provider}_${djb2(`${provider}:${email.trim().toLowerCase()}`)}`;
}

type ProviderAccounts = Partial<Record<Provider, ProviderProfile[]>>;

function readProviderAccounts(): ProviderAccounts {
  try {
    return JSON.parse(localStorage.getItem(PROVIDER_ACCOUNTS_KEY) || "{}") as ProviderAccounts;
  } catch {
    return {};
  }
}

/** Accounts previously used with this provider on this device (the simulated account chooser). */
export function listProviderAccounts(provider: Provider): ProviderProfile[] {
  return readProviderAccounts()[provider] ?? [];
}

export function saveProviderAccount(provider: Provider, account: ProviderProfile) {
  const all = readProviderAccounts();
  const rest = (all[provider] ?? []).filter((a) => a.id !== account.id);
  all[provider] = [account, ...rest].slice(0, 5);
  localStorage.setItem(PROVIDER_ACCOUNTS_KEY, JSON.stringify(all));
}

export function removeProviderAccount(provider: Provider, id: string) {
  const all = readProviderAccounts();
  all[provider] = (all[provider] ?? []).filter((a) => a.id !== id);
  localStorage.setItem(PROVIDER_ACCOUNTS_KEY, JSON.stringify(all));
}

/* ------------------------------------------------------------------ */
/* one-time codes                                                      */
/*                                                                     */
/* PREVIEW IMPLEMENTATION. A static site cannot send SMS or email, so  */
/* sendOtp() generates the code in the browser and returns it for the  */
/* on-screen "demo inbox". For production, replace the bodies of       */
/* sendOtp() / verifyOtp() with calls to your backend (Twilio Verify,  */
/* Firebase Auth, SES, ...). The UI does not need to change.           */
/* ------------------------------------------------------------------ */

type OtpState = { code: string; expiresAt: number; attempts: number };
let otp: OtpState | null = null;

function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(OTP_LENGTH, "0");
}

export async function sendOtp(channel: OtpChannel, to: string): Promise<{ code: string; expiresAt: number }> {
  void channel;
  void to;
  await new Promise((r) => setTimeout(r, 420)); // network latency stand-in
  const code = randomCode();
  otp = { code, expiresAt: Date.now() + OTP_TTL_MIN * 60_000, attempts: 0 };
  return { code, expiresAt: otp.expiresAt };
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "none" | "expired" | "locked" | "wrong"; attemptsLeft: number };

export function verifyOtp(input: string): OtpResult {
  if (!otp) return { ok: false, reason: "none", attemptsLeft: 0 };
  if (Date.now() > otp.expiresAt) {
    otp = null;
    return { ok: false, reason: "expired", attemptsLeft: 0 };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked", attemptsLeft: 0 };
  if (input !== otp.code) {
    otp.attempts += 1;
    const attemptsLeft = OTP_MAX_ATTEMPTS - otp.attempts;
    return { ok: false, reason: attemptsLeft <= 0 ? "locked" : "wrong", attemptsLeft };
  }
  otp = null;
  return { ok: true };
}

export function clearOtp() {
  otp = null;
}

/* ------------------------------------------------------------------ */
/* session + newsletter                                                */
/* ------------------------------------------------------------------ */

export function setSession(user: SessionUser, remember: boolean) {
  const raw = JSON.stringify(user);
  if (remember) {
    localStorage.setItem(SESSION_KEY, raw);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, raw);
    localStorage.removeItem(SESSION_KEY);
  }
}

export function getSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    const user = raw ? (JSON.parse(raw) as SessionUser) : null;
    if (user && user.email === LEGACY_DEMO_EMAIL) {
      clearSession();
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function subscribeNewsletter(email: string): { ok: boolean; message: string } {
  const key = "vf.subscribers";
  const normalized = email.trim().toLowerCase();
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]") as string[];
    if (list.includes(normalized)) {
      return { ok: true, message: "You're already on the list. We'll keep you posted." };
    }
    list.push(normalized);
    localStorage.setItem(key, JSON.stringify(list));
    return { ok: true, message: "You're on the list. Research updates, no spam." };
  } catch {
    return { ok: true, message: "You're on the list. Research updates, no spam." };
  }
}
