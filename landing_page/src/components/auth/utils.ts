export type Mode = "login" | "signup";
export type Step = "details" | "method" | "otp" | "social";

export type Form = {
  name: string;
  email: string;
  country: string;
  phone: string;
  password: string;
  confirm: string;
  terms: boolean;
  remember: boolean;
};

export type Errors = Partial<Record<"name" | "email" | "phone" | "password" | "confirm" | "terms" | "form", string>>;
export type Notice = { kind: "info" | "success"; text: string } | null;

export type Country = { code: string; name: string; dial: string; len?: number };

export const COUNTRIES: Country[] = (
  [
    { code: "IN", name: "India", dial: "+91", len: 10 },
    { code: "US", name: "United States", dial: "+1", len: 10 },
    { code: "CA", name: "Canada", dial: "+1", len: 10 },
    { code: "GB", name: "United Kingdom", dial: "+44" },
    { code: "AU", name: "Australia", dial: "+61" },
    { code: "NZ", name: "New Zealand", dial: "+64" },
    { code: "IE", name: "Ireland", dial: "+353" },
    { code: "DE", name: "Germany", dial: "+49" },
    { code: "FR", name: "France", dial: "+33" },
    { code: "ES", name: "Spain", dial: "+34" },
    { code: "IT", name: "Italy", dial: "+39" },
    { code: "NL", name: "Netherlands", dial: "+31" },
    { code: "TR", name: "Türkiye", dial: "+90" },
    { code: "AE", name: "United Arab Emirates", dial: "+971" },
    { code: "SA", name: "Saudi Arabia", dial: "+966" },
    { code: "EG", name: "Egypt", dial: "+20" },
    { code: "NG", name: "Nigeria", dial: "+234" },
    { code: "KE", name: "Kenya", dial: "+254" },
    { code: "ZA", name: "South Africa", dial: "+27" },
    { code: "PK", name: "Pakistan", dial: "+92" },
    { code: "BD", name: "Bangladesh", dial: "+880" },
    { code: "LK", name: "Sri Lanka", dial: "+94" },
    { code: "NP", name: "Nepal", dial: "+977" },
    { code: "SG", name: "Singapore", dial: "+65" },
    { code: "MY", name: "Malaysia", dial: "+60" },
    { code: "ID", name: "Indonesia", dial: "+62" },
    { code: "PH", name: "Philippines", dial: "+63" },
    { code: "JP", name: "Japan", dial: "+81" },
    { code: "KR", name: "South Korea", dial: "+82" },
    { code: "CN", name: "China", dial: "+86" },
    { code: "BR", name: "Brazil", dial: "+55" },
    { code: "MX", name: "Mexico", dial: "+52" },
  ] as Country[]
).sort((a, b) => a.name.localeCompare(b.name));

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function countryOf(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/** Guess the dial code from the browser locale, e.g. en-IN -> India. */
export function guessCountry(): string {
  const region = (typeof navigator !== "undefined" ? navigator.language : "").split("-")[1]?.toUpperCase();
  return region && COUNTRIES.some((c) => c.code === region) ? region : "US";
}

export function nationalDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

export function validatePhone(code: string, raw: string): string | null {
  const c = countryOf(code);
  const d = nationalDigits(raw);
  if (!d) return "Enter your mobile number.";
  if (c.len) {
    if (d.length !== c.len) return `Enter a valid ${c.len}-digit number for ${c.name}.`;
  } else if (d.length < 6 || d.length > 14) {
    return "Enter a valid phone number.";
  }
  return null;
}

export function toE164(code: string, raw: string): string {
  return countryOf(code).dial + nationalDigits(raw);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.trim().split("@");
  if (!user || !domain) return email;
  return `${user[0]}${"•".repeat(Math.max(2, Math.min(user.length - 1, 5)))}@${domain}`;
}

export function maskPhone(code: string, raw: string): string {
  const d = nationalDigits(raw);
  return `${countryOf(code).dial} ${"•".repeat(Math.max(3, d.length - 3))} ${d.slice(-3)}`;
}

export function initialOf(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}

const AVATAR_COLORS = ["#7c3aed", "#db2777", "#0891b2", "#16a34a", "#ea580c", "#2563eb", "#9333ea"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function strengthOf(pw: string): { score: number; label: string; tone: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const tones = ["bg-rose-400", "bg-rose-400", "bg-amber-400", "bg-lime-500", "bg-emerald-500"];
  return { score, label: labels[score], tone: tones[score] };
}
