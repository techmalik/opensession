// The HTML shell every outgoing email is wrapped in.
//
// Email clients are not browsers. Gmail strips <style> blocks in some contexts,
// Outlook renders through Word, and no client can be trusted with flexbox or CSS
// custom properties. So: table layout, inline styles only, 600px wide, web-safe
// font stack with Inter first for the clients that have it, and a button built from
// a table cell rather than a styled <a>.
//
// Templates stay short HTML fragments that an organizer can edit in Communications.
// This wraps them at delivery time, so editing a template never means editing
// layout markup.

const ACCENT = "#0b7b57";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const CANVAS = "#f8fafc";
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** A button that survives Outlook: padding on the cell, not the anchor. */
export function emailButton(url: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">` +
    `<tr><td align="center" bgcolor="${ACCENT}" style="border-radius:6px;">` +
    `<a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;` +
    `font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>` +
    `</td></tr></table>`
  );
}

export interface LayoutInput {
  eventName: string;
  bodyHtml: string;
  /** Sits under the subject in the inbox list. Kept out of the visible body. */
  preheader?: string;
  footerNote?: string;
}

/** Wraps a template fragment in the full document. */
export function renderEmailLayout(input: LayoutInput): string {
  const { eventName, bodyHtml, preheader, footerNote } = input;

  // The fragment's own paragraphs need typography: templates are written as plain
  // <p> tags, and clients apply their own margins otherwise.
  const styledBody = bodyHtml
    .replace(/<p>/g, `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${TEXT};">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;font-family:${FONT};font-size:16px;line-height:1.6;color:${TEXT};">`)
    .replace(/<li>/g, `<li style="margin:0 0 6px;">`)
    // Only anchors that carry no style of their own. A duplicate style attribute is
    // not merged by parsers, the first one wins, and that silently strips the
    // button's own white-on-accent styling down to invisible text.
    .replace(/<a (?![^>]*style=)/g, `<a style="color:${ACCENT};text-decoration:underline;" `);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(eventName)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeAttr(preheader)}</div>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${CANVAS};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid ${BORDER};border-radius:8px;">
        <tr>
          <td style="padding:24px 32px 0;">
            <p style="margin:0;font-family:${FONT};font-size:13px;font-weight:600;letter-spacing:0.02em;color:${MUTED};text-transform:uppercase;">${escapeAttr(eventName)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 8px;">
            ${styledBody}
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 28px;">
            <hr style="border:none;border-top:1px solid ${BORDER};margin:8px 0 16px;">
            <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">
              ${footerNote ? `${escapeAttr(footerNote)}<br>` : ""}Sent by ${escapeAttr(eventName)} through OpenSession.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain-text alternative. Every message carrying both parts scores better with
 *  spam filters, and some clients still prefer text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
