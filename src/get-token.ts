/**
 * Gmail + Calendar OAuth Token Generator
 * Run: node dist/get-token.js
 *
 * Requires:
 *   export GMAIL_CLIENT_ID="..."
 *   export GMAIL_CLIENT_SECRET="..."
 */
import { OAuth2Client } from "google-auth-library";
import * as readline from "readline";

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\nERROR: Set environment variables first:\n");
  console.error('  export GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"');
  console.error('  export GMAIL_CLIENT_SECRET="your-client-secret"\n');
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const auth = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");

const authUrl = auth.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",           // forces refresh_token to be returned every time
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(res => rl.question(q, a => res(a.trim())));

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Gmail + Calendar MCP — Token Generator");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Step 1 — Open this URL in your browser:\n");
  console.log("  " + authUrl + "\n");
  console.log("Step 2 — Sign in and grant all permissions.");
  console.log("Step 3 — Copy the code shown on screen.\n");

  const code = await ask("Paste the code here and press Enter: ");
  if (!code) { console.error("No code entered."); rl.close(); process.exit(1); }

  console.log("\nExchanging code for tokens...");

  try {
    const { tokens } = await auth.getToken(code);

    if (!tokens.refresh_token) {
      console.error("\nERROR: No refresh token returned.");
      console.error("This happens when the app was already authorized.");
      console.error("Fix: Go to https://myaccount.google.com/permissions");
      console.error("     Remove access for this app, then run get-token again.\n");
      rl.close(); process.exit(1);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  SUCCESS — Add these to your Claude Desktop config:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const config = {
      mcpServers: {
        "gmail-calendar": {
          command: "node",
          args:    [`${process.cwd()}/dist/index.js`],
          env: {
            GMAIL_CLIENT_ID:     CLIENT_ID,
            GMAIL_CLIENT_SECRET: CLIENT_SECRET,
            GMAIL_REFRESH_TOKEN: tokens.refresh_token,
          },
        },
      },
    };

    console.log(JSON.stringify(config, null, 2));
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Config file location:");
    console.log("  Mac:     ~/Library/Application Support/Claude/claude_desktop_config.json");
    console.log("  Windows: %APPDATA%\\Claude\\claude_desktop_config.json");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid_grant") || msg.includes("Malformed")) {
      console.error("\nERROR: Invalid or expired auth code.");
      console.error("  • Each code can only be used ONCE");
      console.error("  • Codes expire after ~60 seconds");
      console.error("  • Run get-token again for a fresh URL and code\n");
    } else {
      console.error("\nERROR:", msg, "\n");
    }
    rl.close(); process.exit(1);
  }

  rl.close();
}

main();
