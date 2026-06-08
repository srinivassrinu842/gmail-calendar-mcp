import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { calendar_v3 } from "googleapis";
import { apiError } from "../auth.js";

const calendarAttachmentSchema = z.object({
  file_url: z.string().url().describe("URL link to the file (e.g. Google Drive link or other public URL)"),
  title: z.string().describe("Title/display name of the attachment"),
  mime_type: z.string().optional().describe("MIME type of the attachment (e.g. 'application/pdf')"),
});

function parseEvent(e: calendar_v3.Schema$Event) {
  return {
    id:         e.id ?? "",
    summary:    e.summary ?? "(no title)",
    description:e.description ?? "",
    location:   e.location ?? "",
    start:      e.start?.dateTime ?? e.start?.date ?? "",
    end:        e.end?.dateTime   ?? e.end?.date   ?? "",
    allDay:     !!e.start?.date,
    status:     e.status ?? "confirmed",
    htmlLink:   e.htmlLink ?? "",
    meetLink:   e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === "video")?.uri ?? "",
    organizer:  e.organizer?.email ?? "",
    attendees: (e.attendees ?? []).map(a => ({
      email:  a.email ?? "",
      name:   a.displayName ?? "",
      status: a.responseStatus ?? "needsAction",
      self:   a.self ?? false,
    })),
    recurrence: e.recurrence ?? [],
    selfStatus: (e.attendees ?? []).find(a => a.self)?.responseStatus ?? "accepted",
    created:    e.created ?? "",
    updated:    e.updated ?? "",
    attachments: (e.attachments ?? []).map(a => ({
      fileUrl:  a.fileUrl ?? "",
      title:    a.title ?? "",
      mimeType: a.mimeType ?? "",
    })),
  };
}

export function registerCalendarTools(server: McpServer, calendar: calendar_v3.Calendar) {

  // ── 1. List calendars ─────────────────────────────────────────────────────────

  server.registerTool("calendar_list_calendars", {
    title: "List Calendars",
    description: "List all calendars in the account. Use the 'id' field in other calendar tools.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const r = await calendar.calendarList.list();
      const cals = (r.data.items ?? []).map(c => ({
        id: c.id, name: c.summary, primary: c.primary ?? false,
        accessRole: c.accessRole, timeZone: c.timeZone,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ calendars: cals }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 2. List events ────────────────────────────────────────────────────────────

  server.registerTool("calendar_list_events", {
    title: "List Calendar Events",
    description: `List upcoming calendar events.
calendar_id: use "primary" for main calendar (default)
time_min / time_max: ISO 8601 datetime e.g. "2026-05-22T00:00:00+04:00"
query: free text search on title/description`,
    inputSchema: z.object({
      calendar_id: z.string().optional().default("primary"),
      time_min:    z.string().optional().describe("Start datetime ISO 8601 (default: now)"),
      time_max:    z.string().optional().describe("End datetime ISO 8601"),
      max_results: z.number().int().min(1).max(50).optional().default(20),
      query:       z.string().optional().describe("Search text"),
    }),
  }, async (p) => {
    try {
      const r = await calendar.events.list({
        calendarId:   p.calendar_id,
        timeMin:      p.time_min ?? new Date().toISOString(),
        timeMax:      p.time_max,
        maxResults:   p.max_results,
        q:            p.query,
        singleEvents: true,
        orderBy:      "startTime",
      });
      const events = (r.data.items ?? []).map(parseEvent);
      return { content: [{ type: "text", text: JSON.stringify({ events, count: events.length }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 3. Get event ──────────────────────────────────────────────────────────────

  server.registerTool("calendar_get_event", {
    title: "Get Calendar Event",
    description: "Get full details of a single calendar event by its ID.",
    inputSchema: z.object({
      event_id:    z.string().min(1),
      calendar_id: z.string().optional().default("primary"),
    }),
  }, async (p) => {
    try {
      const r = await calendar.events.get({ calendarId: p.calendar_id, eventId: p.event_id });
      return { content: [{ type: "text", text: JSON.stringify(parseEvent(r.data), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 4. Create event / schedule meeting ────────────────────────────────────────

  server.registerTool("calendar_create_event", {
    title: "Create Event / Schedule Meeting",
    description: `Create a calendar event or schedule a meeting.
start/end: ISO 8601 with timezone e.g. "2026-05-22T10:00:00+04:00" for Dubai
For all-day events use date only: "2026-05-22"
attendees: array of email addresses — they receive invites
add_meet_link: adds a Google Meet video link
recurrence: RRULE strings e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]`,
    inputSchema: z.object({
      summary:          z.string().min(1).describe("Event title"),
      start:            z.string().min(1).describe("Start ISO 8601"),
      end:              z.string().min(1).describe("End ISO 8601"),
      description:      z.string().optional(),
      location:         z.string().optional(),
      attendees:        z.array(z.string().email()).optional().default([]),
      add_meet_link:    z.boolean().optional().default(false),
      send_invites:     z.boolean().optional().default(true),
      recurrence:       z.array(z.string()).optional().default([]),
      all_day:          z.boolean().optional().default(false),
      calendar_id:      z.string().optional().default("primary"),
      reminder_minutes: z.array(z.number().int().min(0)).optional().default([]),
      attachments:      z.array(calendarAttachmentSchema).optional().describe("Optional calendar attachments list"),
    }),
  }, async (p) => {
    try {
      const startObj = p.all_day ? { date: p.start } : { dateTime: p.start };
      const endObj   = p.all_day ? { date: p.end   } : { dateTime: p.end   };

      const body: calendar_v3.Schema$Event = {
        summary:     p.summary,
        start:       startObj,
        end:         endObj,
        description: p.description,
        location:    p.location,
        attendees:   p.attendees.map(email => ({ email })),
        recurrence:  p.recurrence.length ? p.recurrence : undefined,
        attachments: p.attachments?.map(att => ({
          fileUrl: att.file_url,
          title: att.title,
          mimeType: att.mime_type
        })),
        ...(p.add_meet_link ? {
          conferenceData: {
            createRequest: {
              requestId: `mcp-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        } : {}),
        ...(p.reminder_minutes.length ? {
          reminders: {
            useDefault: false,
            overrides: p.reminder_minutes.map(m => ({ method: "email" as const, minutes: m })),
          },
        } : {}),
      };

      const r = await calendar.events.insert({
        calendarId:           p.calendar_id,
        requestBody:          body,
        conferenceDataVersion: p.add_meet_link ? 1 : 0,
        sendUpdates:          p.send_invites ? "all" : "none",
        supportsAttachments:  true,
      });

      return { content: [{ type: "text", text: JSON.stringify(parseEvent(r.data), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 5. Update event ───────────────────────────────────────────────────────────

  server.registerTool("calendar_update_event", {
    title: "Update Calendar Event",
    description: "Update an existing event. Only fields you provide are changed.",
    inputSchema: z.object({
      event_id:     z.string().min(1),
      calendar_id:  z.string().optional().default("primary"),
      summary:      z.string().optional(),
      start:        z.string().optional().describe("New start ISO 8601"),
      end:          z.string().optional().describe("New end ISO 8601"),
      description:  z.string().optional(),
      location:     z.string().optional(),
      attendees:    z.array(z.string().email()).optional(),
      send_updates: z.boolean().optional().default(true),
      attachments:  z.array(calendarAttachmentSchema).optional().describe("Optional calendar attachments list"),
    }),
  }, async (p) => {
    try {
      const patch: calendar_v3.Schema$Event = {};
      if (p.summary)     patch.summary     = p.summary;
      if (p.description !== undefined) patch.description = p.description;
      if (p.location    !== undefined) patch.location    = p.location;
      if (p.start)       patch.start       = { dateTime: p.start };
      if (p.end)         patch.end         = { dateTime: p.end };
      if (p.attendees)   patch.attendees   = p.attendees.map(email => ({ email }));
      if (p.attachments) patch.attachments = p.attachments.map(att => ({
        fileUrl: att.file_url,
        title: att.title,
        mimeType: att.mime_type
      }));
      const r = await calendar.events.patch({
        calendarId:  p.calendar_id,
        eventId:     p.event_id,
        requestBody: patch,
        sendUpdates: p.send_updates ? "all" : "none",
        supportsAttachments: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(parseEvent(r.data), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 6. Cancel / delete event ──────────────────────────────────────────────────

  server.registerTool("calendar_cancel_event", {
    title: "Cancel Event",
    description: "Cancel (delete) a calendar event. If you are the organiser, all attendees are notified.",
    inputSchema: z.object({
      event_id:     z.string().min(1),
      calendar_id:  z.string().optional().default("primary"),
      send_updates: z.boolean().optional().default(true),
    }),
  }, async (p) => {
    try {
      await calendar.events.delete({
        calendarId:  p.calendar_id,
        eventId:     p.event_id,
        sendUpdates: p.send_updates ? "all" : "none",
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, cancelledEventId: p.event_id }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 7. RSVP — accept / decline / tentative ────────────────────────────────────

  server.registerTool("calendar_rsvp", {
    title: "RSVP to Meeting Invite",
    description: `Accept, decline, or mark tentative for a calendar event invite.
response: "accepted" | "declined" | "tentative"`,
    inputSchema: z.object({
      event_id:     z.string().min(1),
      response:     z.enum(["accepted","declined","tentative"]),
      calendar_id:  z.string().optional().default("primary"),
      send_updates: z.boolean().optional().default(true),
    }),
  }, async (p) => {
    try {
      const existing = await calendar.events.get({ calendarId: p.calendar_id, eventId: p.event_id });
      const attendees = (existing.data.attendees ?? []).map(a =>
        a.self ? { ...a, responseStatus: p.response } : a
      );
      const r = await calendar.events.patch({
        calendarId:  p.calendar_id,
        eventId:     p.event_id,
        requestBody: { attendees },
        sendUpdates: p.send_updates ? "all" : "none",
      });
      return { content: [{ type: "text", text: JSON.stringify({
        success: true, response: p.response, event: parseEvent(r.data),
      }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 8. List pending invites ───────────────────────────────────────────────────

  server.registerTool("calendar_pending_invites", {
    title: "List Pending Meeting Invites",
    description: "List calendar events where you haven't responded yet (needsAction). Use calendar_rsvp to respond.",
    inputSchema: z.object({
      calendar_id: z.string().optional().default("primary"),
      days_ahead:  z.number().int().min(1).max(365).optional().default(30),
      max_results: z.number().int().min(1).max(50).optional().default(20),
    }),
  }, async (p) => {
    try {
      const now    = new Date();
      const future = new Date(now.getTime() + p.days_ahead * 86400000);
      const r = await calendar.events.list({
        calendarId:   p.calendar_id,
        timeMin:      now.toISOString(),
        timeMax:      future.toISOString(),
        maxResults:   p.max_results * 4,
        singleEvents: true,
        orderBy:      "startTime",
      });
      const pending = (r.data.items ?? [])
        .map(parseEvent)
        .filter(e => e.selfStatus === "needsAction")
        .slice(0, p.max_results);
      return { content: [{ type: "text", text: JSON.stringify({ pending, count: pending.length }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 9. Check free/busy ────────────────────────────────────────────────────────

  server.registerTool("calendar_check_availability", {
    title: "Check Availability (Free/Busy)",
    description: `Check when people are free or busy to find a meeting slot.
emails: include yourself and any attendees
time_min/time_max: ISO 8601 e.g. "2026-05-22T08:00:00+04:00"`,
    inputSchema: z.object({
      emails:   z.array(z.string().email()).min(1),
      time_min: z.string().describe("Start of window ISO 8601"),
      time_max: z.string().describe("End of window ISO 8601"),
      timezone: z.string().optional().default("Asia/Dubai"),
    }),
  }, async (p) => {
    try {
      const r = await calendar.freebusy.query({
        requestBody: {
          timeMin:  p.time_min,
          timeMax:  p.time_max,
          timeZone: p.timezone,
          items:    p.emails.map(id => ({ id })),
        },
      });
      const busy: Record<string, { start: string; end: string }[]> = {};
      for (const email of p.emails) {
        busy[email] = (r.data.calendars?.[email]?.busy ?? []).map(b => ({
          start: b.start ?? "", end: b.end ?? "",
        }));
      }
      return { content: [{ type: "text", text: JSON.stringify({ busy, timeMin: p.time_min, timeMax: p.time_max }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });

  // ── 10. Quick add (natural language) ─────────────────────────────────────────

  server.registerTool("calendar_quick_add", {
    title: "Quick Add Event",
    description: `Create an event from natural language text. Google parses the time/title automatically.
Examples: "Team standup every Monday at 9am", "Lunch with Alice tomorrow at 1pm Dubai"`,
    inputSchema: z.object({
      text:        z.string().min(1),
      calendar_id: z.string().optional().default("primary"),
      send_invites: z.boolean().optional().default(true),
    }),
  }, async (p) => {
    try {
      const r = await calendar.events.quickAdd({
        calendarId:  p.calendar_id,
        text:        p.text,
        sendUpdates: p.send_invites ? "all" : "none",
      });
      return { content: [{ type: "text", text: JSON.stringify(parseEvent(r.data), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: apiError(e) }], isError: true }; }
  });
}
