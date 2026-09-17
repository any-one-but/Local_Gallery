// Browser version host shim, injected by web/server.js ahead of the app's own
// script.
//
// It gives the page the library -- ~/Documents/Local Gallery, found or created
// by the server -- as an ordinary File System Access directory handle, so the
// handle-based workspace builder, the metadata logs and the passcode gate run
// unchanged. The handles are the same shape as tauri-fs-shim.js's; only the
// transport differs (fetch to the local server instead of Tauri invoke).
//
// There is deliberately no way to open any other folder: the directory picker
// is removed, and the server refuses every path outside the library.
(function () {
  "use strict";

  var config = window.__LG_WEB;
  if (!config || !config.token) return;
  var TOKEN = String(config.token);

  // No folder picking in the browser version.
  try {
    delete window.showDirectoryPicker;
  } catch (e) {}
  try {
    window.showDirectoryPicker = undefined;
  } catch (e) {}

  function api(cmd, args) {
    return fetch("/__lg/api/" + cmd, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LG-Token": TOKEN },
      body: JSON.stringify(args || {}),
    }).then(function (res) {
      if (cmd === "read_file_bytes") {
        if (!res.ok) throw fsError("NotFoundError", "read failed: " + res.status);
        return res.arrayBuffer();
      }
      return res.json().then(function (value) {
        if (!res.ok) throw new Error((value && value.error) || "request failed");
        return value;
      });
    });
  }

  function writeBytes(absPath, bytes) {
    return fetch("/__lg/api/write_file_bytes", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-LG-Token": TOKEN,
        "X-LG-Path": encodeURIComponent(absPath),
      },
      body: bytes,
    }).then(function (res) {
      if (!res.ok) throw new Error("write failed: " + res.status);
    });
  }

  function mediaUrl(absPath) {
    var p = String(absPath || "");
    if (!p) return "";
    return "/__lg/media/" + TOKEN + "/" + encodeURIComponent(p);
  }

  // --- helpers (as in tauri-fs-shim.js) --------------------------------------
  function joinPath(base, name) {
    var b = String(base || "").replace(/\/+$/, "");
    return b + "/" + String(name || "");
  }
  function baseName(p) {
    var parts = String(p || "").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || "");
  }
  function parentDir(absPath) {
    var p = String(absPath || "").replace(/\/+$/, "");
    var i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i) : "/";
  }
  function fsError(name, message) {
    var e = new Error(message || name);
    e.name = name;
    return e;
  }
  function toBytes(data) {
    if (data == null) return Promise.resolve(new Uint8Array(0));
    if (data instanceof Uint8Array) return Promise.resolve(data);
    if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
    if (ArrayBuffer.isView(data))
      return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
    if (data && typeof data.arrayBuffer === "function")
      return data.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    if (data && typeof data === "object" && "data" in data) return toBytes(data.data);
    return Promise.resolve(new Uint8Array(0));
  }
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
    return api("rename_path", { from: handle._path, to: to }).then(function () {
      handle._path = to;
      handle.name = newName;
    });
  }

  // A file whose bytes are only fetched when asked for. Media never is: the
  // page plays and shows it from mediaUrl(path).
  function makeFileLike(absPath, name, meta) {
    var size = meta && typeof meta.size === "number" ? meta.size : 0;
    var lastModified = meta && typeof meta.mtime_ms === "number" ? meta.mtime_ms : 0;
    function read() {
      return api("read_file_bytes", { path: absPath });
    }
    return {
      name: name,
      size: size,
      lastModified: lastModified,
      type: "",
      path: absPath,
      lgWebMediaUrl: mediaUrl(absPath),
      arrayBuffer: function () { return read(); },
      text: function () {
        return read().then(function (ab) { return new TextDecoder().decode(ab); });
      },
      slice: function () { return this; },
    };
  }

  function WebWritable(absPath) {
    this._path = absPath;
    this._chunks = [];
  }
  WebWritable.prototype.write = function (data) {
    var self = this;
    return toBytes(data).then(function (u8) { self._chunks.push(u8); });
  };
  WebWritable.prototype.truncate = function () { return Promise.resolve(); };
  WebWritable.prototype.seek = function () { return Promise.resolve(); };
  WebWritable.prototype.close = function () {
    var blob = new Blob(this._chunks);
    this._chunks = [];
    return writeBytes(this._path, blob);
  };
  WebWritable.prototype.abort = function () { this._chunks = []; return Promise.resolve(); };

  function WebFileHandle(absPath, name, meta) {
    this.kind = "file";
    this.name = name;
    this._path = absPath;
    this._meta = meta || null;
  }
  WebFileHandle.prototype.getFile = function () {
    return Promise.resolve(
      makeFileLike(this._path, this.name, this._meta || { size: 0, mtime_ms: Date.now() }),
    );
  };
  WebFileHandle.prototype.createWritable = function () {
    return Promise.resolve(new WebWritable(this._path));
  };
  WebFileHandle.prototype.move = function (a, b) { return moveHandle(this, a, b); };
  WebFileHandle.prototype.isSameEntry = function (other) {
    return Promise.resolve(!!other && other._path === this._path);
  };
  WebFileHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  WebFileHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };

  function WebDirHandle(absPath, name) {
    this.kind = "directory";
    this.name = name;
    this._path = absPath;
  }
  WebDirHandle.prototype.entries = function () {
    var self = this;
    return (async function* () {
      var listing = await api("scan_dir", { path: self._path });
      var dirs = listing.dirs || [];
      var files = listing.files || [];
      for (var i = 0; i < dirs.length; i++) {
        yield [dirs[i], new WebDirHandle(joinPath(self._path, dirs[i]), dirs[i])];
      }
      for (var j = 0; j < files.length; j++) {
        var f = files[j];
        yield [
          f.name,
          new WebFileHandle(joinPath(self._path, f.name), f.name, {
            size: f.size,
            mtime_ms: f.mtime_ms,
          }),
        ];
      }
    })();
  };
  WebDirHandle.prototype.values = function () {
    var iter = this.entries();
    return (async function* () {
      for await (var pair of iter) yield pair[1];
    })();
  };
  WebDirHandle.prototype.keys = function () {
    var iter = this.entries();
    return (async function* () {
      for await (var pair of iter) yield pair[0];
    })();
  };
  WebDirHandle.prototype[Symbol.asyncIterator] = function () { return this.entries(); };
  WebDirHandle.prototype.getDirectoryHandle = function (name, opts) {
    var child = joinPath(this._path, name);
    return api("path_kind", { path: child }).then(function (kind) {
      if (kind === "dir") return new WebDirHandle(child, name);
      if (opts && opts.create) {
        return api("make_dir", { path: child }).then(function () {
          return new WebDirHandle(child, name);
        });
      }
      if (kind === "none") throw fsError("NotFoundError", name + " not found");
      throw fsError("TypeMismatchError", name + " is not a directory");
    });
  };
  WebDirHandle.prototype.getFileHandle = function (name, opts) {
    var child = joinPath(this._path, name);
    return api("path_kind", { path: child }).then(function (kind) {
      if (kind === "file") return new WebFileHandle(child, name, null);
      if (opts && opts.create) {
        return api("touch_file", { path: child }).then(function () {
          return new WebFileHandle(child, name, { size: 0, mtime_ms: Date.now() });
        });
      }
      if (kind === "none") throw fsError("NotFoundError", name + " not found");
      throw fsError("TypeMismatchError", name + " is not a file");
    });
  };
  WebDirHandle.prototype.removeEntry = function (name, opts) {
    return api("remove_path", {
      path: joinPath(this._path, name),
      recursive: !!(opts && opts.recursive),
    });
  };
  WebDirHandle.prototype.move = function (a, b) { return moveHandle(this, a, b); };
  WebDirHandle.prototype.resolve = function (other) {
    if (!other || !other._path) return Promise.resolve(null);
    var base = this._path.replace(/\/+$/, "");
    var target = other._path;
    if (target === base) return Promise.resolve([]);
    if (target.indexOf(base + "/") === 0)
      return Promise.resolve(target.slice(base.length + 1).split("/").filter(Boolean));
    return Promise.resolve(null);
  };
  WebDirHandle.prototype.isSameEntry = function (other) {
    return Promise.resolve(!!other && other._path === this._path);
  };
  WebDirHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  WebDirHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };

  var root = String(config.root || "").replace(/\/+$/, "");

  window.__lgWeb = {
    root: root,
    rootName: String(config.rootName || baseName(root)),
    displayRoot: String(config.displayRoot || root),
    mediaUrl: mediaUrl,
    // The library, found or created by the server.
    libraryHandle: function () {
      return new WebDirHandle(root, baseName(root));
    },
    // Whether the library holds anything to show yet. The metadata folder and
    // the app's own Trash folder (__LOCAL_GALLERY_TRASH__) do not count.
    libraryIsEmpty: function () {
      return api("scan_dir", { path: root }).then(function (listing) {
        var dirs = (listing.dirs || []).filter(function (d) {
          return d.charAt(0) !== "." && d.indexOf("__LOCAL_GALLERY_") !== 0;
        });
        var files = (listing.files || []).filter(function (f) { return f.name.charAt(0) !== "."; });
        return dirs.length === 0 && files.length === 0;
      });
    },
  };
})();
