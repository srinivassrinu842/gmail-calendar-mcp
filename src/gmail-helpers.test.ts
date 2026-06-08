import test from "node:test";
import assert from "node:assert";
import { buildMime } from "./gmail-helpers.js";

test("buildMime generates normal MIME message correctly without attachments", () => {
  const mime = buildMime({
    to: "srinivassrinu842@gmail.com",
    subject: "Hello World",
    body: "This is a simple plain text body.",
    isHtml: false
  });

  assert.match(mime, /To: srinivassrinu842@gmail.com/);
  assert.match(mime, /Subject: Hello World/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /This is a simple plain text body\./);
  assert.ok(!mime.includes("multipart/mixed"));
});

test("buildMime generates multipart MIME message with attachments", () => {
  const mime = buildMime({
    to: "srinivassrinu842@gmail.com",
    subject: "With Attachment",
    body: "Please see attachment.",
    isHtml: true,
    attachments: [
      {
        filename: "hello.txt",
        mimeType: "text/plain",
        data: "SGVsbG8gV29ybGQ=" // "Hello World" in base64
      }
    ]
  });

  assert.match(mime, /To: srinivassrinu842@gmail.com/);
  assert.match(mime, /Subject: With Attachment/);
  assert.match(mime, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(mime, /Please see attachment\./);
  assert.match(mime, /Content-Disposition: attachment; filename="hello.txt"/);
  assert.match(mime, /SGVsbG8gV29ybGQ=/);
});
