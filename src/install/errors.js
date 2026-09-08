"use strict";

class InstallGateError extends Error {
  constructor(message, { code = "INSTALL_GATE", reasons = [], changes = [] } = {}) {
    super(message);
    this.name = "InstallGateError";
    this.code = code;
    this.reasons = reasons;
    this.changes = changes;
  }
}

class InstallCrashError extends Error {
  constructor(message, step) {
    super(message);
    this.name = "InstallCrashError";
    this.step = step;
    this.simulated = true;
  }
}

module.exports = {
  InstallGateError,
  InstallCrashError,
};
