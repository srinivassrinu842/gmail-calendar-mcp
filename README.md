# Gmail & Google Calendar MCP Server

[![CI/CD Pipeline](https://github.com/srinivassrinu842/gmail-calendar-mcp/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/srinivassrinu842/gmail-calendar-mcp/actions/workflows/ci-cd.yml)
[![Node.js Support](https://img.shields.io/badge/node-18.x%20%7C%2020.x%20%7C%2022.x-blue.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-docker.io-blue.svg?logo=docker)](https://hub.docker.com)
[![Tests Status](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/srinivassrinu842/gmail-calendar-mcp/actions)

A Model Context Protocol (MCP) server that provides integration with Google Gmail and Google Calendar APIs. It allows LLMs to list, search, view, create, reply to, forward, and draft emails, as well as schedule, list, update, and manage calendar events.

## Features

- **Gmail Tools**: Profile viewing, message listing, rich search queries, thread reading, sending new emails, quoting replies, forwards, draft creation/management, custom labels, and attachment retrieval.
- **Calendar Tools**: Calendar listing, event viewing, scheduling, updating, cancelling, RSVP management, checking free/busy availability, and quick adding events using natural language.
- **Attachment Support**:
  - **Gmail**: Add attachments to emails and drafts by providing base64-encoded file data or local file paths (which are auto-read and encoded on the fly).
  - **Google Calendar**: Embed files (using Drive links or general URLs) directly inside event creations or updates.

---

## 1. Setup Google Cloud Console (Get ID & Secret)

To interact with the Google APIs, you must set up a project in Google Cloud:

1. **Create a Google Cloud Project**:
   - Visit the [Google Cloud Console](https://console.cloud.google.com/).
   - Click the project dropdown in the top navigation bar and select **New Project**.
2. **Enable Gmail and Calendar APIs**:
   - Search for **Gmail API** in the search bar, click on it, and click **Enable**.
   - Search for **Google Calendar API** in the search bar, click on it, and click **Enable**.
3. **Configure OAuth Consent Screen**:
   - Go to **APIs & Services** > **OAuth consent screen**.
   - Choose **External** user type and click **Create**.
   - Fill in the App Name (e.g., "Gmail Calendar MCP") and developer contact details.
   - Click **Save and Continue** until you reach the **Scopes** stage.
   - Add these scopes:
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.labels`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
   - In the **Test Users** screen, add the Google accounts you want to authorize (e.g., your personal email).
4. **Create Credentials**:
   - Navigate to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **OAuth client ID**.
   - Select **Desktop App** as the Application type.
   - Name it (e.g., "MCP Desktop Client") and click **Create**.
   - Copy the generated **Client ID** and **Client Secret**.

---

## 2. Generate OAuth Refresh Token

1. **Export Credentials**:
   In your terminal, export the newly created client details:
   ```bash
   export GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GMAIL_CLIENT_SECRET="your-client-secret"
   ```
2. **Build and Run Token Utility**:
   ```bash
   # Build the project
   npm run build

   # Execute the token generation script
   npm run get-token
   ```
3. **Authorize**:
   - Copy the printed URL, open it in your browser, sign in with your Google Account, and grant all requested scopes.
   - Google will show a code on the screen. Copy it, paste it back into your terminal prompt, and press **Enter**.
   - The utility will print out the finalized `mcpServers` configuration block containing your `GMAIL_REFRESH_TOKEN`.

---

## 3. Configuration in AI Clients

### A. Local Node.js Mode
Add this configuration block inside your AI configuration registry:

- **Claude Desktop**: Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Antigravity / VSCode**: Add to your editor's MCP server configuration.

```json
{
  "mcpServers": {
    "gmail-calendar": {
      "command": "node",
      "args": ["/absolute/path/to/gmail-calendar-mcp/dist/index.js"],
      "env": {
        "GMAIL_CLIENT_ID": "YOUR_CLIENT_ID",
        "GMAIL_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "GMAIL_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN"
      }
    }
  }
}
```

### B. Container Mode (Docker / Podman)
If you do not want to install Node.js locally, you can run the server in a sandbox using **Docker** or **Podman**.

#### 1. Build the Container Image
First, build the lightweight Docker image:
```bash
# Docker
docker build -t gmail-calendar-mcp:latest .

# Podman
podman build -t gmail-calendar-mcp:latest .
```

#### 2. Configure AI Client using Docker
Add the following to your AI configuration:
```json
{
  "mcpServers": {
    "gmail-calendar": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "GMAIL_CLIENT_ID=YOUR_CLIENT_ID",
        "-e", "GMAIL_CLIENT_SECRET=YOUR_CLIENT_SECRET",
        "-e", "GMAIL_REFRESH_TOKEN=YOUR_REFRESH_TOKEN",
        "gmail-calendar-mcp:latest"
      ]
    }
  }
}
```

#### 3. Configure AI Client using Podman
Add the following to your AI configuration:
```json
{
  "mcpServers": {
    "gmail-calendar": {
      "command": "podman",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "GMAIL_CLIENT_ID=YOUR_CLIENT_ID",
        "-e", "GMAIL_CLIENT_SECRET=YOUR_CLIENT_SECRET",
        "-e", "GMAIL_REFRESH_TOKEN=YOUR_REFRESH_TOKEN",
        "gmail-calendar-mcp:latest"
      ]
    }
  }
}
```

---

## 4. MCP Tools Registry Reference

Below is a complete list of tools exported by the Gmail & Google Calendar MCP Server:

| Tool Name | Type | Description | Key Inputs |
|---|---|---|---|
| `gmail_get_profile` | Gmail | Get current account details | None |
| `gmail_list_emails` | Gmail | List messages by label/unread status | `label`, `unread_only`, `max_results` |
| `gmail_search_emails` | Gmail | Find messages using Google search query | `query`, `max_results` |
| `gmail_get_email` | Gmail | Retrieve full body and parse snippet | `message_id`, `prefer_html` |
| `gmail_get_thread` | Gmail | Fetch full email conversation thread | `thread_id` |
| `gmail_send_email` | Gmail | Send a new email (with attachments) | `to`, `subject`, `body`, `attachments` |
| `gmail_reply` | Gmail | Reply directly to a thread (with attachments) | `message_id`, `body`, `attachments` |
| `gmail_forward` | Gmail | Forward an existing message (with attachments) | `message_id`, `to`, `attachments` |
| `gmail_create_draft` | Gmail | Create a new draft (with attachments) | `to`, `subject`, `body`, `attachments` |
| `gmail_draft_reply` | Gmail | Save a reply draft (with attachments) | `message_id`, `body`, `attachments` |
| `gmail_draft_forward` | Gmail | Save a forward draft (with attachments) | `message_id`, `to`, `attachments` |
| `gmail_list_drafts` | Gmail | List all saved draft messages | `max_results` |
| `gmail_send_draft` | Gmail | Send a draft immediately | `draft_id` |
| `gmail_delete_draft` | Gmail | Delete a draft permanently | `draft_id` |
| `gmail_mark_emails` | Gmail | Mark messages as read, starred, etc. | `message_ids`, `action` |
| `gmail_move_email` | Gmail | Move email to archive, trash, spam, etc. | `message_ids`, `action`, `label_id` |
| `gmail_delete_email` | Gmail | Permanently delete a message | `message_id` |
| `gmail_list_labels` | Gmail | List all system/user custom labels | None |
| `gmail_create_label` | Gmail | Create a new folder/label | `name` |
| `gmail_get_attachment` | Gmail | Fetch and decode binary attachments | `message_id`, `attachment_id` |
| `calendar_list_calendars` | Calendar | List account calendar IDs | None |
| `calendar_list_events` | Calendar | List upcoming scheduled events | `calendar_id`, `time_min`, `query` |
| `calendar_get_event` | Calendar | Fetch single event properties | `event_id`, `calendar_id` |
| `calendar_create_event` | Calendar | Schedule new event (with attachments) | `summary`, `start`, `end`, `attachments` |
| `calendar_update_event` | Calendar | Modify active event (with attachments) | `event_id`, `summary`, `attachments` |
| `calendar_cancel_event` | Calendar | Cancel / remove calendar event | `event_id`, `calendar_id` |
| `calendar_rsvp` | Calendar | Respond to invite (accept, decline, tentative) | `event_id`, `response` |
| `calendar_pending_invites`| Calendar | Find invites awaiting response | `days_ahead`, `max_results` |
| `calendar_check_availability`| Calendar | Check participant free/busy schedules | `emails`, `time_min`, `time_max` |
| `calendar_quick_add` | Calendar | Create event using natural language | `text`, `calendar_id` |

---

## 5. Development Commands

```bash
# Install dependencies
npm install

# Compile TS code
npm run build

# Run unit tests
npm test
```
