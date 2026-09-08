"use strict";

function redactDiagnosticText(value) {
  return String(value || "")
    .replace(/([?&](?:token|access_token|api[_-]?key|key|secret|password|auth)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,})\b/g, "[redacted]")
    .replace(/((?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .replace(/([A-Za-z]:\\Users\\)[^\\/\s"']+/gi, "$1[user]")
    .replace(/(\/Users\/|\/home\/)[^/\s"']+/g, "$1[user]");
}

module.exports = { redactDiagnosticText };
