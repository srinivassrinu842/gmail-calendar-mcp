import { OAuth2Client } from "google-auth-library";
import { google, gmail_v1, calendar_v3 } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export function createAuth(): OAuth2Client {
  const clientId     = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error("Missing env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN");
    process.exit(1);
  }

  const auth = new OAuth2Client(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export function gmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth });
}

export function calendarClient(auth: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth });
}

/** Friendly error message from any API error */
export function apiError(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    if (m.includes("invalid_grant"))           return "ERROR: Refresh token invalid/expired. Generate a new GMAIL_REFRESH_TOKEN.";
    if (m.includes("insufficient"))            return "ERROR: Missing OAuth scopes. Re-generate token with all required scopes.";
    if (m.includes("rateLimitExceeded"))       return "ERROR: Gmail rate limit hit. Wait a moment and retry.";
    if (m.includes("notFound"))                return "ERROR: Resource not found — check the ID.";
    if (m.includes("ENOTFOUND"))               return "ERROR: No network access from this environment.";
    return `ERROR: ${m}`;
  }
  return `ERROR: ${String(e)}`;
}

export { SCOPES };
