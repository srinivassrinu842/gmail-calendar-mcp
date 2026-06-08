import { gmail_v1 } from "googleapis";

// ── Base64url ──────────────────────────────────────────────────────────────────

export const toBase64 = (s: string) => Buffer.from(s).toString("base64url");
export const fromBase64 = (s: string) => Buffer.from(s, "base64url").toString("utf-8");

// ── Header helpers ─────────────────────────────────────────────────────────────

export function hdr(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// ── Body extraction ────────────────────────────────────────────────────────────

export function extractBody(
  part: gmail_v1.Schema$MessagePart | undefined,
  html = false
): string {
  if (!part) return "";
  if (part.body?.data) return fromBase64(part.body.data);
  if (!part.parts) return "";
  const want = html ? "text/html" : "text/plain";
  const fallback = html ? "text/plain" : "text/html";
  const found = part.parts.find(p => p.mimeType === want)
             ?? part.parts.find(p => p.mimeType === fallback);
  if (found?.body?.data) return fromBase64(found.body.data);
  for (const p of part.parts) {
    const b = extractBody(p, html);
    if (b) return b;
  }
  return "";
}

// ── Attachment listing ─────────────────────────────────────────────────────────

export function listAttachments(part?: gmail_v1.Schema$MessagePart) {
  const result: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
  function walk(p: gmail_v1.Schema$MessagePart) {
    if (p.filename && p.body?.attachmentId) {
      result.push({
        filename:     p.filename,
        mimeType:     p.mimeType ?? "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size:         p.body.size ?? 0,
      });
    }
    p.parts?.forEach(walk);
  }
  if (part) walk(part);
  return result;
}

// ── ParsedMessage ──────────────────────────────────────────────────────────────

export interface Msg {
  id:           string;
  threadId:     string;
  rfcMessageId: string;   // raw Message-ID header, e.g. <abc@mail.gmail.com>
  references:   string;   // full references chain for replies
  from:         string;
  to:           string;
  cc:           string;
  subject:      string;
  date:         string;
  snippet:      string;
  body:         string;
  labelIds:     string[];
  isUnread:     boolean;
  isStarred:    boolean;
  attachments:  { filename: string; mimeType: string; attachmentId: string; size: number }[];
}

export function parseMsg(raw: gmail_v1.Schema$Message, withBody = true): Msg {
  const hdrs = raw.payload?.headers ?? [];
  const msgId = hdr(hdrs, "Message-ID");
  const existingRefs = hdr(hdrs, "References");
  // references for a reply = existing chain + this message's ID
  const references = [existingRefs, msgId].filter(Boolean).join(" ").trim();

  return {
    id:           raw.id ?? "",
    threadId:     raw.threadId ?? "",
    rfcMessageId: msgId,
    references,
    from:         hdr(hdrs, "From"),
    to:           hdr(hdrs, "To"),
    cc:           hdr(hdrs, "Cc"),
    subject:      hdr(hdrs, "Subject"),
    date:         hdr(hdrs, "Date"),
    snippet:      raw.snippet ?? "",
    body:         withBody ? extractBody(raw.payload) : "",
    labelIds:     raw.labelIds ?? [],
    isUnread:     (raw.labelIds ?? []).includes("UNREAD"),
    isStarred:    (raw.labelIds ?? []).includes("STARRED"),
    attachments:  listAttachments(raw.payload),
  };
}

// ── MIME message builder ───────────────────────────────────────────────────────

interface MimeOpts {
  to:          string;
  subject:     string;
  body:        string;
  cc?:         string;
  bcc?:        string;
  isHtml?:     boolean;
  inReplyTo?:  string;
  references?: string;
  attachments?: { filename: string; mimeType: string; data: string }[];
}

export function buildMime(o: MimeOpts): string {
  const boundary = `__boundary_${Date.now()}_${Math.random().toString(36).substring(2)}__`;

  const headers = [
    `To: ${o.to}`,
    ...(o.cc         ? [`Cc: ${o.cc}`]                   : []),
    ...(o.bcc        ? [`Bcc: ${o.bcc}`]                 : []),
    `Subject: ${o.subject}`,
    "MIME-Version: 1.0",
    ...(o.inReplyTo  ? [`In-Reply-To: ${o.inReplyTo}`]   : []),
    ...(o.references ? [`References: ${o.references}`]   : o.inReplyTo ? [`References: ${o.inReplyTo}`] : []),
  ];

  if (o.attachments && o.attachments.length > 0) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const mimeParts: string[] = [];

    // Add the body part
    mimeParts.push(
      `--${boundary}`,
      `Content-Type: ${o.isHtml ? "text/html" : "text/plain"}; charset=UTF-8`,
      "Content-Transfer-Encoding: 7bit",
      "",
      o.body
    );

    // Add attachment parts
    for (const att of o.attachments) {
      mimeParts.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        att.data.includes(";base64,") ? att.data.split(";base64,")[1] : att.data
      );
    }

    mimeParts.push(`--${boundary}--`);

    return [...headers, "", mimeParts.join("\r\n")].join("\r\n");
  } else {
    headers.push(`Content-Type: ${o.isHtml ? "text/html" : "text/plain"}; charset=UTF-8`);
    return [...headers, "", o.body].join("\r\n");
  }
}

// ── Subject prefixing ──────────────────────────────────────────────────────────

export const reSubject  = (s: string) => /^re:/i.test(s)  ? s : `Re: ${s}`;
export const fwdSubject = (s: string) => /^fwd:/i.test(s) ? s : `Fwd: ${s}`;

// ── Quoted reply block ─────────────────────────────────────────────────────────

export function quoteReply(orig: Msg, myText: string): string {
  const header = `On ${orig.date}, ${orig.from} wrote:`;
  const quoted  = orig.body.split("\n").map(l => `> ${l}`).join("\n");
  return `${myText}\n\n${header}\n${quoted}`;
}

// ── Forward block ─────────────────────────────────────────────────────────────

export function buildForward(orig: Msg, intro: string): string {
  const sep = [
    "---------- Forwarded message ---------",
    `From: ${orig.from}`,
    `Date: ${orig.date}`,
    `Subject: ${orig.subject}`,
    `To: ${orig.to}`,
    ...(orig.cc ? [`Cc: ${orig.cc}`] : []),
    "",
    orig.body,
  ].join("\n");
  return intro ? `${intro}\n\n${sep}` : sep;
}
