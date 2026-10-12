// Strips markup and control characters from user-supplied text before it is stored, so the
// frontend can never receive stored HTML/script payloads from event summaries or reasons.
export const sanitizeText = (value, { maxLength = 1000 } = {}) =>
  String(value ?? "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // drop the *contents* of script/style blocks, then any remaining tags
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
