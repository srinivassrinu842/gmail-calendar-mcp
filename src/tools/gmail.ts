import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gmail_v1 } from "googleapis";
import fs from "fs";
import path from "path";
import {
  toBase64, parseMsg, buildMime, quoteReply, buildForward,
  reSubject, fwdSubject,
} from "../gmail-helpers.js";
import { apiError } from "../auth.js";

const attachmentSchema = z.object({
  filename: z.string().describe("Filename for the attachment"),
  mime_type: z.string().optional().describe("MIME type (e.g. 'image/png'). Optional if file_path is provided."),
  data: z.string().optional().describe("Base64-encoded file data. Required if file_path is not provided."),
  file_path: z.string().optional().describe("Local file path to read from. Required if data is not provided."),
});

interface InputAttachment {
  filename: string;
  mime_type?: string;
  data?: string;
  file_path?: string;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".json": "application/json",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] || "application/octet-stream";
}

async function resolveAttachments(attachments?: InputAttachment[]) {
  if (!attachments || attachments.length === 0) return undefined;

  const resolved = [];
  for (const att of attachments) {
    let base64Data = att.data;
    let mimeType = att.mime_type;

    if (att.file_path) {
      const resolvedPath = path.resolve(att.file_path);
      const fileBuffer = await fs.promises.readFile(resolvedPath);
      base64Data = fileBuffer.toString("base64");
      if (!mimeType) {
        mimeType = getMimeType(resolvedPath);
      }
    }

    if (!base64Data) {
      throw new Error(`Attachment "${att.filename}" must have either 'data' or 'file_path'.`);
    }

    resolved.push({
      filename: att.filename,
      mimeType: mimeType || "application/octet-stream",
      data: base64Data,
    });
  }
  return resolved;
}

export function registerGmailTools(server: McpServer, gmail: gmail_v1.Gmail) {

  // ── 1. Get profile ────────────────────────────────────────────────────────────

  server.registerTool("gmail_get_profile", {
    title: "Get Gmail Profile",
    description: "Get the authenticated Gmail account info (email address, total messages, threads).",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const r = await gmail.users.getProfile({ userId: "me" });
      return { content: [{ type: "text", text: JSON.stringify({
        email:         r.data.emailAddress,
        totalMessages: r.data.messagesTotal,
        totalThreads:  r.data.threadsTotal,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 2. List emails ────────────────────────────────────────────────────────────

  server.registerTool("gmail_list_emails", {
    title: "List Emails",
    description: `List emails from a label/folder.
label: INBOX | SENT | DRAFTS | STARRED | SPAM | TRASH | UNREAD (default: INBOX)
unread_only: only show unread messages
max_results: 1-50 (default 20)`,
    inputSchema: z.object({
      label:       z.string().optional().default("INBOX"),
      unread_only: z.boolean().optional().default(false),
      max_results: z.number().int().min(1).max(50).optional().default(20),
      page_token:  z.string().optional(),
    }),
  }, async (p) => {
    try {
      const labelIds = [p.label!.toUpperCase()];
      if (p.unread_only) labelIds.push("UNREAD");
      const list = await gmail.users.messages.list({
        userId: "me", maxResults: p.max_results, labelIds,
        pageToken: p.page_token,
      });
      const msgs = await Promise.all((list.data.messages ?? []).map(async m => {
        const r = await gmail.users.messages.get({
          userId: "me", id: m.id!,
          format: "metadata",
          metadataHeaders: ["From","To","Subject","Date"],
        });
        return parseMsg(r.data, false);
      }));
      return { content: [{ type: "text", text: JSON.stringify({
        emails: msgs.map(m => ({
          id: m.id, threadId: m.threadId, from: m.from, to: m.to,
          subject: m.subject, date: m.date, snippet: m.snippet,
          isUnread: m.isUnread, isStarred: m.isStarred,
        })),
        nextPageToken: list.data.nextPageToken ?? null,
        total: list.data.resultSizeEstimate,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 3. Search emails ──────────────────────────────────────────────────────────

  server.registerTool("gmail_search_emails", {
    title: "Search Emails",
    description: `Search Gmail using Gmail query syntax.
Examples:
  from:boss@company.com is:unread
  subject:invoice has:attachment newer_than:7d
  to:me after:2026/01/01
  "exact phrase" label:important`,
    inputSchema: z.object({
      query:       z.string().min(1).describe("Gmail search query"),
      max_results: z.number().int().min(1).max(50).optional().default(20),
      page_token:  z.string().optional(),
    }),
  }, async (p) => {
    try {
      const list = await gmail.users.messages.list({
        userId: "me", q: p.query, maxResults: p.max_results,
        pageToken: p.page_token,
      });
      const msgs = await Promise.all((list.data.messages ?? []).map(async m => {
        const r = await gmail.users.messages.get({
          userId: "me", id: m.id!,
          format: "metadata",
          metadataHeaders: ["From","To","Subject","Date"],
        });
        return parseMsg(r.data, false);
      }));
      return { content: [{ type: "text", text: JSON.stringify({
        query: p.query,
        emails: msgs.map(m => ({
          id: m.id, threadId: m.threadId, from: m.from, to: m.to,
          subject: m.subject, date: m.date, snippet: m.snippet,
          isUnread: m.isUnread, isStarred: m.isStarred,
          attachments: m.attachments.length,
        })),
        nextPageToken: list.data.nextPageToken ?? null,
        total: list.data.resultSizeEstimate,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 4. Get email (full body) ──────────────────────────────────────────────────

  server.registerTool("gmail_get_email", {
    title: "Get Email",
    description: "Get the full content of an email by its message ID (from list/search results).",
    inputSchema: z.object({
      message_id:  z.string().min(1).describe("Gmail message ID"),
      prefer_html: z.boolean().optional().default(false),
    }),
  }, async (p) => {
    try {
      const r = await gmail.users.messages.get({ userId: "me", id: p.message_id, format: "full" });
      const m = parseMsg(r.data, true);
      return { content: [{ type: "text", text: JSON.stringify(m, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 5. Get thread (full conversation) ─────────────────────────────────────────

  server.registerTool("gmail_get_thread", {
    title: "Get Email Thread",
    description: "Get all messages in a conversation/thread by thread ID.",
    inputSchema: z.object({
      thread_id: z.string().min(1).describe("Gmail thread ID"),
    }),
  }, async (p) => {
    try {
      const r = await gmail.users.threads.get({ userId: "me", id: p.thread_id, format: "full" });
      const messages = (r.data.messages ?? []).map(m => parseMsg(m, true));
      const participants = [...new Set(messages.flatMap(m => [m.from, m.to, m.cc].filter(Boolean)))];
      return { content: [{ type: "text", text: JSON.stringify({
        threadId: p.thread_id,
        subject: messages[0]?.subject ?? "",
        messageCount: messages.length,
        participants,
        messages: messages.map(m => ({
          id: m.id, from: m.from, to: m.to, date: m.date,
          subject: m.subject, body: m.body, snippet: m.snippet,
          isUnread: m.isUnread, attachments: m.attachments,
        })),
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 6. Send new email ─────────────────────────────────────────────────────────

  server.registerTool("gmail_send_email", {
    title: "Send New Email",
    description: "Send a new email. For replying to an existing email use gmail_reply instead.",
    inputSchema: z.object({
      to:      z.string().min(1).describe("Recipient(s), comma-separated"),
      subject: z.string().min(1),
      body:    z.string().min(1).describe("Email body (plain text or HTML)"),
      cc:      z.string().optional(),
      bcc:     z.string().optional(),
      is_html: z.boolean().optional().default(false),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const raw = buildMime({ to: p.to, subject: p.subject, body: p.body, cc: p.cc, bcc: p.bcc, isHtml: p.is_html, attachments: resolvedAtts });
      const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: toBase64(raw) } });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, messageId: r.data.id, threadId: r.data.threadId,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 7. Reply to email (same thread) ──────────────────────────────────────────

  server.registerTool("gmail_reply", {
    title: "Reply to Email",
    description: `Reply to an existing email, keeping it in the same thread.
Automatically fetches the original to set In-Reply-To, References, subject (Re:), and To address.
The original message is quoted at the bottom by default.`,
    inputSchema: z.object({
      message_id:    z.string().min(1).describe("Message ID to reply to"),
      body:          z.string().min(1).describe("Your reply text"),
      cc:            z.string().optional(),
      bcc:           z.string().optional(),
      is_html:       z.boolean().optional().default(false),
      quote_original: z.boolean().optional().default(true).describe("Quote the original message"),
      reply_to_all:  z.boolean().optional().default(false).describe("Reply to all original recipients"),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const origR = await gmail.users.messages.get({ userId: "me", id: p.message_id, format: "full" });
      const orig  = parseMsg(origR.data, true);

      let to = orig.from;
      let cc = p.cc;

      if (p.reply_to_all) {
        // Get own email to exclude self
        const profile = await gmail.users.getProfile({ userId: "me" });
        const me = (profile.data.emailAddress ?? "").toLowerCase();

        // To = original sender + original To recipients (excluding self)
        const allTo = [orig.from, ...orig.to.split(",").map(s => s.trim())]
          .filter(a => a && !a.toLowerCase().includes(me));
        to = allTo.join(", ");

        // CC = original CC (excluding self) + extra cc
        const allCc = [...orig.cc.split(",").map(s => s.trim()), ...(p.cc?.split(",").map(s => s.trim()) ?? [])]
          .filter(a => a && !a.toLowerCase().includes(me) && !allTo.some(t => t.toLowerCase().includes(a.toLowerCase())));
        cc = allCc.join(", ") || undefined;
      }

      const subject = reSubject(orig.subject);
      const body    = p.quote_original ? quoteReply(orig, p.body) : p.body;

      const raw = buildMime({
        to, subject, body, cc, bcc: p.bcc, isHtml: p.is_html,
        inReplyTo:  orig.rfcMessageId,
        references: orig.references,
        attachments: resolvedAtts,
      });

      const r = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: toBase64(raw), threadId: orig.threadId },
      });

      return { content: [{ type: "text", text: JSON.stringify({
        success: true, messageId: r.data.id, threadId: r.data.threadId,
        to, subject, repliedTo: p.message_id,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 8. Forward email ──────────────────────────────────────────────────────────

  server.registerTool("gmail_forward", {
    title: "Forward Email",
    description: "Forward an existing email to new recipients. Builds the standard forwarded message block automatically.",
    inputSchema: z.object({
      message_id: z.string().min(1).describe("Message ID to forward"),
      to:         z.string().min(1).describe("Forward-to recipient(s)"),
      intro:      z.string().optional().default("").describe("Intro text before the forwarded content"),
      cc:         z.string().optional(),
      bcc:        z.string().optional(),
      is_html:    z.boolean().optional().default(false),
      subject:    z.string().optional().describe("Override subject (default: Fwd: <original>)"),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const origR = await gmail.users.messages.get({ userId: "me", id: p.message_id, format: "full" });
      const orig  = parseMsg(origR.data, true);
      const subject = p.subject ?? fwdSubject(orig.subject);
      const body    = buildForward(orig, p.intro);
      const raw = buildMime({ to: p.to, subject, body, cc: p.cc, bcc: p.bcc, isHtml: p.is_html, attachments: resolvedAtts });
      const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: toBase64(raw) } });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, messageId: r.data.id, threadId: r.data.threadId,
        to: p.to, subject, forwardedMessage: p.message_id,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 9. Create draft ───────────────────────────────────────────────────────────

  server.registerTool("gmail_create_draft", {
    title: "Create Draft",
    description: "Save a new email as a draft without sending.",
    inputSchema: z.object({
      to:      z.string().min(1),
      subject: z.string().min(1),
      body:    z.string().min(1),
      cc:      z.string().optional(),
      bcc:     z.string().optional(),
      is_html: z.boolean().optional().default(false),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const raw = buildMime({ to: p.to, subject: p.subject, body: p.body, cc: p.cc, bcc: p.bcc, isHtml: p.is_html, attachments: resolvedAtts });
      const r = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: toBase64(raw) } } });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, draftId: r.data.id, messageId: r.data.message?.id, threadId: r.data.message?.threadId,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 10. Draft reply ───────────────────────────────────────────────────────────

  server.registerTool("gmail_draft_reply", {
    title: "Draft a Reply",
    description: "Save a reply as a draft (same thread). Fetches original for correct threading headers.",
    inputSchema: z.object({
      message_id:     z.string().min(1).describe("Message ID to reply to"),
      body:           z.string().min(1),
      cc:             z.string().optional(),
      bcc:            z.string().optional(),
      is_html:        z.boolean().optional().default(false),
      quote_original: z.boolean().optional().default(true),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const origR = await gmail.users.messages.get({ userId: "me", id: p.message_id, format: "full" });
      const orig  = parseMsg(origR.data, true);
      const subject = reSubject(orig.subject);
      const body    = p.quote_original ? quoteReply(orig, p.body) : p.body;
      const raw = buildMime({
        to: orig.from, subject, body, cc: p.cc, bcc: p.bcc, isHtml: p.is_html,
        inReplyTo: orig.rfcMessageId, references: orig.references,
        attachments: resolvedAtts,
      });
      const r = await gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: toBase64(raw), threadId: orig.threadId } },
      });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, draftId: r.data.id, to: orig.from, subject,
        messageId: r.data.message?.id, threadId: r.data.message?.threadId,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 11. Draft forward ─────────────────────────────────────────────────────────

  server.registerTool("gmail_draft_forward", {
    title: "Draft a Forward",
    description: "Save a forwarded email as a draft without sending.",
    inputSchema: z.object({
      message_id: z.string().min(1),
      to:         z.string().min(1),
      intro:      z.string().optional().default(""),
      cc:         z.string().optional(),
      bcc:        z.string().optional(),
      is_html:    z.boolean().optional().default(false),
      subject:    z.string().optional(),
      attachments: z.array(attachmentSchema).optional().describe("Optional attachments list"),
    }),
  }, async (p) => {
    try {
      const resolvedAtts = await resolveAttachments(p.attachments);
      const origR = await gmail.users.messages.get({ userId: "me", id: p.message_id, format: "full" });
      const orig  = parseMsg(origR.data, true);
      const subject = p.subject ?? fwdSubject(orig.subject);
      const body    = buildForward(orig, p.intro);
      const raw = buildMime({ to: p.to, subject, body, cc: p.cc, bcc: p.bcc, isHtml: p.is_html, attachments: resolvedAtts });
      const r = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: toBase64(raw) } } });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, draftId: r.data.id, to: p.to, subject,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 12. List drafts ───────────────────────────────────────────────────────────

  server.registerTool("gmail_list_drafts", {
    title: "List Drafts",
    description: "List all saved draft emails.",
    inputSchema: z.object({
      max_results: z.number().int().min(1).max(50).optional().default(20),
    }),
  }, async (p) => {
    try {
      const list = await gmail.users.drafts.list({ userId: "me", maxResults: p.max_results });
      const drafts = await Promise.all((list.data.drafts ?? []).map(async d => {
        try {
          const det = await gmail.users.drafts.get({ userId: "me", id: d.id! });
          const m   = det.data.message ? parseMsg(det.data.message, false) : null;
          return { draftId: d.id, to: m?.to ?? "", subject: m?.subject ?? "", snippet: det.data.message?.snippet ?? "", date: m?.date ?? "" };
        } catch { return { draftId: d.id, to: "", subject: "", snippet: "", date: "" }; }
      }));
      return { content: [{ type: "text", text: JSON.stringify({ drafts }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 13. Send draft ────────────────────────────────────────────────────────────

  server.registerTool("gmail_send_draft", {
    title: "Send Draft",
    description: "Send an existing draft immediately by its draft ID.",
    inputSchema: z.object({
      draft_id: z.string().min(1),
    }),
  }, async (p) => {
    try {
      const r = await gmail.users.drafts.send({ userId: "me", requestBody: { id: p.draft_id } });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, messageId: r.data.id, threadId: r.data.threadId }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 14. Delete draft ──────────────────────────────────────────────────────────

  server.registerTool("gmail_delete_draft", {
    title: "Delete Draft",
    description: "Permanently delete a draft by its draft ID.",
    inputSchema: z.object({ draft_id: z.string().min(1) }),
  }, async (p) => {
    try {
      await gmail.users.drafts.delete({ userId: "me", id: p.draft_id });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, deletedDraftId: p.draft_id }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 15. Mark emails ───────────────────────────────────────────────────────────

  server.registerTool("gmail_mark_emails", {
    title: "Mark Emails",
    description: `Mark one or more emails. action: "read" | "unread" | "starred" | "unstarred" | "important" | "not_important"`,
    inputSchema: z.object({
      message_ids: z.array(z.string()).min(1).max(100),
      action:      z.enum(["read","unread","starred","unstarred","important","not_important"]),
    }),
  }, async (p) => {
    try {
      const add: string[] = [], remove: string[] = [];
      if (p.action === "read")          remove.push("UNREAD");
      if (p.action === "unread")        add.push("UNREAD");
      if (p.action === "starred")       add.push("STARRED");
      if (p.action === "unstarred")     remove.push("STARRED");
      if (p.action === "important")     add.push("IMPORTANT");
      if (p.action === "not_important") remove.push("IMPORTANT");
      await gmail.users.messages.batchModify({
        userId: "me",
        requestBody: { ids: p.message_ids, addLabelIds: add, removeLabelIds: remove },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: p.message_ids.length }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 16. Move / archive / trash ────────────────────────────────────────────────

  server.registerTool("gmail_move_email", {
    title: "Move Email",
    description: `Move email(s). action: "archive" | "unarchive" | "trash" | "untrash" | "spam" | "not_spam"
For custom labels use action "add_label" or "remove_label" with label_id.`,
    inputSchema: z.object({
      message_ids: z.array(z.string()).min(1).max(100),
      action:      z.enum(["archive","unarchive","trash","untrash","spam","not_spam","add_label","remove_label"]),
      label_id:    z.string().optional().describe("Required for add_label / remove_label"),
    }),
  }, async (p) => {
    try {
      const add: string[] = [], remove: string[] = [];
      if (p.action === "archive")       remove.push("INBOX");
      if (p.action === "unarchive")     add.push("INBOX");
      if (p.action === "trash")       { add.push("TRASH"); remove.push("INBOX"); }
      if (p.action === "untrash")     { remove.push("TRASH"); add.push("INBOX"); }
      if (p.action === "spam")        { add.push("SPAM"); remove.push("INBOX"); }
      if (p.action === "not_spam")    { remove.push("SPAM"); add.push("INBOX"); }
      if (p.action === "add_label")   { if (!p.label_id) throw new Error("label_id required"); add.push(p.label_id); }
      if (p.action === "remove_label"){ if (!p.label_id) throw new Error("label_id required"); remove.push(p.label_id); }
      await gmail.users.messages.batchModify({
        userId: "me",
        requestBody: { ids: p.message_ids, addLabelIds: add, removeLabelIds: remove },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: p.message_ids.length }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 17. Delete email permanently ──────────────────────────────────────────────

  server.registerTool("gmail_delete_email", {
    title: "Delete Email Permanently",
    description: "Permanently delete a single email. IRREVERSIBLE. Use gmail_move_email with action 'trash' first.",
    inputSchema: z.object({ message_id: z.string().min(1) }),
  }, async (p) => {
    try {
      await gmail.users.messages.delete({ userId: "me", id: p.message_id });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, deleted: p.message_id }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 18. List labels ───────────────────────────────────────────────────────────

  server.registerTool("gmail_list_labels", {
    title: "List Labels",
    description: "List all Gmail labels (system labels like INBOX, SENT + custom labels). Use label IDs in other tools.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const r = await gmail.users.labels.list({ userId: "me" });
      const labels = (r.data.labels ?? []).map(l => ({
        id: l.id, name: l.name, type: l.type,
        unread: l.messagesUnread, total: l.messagesTotal,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ labels }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 19. Create label ──────────────────────────────────────────────────────────

  server.registerTool("gmail_create_label", {
    title: "Create Label",
    description: "Create a new custom Gmail label. Supports nested labels e.g. 'Projects/NESA'.",
    inputSchema: z.object({
      name: z.string().min(1).max(225),
    }),
  }, async (p) => {
    try {
      const r = await gmail.users.labels.create({
        userId: "me",
        requestBody: { name: p.name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      return { content: [{ type: "text", text: JSON.stringify({ id: r.data.id, name: r.data.name }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 20. Get attachment ────────────────────────────────────────────────────────

  server.registerTool("gmail_get_attachment", {
    title: "Get Attachment",
    description: "Download a message attachment as base64 data. Get attachmentId from gmail_get_email.",
    inputSchema: z.object({
      message_id:    z.string().min(1),
      attachment_id: z.string().min(1),
    }),
  }, async (p) => {
    try {
      const r = await gmail.users.messages.attachments.get({
        userId: "me", messageId: p.message_id, id: p.attachment_id,
      });
      return { content: [{ type: "text", text: JSON.stringify({
        attachmentId: p.attachment_id,
        size: r.data.size,
        data: r.data.data,
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });
}
