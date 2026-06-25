// File System Access API shim, backed by native Rust fs::* commands.
//
// Injected as a Tauri initialization script (see src-tauri/src/lib.rs) so the
// existing handle-based workspace code in index.html (showDirectoryPicker, dir/
// file handles, createWritable, the catalog, metadata logs) runs unchanged under
// WKWebView — which has no File System Access API.
//
// Handles are cheap value objects wrapping an absolute path; their async methods
// call the Rust commands. File reads/writes here are for the small
// `.local-gallery/*.json` metadata logs — media is served via the asset
// protocol (see ensureMediaUrl + window.__lg.assetUrl), not read into memory.
(function () {
  "use strict";

  function resolveInvoke() {
    var g = typeof window !== "undefined" ? window : null;
    if (!g) return null;
    if (g.__TAURI__ && g.__TAURI__.core && typeof g.__TAURI__.core.invoke === "function") {
      return g.__TAURI__.core.invoke.bind(g.__TAURI__.core);
    }
    if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === "function") {
      return g.__TAURI_INTERNALS__.invoke.bind(g.__TAURI_INTERNALS__);
    }
    return null;
  }

  var invoke = resolveInvoke();
  if (!invoke) {
    console.warn("[tauri-fs-shim] Tauri invoke unavailable; FS shim not installed");
    return;
  }

  // --- helpers -------------------------------------------------------------
  function joinPath(base, name) {
    var b = String(base || "").replace(/\/+$/, "");
    return b + "/" + String(name || "");
  }
  function baseName(p) {
    var parts = String(p || "").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || "");
  }
  // FS Access throws DOMException with specific names the app may branch on.
  function fsError(name, message) {
    var e = new Error(message || name);
    e.name = name;
    return e;
  }
  function toUint8(data) {
    if (data == null) return Promise.resolve(new Uint8Array(0));
    if (data instanceof Uint8Array) return Promise.resolve(data);
    if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) {
      return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (typeof data === "string") {
      return Promise.resolve(new TextEncoder().encode(data));
    }
    // Blob OR our FileLike — anything exposing arrayBuffer(). FileLike is not a
    // real Blob, so check the method rather than instanceof.
    if (data && typeof data.arrayBuffer === "function") {
      return data.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }
    // FS Access write() also accepts { type:'write', data } params.
    if (data && typeof data === "object" && "data" in data) {
      return toUint8(data.data);
    }
    return Promise.resolve(new Uint8Array(0));
  }

  function parentDir(absPath) {
    var p = String(absPath || "").replace(/\/+$/, "");
    var i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i) : "/";
  }
  // Implements FS Access `handle.move(dest, newName)` / `move(newName)` natively
  // (instant fs rename) instead of copy-through-IPC.
  function moveHandle(handle, a, b) {
    var newName, destParentPath;
    if (typeof a === "string") {
      newName = a;
      destParentPath = parentDir(handle._path);
    } else if (a && a._path) {
      destParentPath = a._path;
      newName = typeof b === "string" && b ? b : handle.name;
    } else {
      return Promise.reject(fsError("TypeError", "invalid move() arguments"));
    }
    var to = joinPath(destParentPath, newName);
    return invoke("rename_path", { from: handle._path, to: to }).then(function () {
      handle._path = to;
      handle.name = newName;
    });
  }

  // --- File (lightweight, lazy) -------------------------------------------
  function makeFileLike(absPath, name, meta) {
    var size = meta && typeof meta.size === "number" ? meta.size : 0;
    var lastModified = meta && typeof meta.mtime_ms === "number" ? meta.mtime_ms : 0;
    function readBytes() {
      return invoke("read_file_bytes", { path: absPath }).then(function (arr) {
        return Uint8Array.from(arr);
      });
    }
    return {
      name: name,
      size: size,
      lastModified: lastModified,
      type: "",
      // getNativePathForFile() reads this to recover the absolute path.
      path: absPath,
      arrayBuffer: function () {
        return readBytes().then(function (u8) { return u8.buffer; });
      },
      text: function () {
        return readBytes().then(function (u8) { return new TextDecoder().decode(u8); });
      },
      slice: function () { return this; },
    };
  }

  // --- Writable ------------------------------------------------------------
  function TauriWritable(absPath) {
    this._path = absPath;
    this._chunks = [];
  }
  TauriWritable.prototype.write = function (data) {
    var self = this;
    return toUint8(data).then(function (u8) { self._chunks.push(u8); });
  };
  TauriWritable.prototype.truncate = function () { return Promise.resolve(); };
  TauriWritable.prototype.seek = function () { return Promise.resolve(); };
  TauriWritable.prototype.close = function () {
    var total = 0;
    for (var i = 0; i < this._chunks.length; i++) total += this._chunks[i].length;
    var merged = new Uint8Array(total);
    var off = 0;
    for (var j = 0; j < this._chunks.length; j++) {
      merged.set(this._chunks[j], off);
      off += this._chunks[j].length;
    }
    this._chunks = [];
    return invoke("write_file_bytes", { path: this._path, bytes: Array.from(merged) });
  };
  TauriWritable.prototype.abort = function () { this._chunks = []; return Promise.resolve(); };

  // --- File handle ---------------------------------------------------------
  function TauriFileHandle(absPath, name, meta) {
    this.kind = "file";
    this.name = name;
    this._path = absPath;
    this._meta = meta || null;
  }
  TauriFileHandle.prototype.getFile = function () {
    var self = this;
    if (self._meta) return Promise.resolve(makeFileLike(self._path, self.name, self._meta));
    // No cached metadata (handle made via getFileHandle): the workspace builder
    // only reads bytes for such files (metadata logs), so size/mtime can be 0.
    return Promise.resolve(makeFileLike(self._path, self.name, { size: 0, mtime_ms: Date.now() }));
  };
  TauriFileHandle.prototype.createWritable = function () {
    return Promise.resolve(new TauriWritable(this._path));
  };
  TauriFileHandle.prototype.move = function (a, b) {
    return moveHandle(this, a, b);
  };
  TauriFileHandle.prototype.isSameEntry = function (other) {
    return Promise.resolve(!!other && other._path === this._path);
  };
  TauriFileHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  TauriFileHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };

  // --- Directory handle ----------------------------------------------------
  function TauriDirHandle(absPath, name) {
    this.kind = "directory";
    this.name = name;
    this._path = absPath;
  }
  TauriDirHandle.prototype._listing = function () {
    return invoke("scan_dir", { path: this._path });
  };
  TauriDirHandle.prototype.entries = function () {
    var self = this;
    return (async function* () {
      var listing = await self._listing();
      var dirs = listing.dirs || [];
      var files = listing.files || [];
      for (var i = 0; i < dirs.length; i++) {
        var dn = dirs[i];
        yield [dn, new TauriDirHandle(joinPath(self._path, dn), dn)];
      }
      for (var j = 0; j < files.length; j++) {
        var f = files[j];
        yield [
          f.name,
          new TauriFileHandle(joinPath(self._path, f.name), f.name, {
            size: f.size,
            mtime_ms: f.mtime_ms,
          }),
        ];
      }
    })();
  };
  TauriDirHandle.prototype.values = function () {
    var iter = this.entries();
    return (async function* () {
      for await (var pair of iter) yield pair[1];
    })();
  };
  TauriDirHandle.prototype.keys = function () {
    var iter = this.entries();
    return (async function* () {
      for await (var pair of iter) yield pair[0];
    })();
  };
  TauriDirHandle.prototype[Symbol.asyncIterator] = function () {
    return this.entries();
  };
  TauriDirHandle.prototype.getDirectoryHandle = function (name, opts) {
    var self = this;
    var child = joinPath(self._path, name);
    return invoke("path_kind", { path: child }).then(function (kind) {
      if (kind === "dir") return new TauriDirHandle(child, name);
      if (opts && opts.create) {
        return invoke("make_dir", { path: child }).then(function () {
          return new TauriDirHandle(child, name);
        });
      }
      if (kind === "none") throw fsError("NotFoundError", name + " not found");
      throw fsError("TypeMismatchError", name + " is not a directory");
    });
  };
  TauriDirHandle.prototype.getFileHandle = function (name, opts) {
    var self = this;
    var child = joinPath(self._path, name);
    return invoke("path_kind", { path: child }).then(function (kind) {
      if (kind === "file") return new TauriFileHandle(child, name, null);
      if (opts && opts.create) {
        return invoke("touch_file", { path: child }).then(function () {
          return new TauriFileHandle(child, name, { size: 0, mtime_ms: Date.now() });
        });
      }
      if (kind === "none") throw fsError("NotFoundError", name + " not found");
      throw fsError("TypeMismatchError", name + " is not a file");
    });
  };
  TauriDirHandle.prototype.removeEntry = function (name, opts) {
    return invoke("remove_path", {
      path: joinPath(this._path, name),
      recursive: !!(opts && opts.recursive),
    });
  };
  TauriDirHandle.prototype.move = function (a, b) {
    return moveHandle(this, a, b);
  };
  TauriDirHandle.prototype.resolve = function (possibleDescendant) {
    if (!possibleDescendant || !possibleDescendant._path) return Promise.resolve(null);
    var base = this._path.replace(/\/+$/, "");
    var target = possibleDescendant._path;
    if (target === base) return Promise.resolve([]);
    if (target.indexOf(base + "/") === 0) {
      return Promise.resolve(target.slice(base.length + 1).split("/").filter(Boolean));
    }
    return Promise.resolve(null);
  };
  TauriDirHandle.prototype.isSameEntry = function (other) {
    return Promise.resolve(!!other && other._path === this._path);
  };
  TauriDirHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  TauriDirHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };

  function rememberRoot(absPath) {
    try { invoke("save_last_root", { path: String(absPath || "") }); } catch (e) {}
  }

  // --- Picker --------------------------------------------------------------
  window.showDirectoryPicker = function () {
    return invoke("pick_root").then(function (path) {
      if (!path) throw fsError("AbortError", "user cancelled");
      rememberRoot(path);
      return new TauriDirHandle(path, baseName(path));
    });
  };

  // Open a library by absolute path (used by the GUI-less dev hook and the
  // auto-reopen-last-root boot routine).
  window.__lg = window.__lg || {};
  window.__lg.openRoot = function (absPath) {
    if (typeof buildWorkspaceFromDirectoryHandle !== "function") {
      return Promise.reject(new Error("workspace builder not ready"));
    }
    rememberRoot(absPath);
    return buildWorkspaceFromDirectoryHandle(new TauriDirHandle(absPath, baseName(absPath)));
  };
  window.__lg.makeDirHandle = function (absPath) {
    return new TauriDirHandle(absPath, baseName(absPath));
  };

  // (No auto-reopen on launch — the app starts with no library loaded, like the
  // Electron build. The last root is still remembered so a "reopen recent"
  // action can be wired up later if wanted.)

  console.info("[tauri-fs-shim] File System Access shim installed");
})();
