import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAuth, gmailClient, calendarClient } from "./auth.js";
import { registerGmailTools } from "./tools/gmail.js";
import { registerCalendarTools } from "./tools/calendar.js";

async function main() {
  // Validate env vars early — fail with a clear message
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    console.error([
      "ERROR: Missing required environment variables.",
      "",
      "Required:",
      "  GMAIL_CLIENT_ID      - from Google Cloud Console",
      "  GMAIL_CLIENT_SECRET  - from Google Cloud Console",
      "  GMAIL_REFRESH_TOKEN  - generated via get-token.js",
      "",
      "To generate a refresh token run:",
      "  node dist/get-token.js",
    ].join("\n"));
    process.exit(1);
  }

  const auth     = createAuth();
  const gmail    = gmailClient(auth);
  const calendar = calendarClient(auth);

  const server = new McpServer({
    name:    "gmail-calendar-mcp",
    version: "3.0.0",
  });

  registerGmailTools(server, gmail);
  registerCalendarTools(server, calendar);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the MCP stdio channel
  console.error("Gmail + Calendar MCP server running (stdio)");
}

main().catch(err => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
