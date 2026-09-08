"use strict";

function createMockElectron() {
  const handles = new Map();
  const windows = [];

  class BrowserWindow {
    constructor(opts = {}) {
      this.opts = opts;
      this._destroyed = false;
      this._shown = false;
      this._focused = false;
      this._events = {};
      this._sent = [];
      this.webContents = {
        send: (...args) => {
          this._sent.push(args);
        },
        once() {},
        on() {},
        setWindowOpenHandler(fn) {
          this._openHandler = fn;
        },
      };
      windows.push(this);
    }

    on(event, fn) {
      (this._events[event] ||= []).push(fn);
      return this;
    }

    once(event, fn) {
      const wrap = (...args) => {
        this._events[event] = (this._events[event] || []).filter((item) => item !== wrap);
        fn(...args);
      };
      return this.on(event, wrap);
    }

    _emit(event, ...args) {
      for (const fn of [...(this._events[event] || [])]) fn(...args);
    }

    show() {
      this._showCount = (this._showCount || 0) + 1;
      this._shown = true;
    }

    focus() {
      this._focused = true;
    }

    hide() {
      this._shown = false;
    }

    isVisible() {
      return Boolean(this._shown) && !this._destroyed;
    }

    destroy() {
      this.close();
    }

    setAlwaysOnTop() {}

    setSkipTaskbar(value) {
      this._skipTaskbar = Boolean(value);
    }

    showInactive() {
      this._showInactiveCount = (this._showInactiveCount || 0) + 1;
      this._shown = true;
    }

    setOpacity(value) {
      this._opacity = value;
    }

    setIgnoreMouseEvents(value) {
      this._ignoreMouse = Boolean(value);
    }

    setFocusable(value) {
      this._focusable = Boolean(value);
    }

    setBounds(bounds) {
      this._bounds = { ...this.getBounds(), ...bounds };
    }

    setPosition(x, y) {
      this._bounds = { ...this.getBounds(), x, y };
    }

    getBounds() {
      return this._bounds || {
        x: this.opts.x || 0,
        y: this.opts.y || 0,
        width: this.opts.width || 0,
        height: this.opts.height || 0,
      };
    }

    restore() {
      this._minimized = false;
    }

    isMinimized() {
      return Boolean(this._minimized);
    }

    close() {
      this._shown = false;
      this._destroyed = true;
      this._emit("closed");
    }

    isDestroyed() {
      return this._destroyed;
    }

    setTitle(title) {
      this._title = title;
    }

    loadFile(page) {
      this._loaded = page;
      this._emit("ready-to-show");
      return Promise.resolve();
    }

    loadURL(url) {
      this._loadedUrl = url;
      return Promise.resolve();
    }
  }

  return {
    BrowserWindow,
    ipcMain: {
      handle(channel, fn) {
        handles.set(channel, fn);
      },
      removeHandler(channel) {
        handles.delete(channel);
      },
      on() {},
      removeListener() {},
      _handles: handles,
      async invoke(channel, event, ...args) {
        const fn = handles.get(channel);
        if (!fn) throw new Error(`no handler ${channel}`);
        return fn(event, ...args);
      },
    },
    shell: {
      opened: [],
      async openExternal(url) {
        this.opened.push(url);
      },
    },
    clipboard: {
      value: "",
      writeText(text) {
        this.value = text;
      },
    },
    nativeTheme: { shouldUseDarkColors: false },
    screen: {
      getDisplayNearestPoint() {
        return { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
      },
      getPrimaryDisplay() {
        return { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
      },
    },
    _windows: windows,
  };
}

function windowEvent(win) {
  return { sender: win.webContents };
}

module.exports = { createMockElectron, windowEvent };
