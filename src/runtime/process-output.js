"use strict";

/**
 * Child stdout/stderr is a Buffer. Node defaults to UTF-8, but on Windows
 * DSH/pnpm often write CP936 (GBK). Decoding that as UTF-8 turns the real
 * error into replacement diamonds, which is what the plugin center showed.
 */
function decodeProcessOutput(chunk) {
  if (chunk == null) return "";
  if (typeof chunk === "string") return chunk;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (!buffer.length) return "";
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    const gbk = new TextDecoder("gbk").decode(buffer);
    const utf8Bad = (utf8.match(/\uFFFD/g) || []).length;
    const gbkBad = (gbk.match(/\uFFFD/g) || []).length;
    return gbkBad < utf8Bad ? gbk : utf8;
  } catch {
    return utf8;
  }
}

module.exports = { decodeProcessOutput };
