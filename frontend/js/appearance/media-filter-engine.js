/* Media filter engine
   MediaFilterEngine: the WebGL surface per media element that draws the
   filters. */

const MediaFilterEngine = (() => {
  const surfaces = new Map();
  let rafId = null;
  // Upper bound on how long a retained filtered frame may stand in for media
  // that never presents. Generous enough for a slow video to spin up, short
  // enough that a broken file does not strand the pane on the previous picture.
  const HOLD_FRAME_MAX_MS = 4000;

  const VERTEX_SHADER_SOURCE = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER_SOURCE = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform sampler2D u_prev;
    uniform vec2 u_canvas;
    uniform vec2 u_source;
    uniform vec2 u_cropOrigin;
    uniform vec2 u_cropSize;
    uniform vec2 u_destOrigin;
    uniform vec2 u_destSize;
    uniform float u_time;
    uniform float u_hasPrev;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_temperature;
    uniform float u_hue;
    uniform float u_blackCrush;
    uniform float u_whiteCrush;
    uniform float u_colorCrush;
    uniform float u_pixelate;
    uniform float u_blur;
    uniform float u_detail;
    uniform float u_chroma;
    uniform float u_halation;
    uniform float u_ghosting;
    uniform float u_lineDamage;
    uniform float u_grain;
    uniform float u_vignette;
    uniform float u_cornerRadius;
    uniform float u_animated;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 hueRotate(vec3 color, float degrees) {
      float a = radians(degrees);
      float c = cos(a);
      float s = sin(a);
      mat3 m = mat3(
        0.213 + c * 0.787 - s * 0.213,
        0.213 - c * 0.213 + s * 0.143,
        0.213 - c * 0.213 - s * 0.787,
        0.715 - c * 0.715 - s * 0.715,
        0.715 + c * 0.285 + s * 0.140,
        0.715 - c * 0.715 + s * 0.715,
        0.072 - c * 0.072 + s * 0.928,
        0.072 - c * 0.072 - s * 0.283,
        0.072 + c * 0.928 + s * 0.072
      );
      return clamp(m * color, 0.0, 1.0);
    }

    vec3 applyColorPipeline(vec3 color) {
      color *= max(0.0, 1.0 + u_brightness);
      color = (color - 0.5) * max(0.0, 1.0 + u_contrast) + 0.5;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = vec3(luma) + (color - vec3(luma)) * max(0.0, 1.0 + u_saturation);
      if (abs(u_temperature) > 0.0001) {
        float before = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color *= vec3(1.0 + u_temperature * 0.22, 1.0 + u_temperature * 0.05, 1.0 - u_temperature * 0.24);
        float after = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color += vec3(before - after);
      }
      color = hueRotate(color, u_hue);
      if (u_blackCrush > 0.0001) {
        float floorValue = u_blackCrush;
        color = max(vec3(0.0), (color - vec3(floorValue)) / max(0.001, 1.0 - floorValue));
      }
      if (u_whiteCrush > 0.0001) {
        float ceilValue = 1.0 - u_whiteCrush;
        color = min(vec3(1.0), color / max(0.001, ceilValue));
      }
      if (u_colorCrush > 0.0001) {
        float levels = max(2.0, floor(24.0 - u_colorCrush * 10.0 + 0.5));
        color = floor(color * (levels - 1.0) + 0.5) / (levels - 1.0);
      }
      return clamp(color, 0.0, 1.0);
    }

    vec2 sourceUvForLocal(vec2 local) {
      vec2 workingLocal = clamp(local, 0.0, 1.0);
      if (u_pixelate > 1.0001) {
        vec2 px = workingLocal * u_destSize;
        px = floor(px / u_pixelate) * u_pixelate + vec2(u_pixelate * 0.5);
        workingLocal = clamp(px / max(vec2(1.0), u_destSize), 0.0, 1.0);
      }
      vec2 srcPx = u_cropOrigin + workingLocal * u_cropSize;
      return clamp(srcPx / max(vec2(1.0), u_source), 0.0, 1.0);
    }

    vec4 samplePipeline(vec2 local) {
      vec2 uv = sourceUvForLocal(local);
      vec3 color = texture2D(u_tex, uv).rgb;
      return vec4(applyColorPipeline(color), 1.0);
    }

    vec3 blurredPipeline(vec2 local) {
      float radius = max(0.0, u_blur);
      if (radius <= 0.0001) return samplePipeline(local).rgb;
      vec2 stepUv = vec2(radius) / max(vec2(1.0), u_destSize);
      vec3 c = samplePipeline(local).rgb * 0.22;
      c += samplePipeline(local + vec2(stepUv.x, 0.0)).rgb * 0.12;
      c += samplePipeline(local - vec2(stepUv.x, 0.0)).rgb * 0.12;
      c += samplePipeline(local + vec2(0.0, stepUv.y)).rgb * 0.12;
      c += samplePipeline(local - vec2(0.0, stepUv.y)).rgb * 0.12;
      c += samplePipeline(local + stepUv).rgb * 0.075;
      c += samplePipeline(local - stepUv).rgb * 0.075;
      c += samplePipeline(local + vec2(stepUv.x, -stepUv.y)).rgb * 0.075;
      c += samplePipeline(local + vec2(-stepUv.x, stepUv.y)).rgb * 0.075;
      return c;
    }

    void main() {
      vec2 pixel = vec2(v_uv.x * u_canvas.x, (1.0 - v_uv.y) * u_canvas.y);
      vec2 local = (pixel - u_destOrigin) / max(vec2(1.0), u_destSize);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) {
        discard;
      }

      vec3 color = blurredPipeline(local);

      if (u_detail > 0.0001) {
        vec2 stepUv = 1.0 / max(vec2(1.0), u_destSize);
        vec3 neighbor =
          blurredPipeline(local + vec2(stepUv.x, 0.0)) +
          blurredPipeline(local - vec2(stepUv.x, 0.0)) +
          blurredPipeline(local + vec2(0.0, stepUv.y)) +
          blurredPipeline(local - vec2(0.0, stepUv.y));
        neighbor *= 0.25;
        color += (color - neighbor) * (0.45 + u_detail * 0.95) * u_detail;
      }

      if (u_chroma > 0.0001) {
        vec2 shift = vec2(u_chroma / max(1.0, u_destSize.x), u_chroma * 0.18 / max(1.0, u_destSize.y));
        float r = blurredPipeline(local - shift).r;
        float b = blurredPipeline(local + shift).b;
        color = vec3(r, color.g, b);
      }

      if (u_halation > 0.0001) {
        vec2 haloStep = vec2((1.5 + u_halation * 7.5) / max(1.0, u_destSize.x), (1.5 + u_halation * 7.5) / max(1.0, u_destSize.y));
        vec3 h =
          blurredPipeline(local + haloStep).rgb +
          blurredPipeline(local - haloStep).rgb +
          blurredPipeline(local + vec2(haloStep.x, -haloStep.y)).rgb +
          blurredPipeline(local + vec2(-haloStep.x, haloStep.y)).rgb;
        h *= 0.25;
        float hot = smoothstep(0.62, 1.0, dot(h, vec3(0.299, 0.587, 0.114)));
        color += vec3(1.0, 0.38, 0.12) * hot * u_halation * 0.55;
      }

      if (u_ghosting > 0.0001 && u_hasPrev > 0.5) {
        vec2 ghostUv = clamp(v_uv + vec2(-0.006 * u_ghosting, 0.003 * u_ghosting), 0.0, 1.0);
        vec3 prev = texture2D(u_prev, ghostUv).rgb;
        color = mix(color, prev, clamp(u_ghosting * 0.38, 0.0, 0.7));
      }

      if (u_lineDamage > 0.0001) {
        float band = floor((local.y + u_time * 0.00008) * (38.0 + u_lineDamage * 120.0));
        float n = hash12(vec2(band, floor(u_time * 0.025)));
        float gate = step(1.0 - u_lineDamage * 0.22, n);
        color += vec3((n - 0.5) * gate * u_lineDamage * 0.28);
        color = mix(color, vec3(n), gate * u_lineDamage * 0.035);
      }

      if (u_grain > 0.0001) {
        float n = hash12(pixel + vec2(u_time * (u_animated > 0.5 ? 0.08 : 0.0), u_time * 0.031));
        color += (n - 0.5) * u_grain * 0.9;
      }

      if (u_vignette > 0.0001) {
        vec2 centered = local - vec2(0.5);
        float vig = smoothstep(0.2, 0.76, length(centered) * 1.35);
        color *= 1.0 - vig * u_vignette;
      }

      float alpha = 1.0;
      if (u_cornerRadius > 0.0001) {
        float r = min(u_destSize.x, u_destSize.y) * u_cornerRadius;
        vec2 q = abs(local * u_destSize - u_destSize * 0.5) - (u_destSize * 0.5 - vec2(r));
        float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        alpha = 1.0 - smoothstep(-1.0, 1.0, dist);
      }

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "shader compile failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "program link failed";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function configureTexture(gl, texture) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  function createGlState(canvas) {
    const gl =
      canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: false,
      }) ||
      canvas.getContext("experimental-webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: false,
      });
    if (!gl) throw new Error("webgl_unavailable");
    const program = createProgram(gl);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const sourceTexture = gl.createTexture();
    const prevTexture = gl.createTexture();
    configureTexture(gl, sourceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    configureTexture(gl, prevTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    const uniforms = {};
    [
      "u_tex", "u_prev", "u_canvas", "u_source", "u_cropOrigin", "u_cropSize",
      "u_destOrigin", "u_destSize", "u_time", "u_hasPrev", "u_brightness",
      "u_contrast", "u_saturation", "u_temperature", "u_hue", "u_blackCrush",
      "u_whiteCrush", "u_colorCrush", "u_pixelate", "u_blur", "u_detail",
      "u_chroma", "u_halation", "u_ghosting", "u_lineDamage", "u_grain",
      "u_vignette", "u_cornerRadius", "u_animated",
    ].forEach((name) => {
      uniforms[name] = gl.getUniformLocation(program, name);
    });
    return {
      gl,
      program,
      vertexBuffer,
      sourceTexture,
      prevTexture,
      uniforms,
      positionLocation: gl.getAttribLocation(program, "a_pos"),
      prevW: 0,
      prevH: 0,
      hasPrev: false,
    };
  }

  function updateEngineState() {
    const appEl = document.getElementById("app");
    if (!appEl) return;
    const anyDrawn = Array.from(surfaces.values()).some(
      (s) => s.active && s.hasDrawn,
    );
    if (anyDrawn) appEl.setAttribute("data-media-filter-engine", "on");
    else appEl.removeAttribute("data-media-filter-engine");
  }

  function kickLoadCleanImageForSurface(surface, target) {
    if (!surface || surface.cleanImageLoading) return;
    if (!window.electronAPI || !window.electronAPI.isTauri) return;
    let p = (target && typeof target === "object")
      ? (target.nativePath || (target.file && target.file.path) || nativePathForRecord(target) || "")
      : "";
    if (!p && target && target.dirPath && target.name) {
      p = String(target.dirPath).replace(/\/$/, "") + "/" + target.name;
    }
    if (!p) return;
    if (surface.cleanImagePath === p && surface.cleanImageBitmap) return;
    surface.cleanImageLoading = true;
    surface.cleanImagePath = p;
    (async () => {
      try {
        const arr = await window.__TAURI__.core.invoke("read_file_bytes", { path: p });
        const u8 = new Uint8Array(arr);
        const blob = new Blob([u8]);
        const bmp = await createImageBitmap(blob);
        if (surface.cleanImagePath === p) {
          if (surface.cleanImageBitmap) {
            try { surface.cleanImageBitmap.close && surface.cleanImageBitmap.close(); } catch {}
          }
          surface.cleanImageBitmap = bmp;
          surface.sourceDirty = true;
          requestRender();
        } else {
          try { bmp.close && bmp.close(); } catch {}
        }
      } catch {
      } finally {
        if (surface) surface.cleanImageLoading = false;
      }
    })();
  }

  function ensureSurface(name) {
    if (surfaces.has(name)) return surfaces.get(name);
    const surface = {
      name,
      container: null,
      mediaEl: null,
      target: null,
      type: null,
      filterMode: "off",
      canvas: null,
      glState: null,
      active: false,
      bound: false,
      hasDrawn: false,
      awaitingFreshFrame: false,
      videoFrameActive: false,
      videoFrameToken: 0,
      nextVideoRenderAt: 0,
      mediaEventHandler: null,
      sourceDirty: true,
      sourceUploadedW: 0,
      sourceUploadedH: 0,
      cleanImageBitmap: null,
      cleanImageLoading: false,
      cleanImagePath: null,
      uploadCanvas: null,
      uploadCtx: null,
      holdCanvas: null,
      holdCtx: null,
      holdActive: false,
      holdTimer: 0,
    };
    surfaces.set(name, surface);
    return surface;
  }

  // ---- Retained filtered frame ("hold canvas") ----------------------------
  //
  // The GL context is preserveDrawingBuffer:false, so the compositor wipes the
  // WebGL canvas the moment it has presented it. `hasDrawn` + the .ready class
  // therefore did NOT preserve anything across a file change: the canvas stayed
  // on screen at opacity 1 as a fully TRANSPARENT layer, and what the user
  // actually saw was the media element underneath it — the same outgoing
  // picture with only the cheap CSS approximation on it. Grain, vignette,
  // crush and contrast vanished a frame after the last draw, which is the
  // "colour drain on the outgoing media" while the next file loads.
  //
  // A plain 2D canvas does retain its pixels indefinitely. So at the exact
  // moment we would otherwise abandon the surface, we render one final frame
  // (buffer still valid in this tick), blit it into that 2D canvas, and show
  // that instead. The outgoing frame the user keeps looking at is then the real
  // filtered frame, pixel for pixel, for as long as the next file needs. It
  // costs one blit per navigation rather than one per rendered frame.
  function ensureHoldCanvas(surface) {
    if (!surface.holdCanvas) {
      surface.holdCanvas = document.createElement("canvas");
      surface.holdCanvas.className = "mediaHoldCanvas";
      surface.holdCanvas.setAttribute("aria-hidden", "true");
      surface.holdCtx = surface.holdCanvas.getContext("2d", { alpha: true });
    }
    if (surface.container && !surface.container.contains(surface.holdCanvas)) {
      surface.container.appendChild(surface.holdCanvas);
    }
    return surface.holdCtx ? surface.holdCanvas : null;
  }

  function captureHoldFrame(surface) {
    if (!surface || !surface.active || !surface.mediaEl || !surface.canvas) return false;
    // Refresh the drawing buffer in THIS tick — anything drawn on an earlier
    // frame has already been discarded by the compositor.
    try {
      if (!drawSurface(surface, performance.now()) && !surface.hasDrawn) return false;
    } catch {
      return false;
    }
    if (!surface.hasDrawn) return false;
    const src = surface.canvas;
    const w = Number(src.width) || 0;
    const h = Number(src.height) || 0;
    if (!(w > 0) || !(h > 0)) return false;
    const hold = ensureHoldCanvas(surface);
    if (!hold) return false;
    if (hold.width !== w) hold.width = w;
    if (hold.height !== h) hold.height = h;
    try {
      surface.holdCtx.setTransform(1, 0, 0, 1, 0, 0);
      surface.holdCtx.clearRect(0, 0, w, h);
      surface.holdCtx.drawImage(src, 0, 0, w, h);
    } catch {
      return false;
    }
    paintDebugMediaLayer(hold, "hold");
    hold.style.display = "block";
    hold.classList.add("ready");
    surface.holdActive = true;
    // The live canvas is empty from here on; let the retained copy do the work.
    src.style.display = "none";
    src.classList.remove("ready");
    // Safety net: if the incoming media never presents (missing file, decode
    // failure), the retained frame must not strand the pane on the previous
    // picture forever.
    if (surface.holdTimer) clearTimeout(surface.holdTimer);
    surface.holdTimer = setTimeout(() => {
      surface.holdTimer = 0;
      releaseHoldFrame(surface);
    }, HOLD_FRAME_MAX_MS);
    return true;
  }

  // Called the instant the surface has a real frame for its CURRENT target, so
  // the swap is a straight cut between two correctly filtered frames — never a
  // dissolve through an unfiltered one.
  function releaseHoldFrame(surface) {
    if (!surface) return;
    if (surface.holdTimer) {
      clearTimeout(surface.holdTimer);
      surface.holdTimer = 0;
    }
    if (!surface.holdActive) return;
    surface.holdActive = false;
    if (!surface.holdCanvas) return;
    surface.holdCanvas.classList.remove("ready");
    surface.holdCanvas.style.display = "none";
  }

  function destroyHoldFrame(surface) {
    if (!surface) return;
    if (surface.holdTimer) {
      clearTimeout(surface.holdTimer);
      surface.holdTimer = 0;
    }
    surface.holdActive = false;
    if (surface.holdCanvas && surface.holdCanvas.parentElement)
      surface.holdCanvas.parentElement.removeChild(surface.holdCanvas);
    surface.holdCanvas = null;
    surface.holdCtx = null;
  }

  function ensureCanvas(surface) {
    if (!surface.canvas) {
      surface.canvas = document.createElement("canvas");
      surface.canvas.className = "mediaCanvas";
      surface.canvas.style.display = "none";
      surface.canvas.style.background = "transparent";
    }
    if (!surface.glState) surface.glState = createGlState(surface.canvas);
    if (surface.container && !surface.container.contains(surface.canvas)) {
      surface.container.appendChild(surface.canvas);
    }
  }

  // Every one of these events means "the pixels behind this element changed",
  // so each has to mark the source dirty as well as ask for a render. Without
  // that flag renderSurface reuses the texture it already uploaded (which is
  // what keeps grain animating cheaply) and paints the previous frame -- the
  // case that bites is a paused video being seeked where
  // requestVideoFrameCallback is unavailable, since that callback is otherwise
  // the only thing that sets the flag for video.
  function mediaEventHandlerForSurface(surface) {
    if (!surface.mediaEventHandler) {
      surface.mediaEventHandler = () => {
        surface.sourceDirty = true;
        requestRender();
      };
    }
    return surface.mediaEventHandler;
  }

  const MEDIA_SOURCE_EVENTS = [
    "load",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "play",
    "playing",
    "pause",
    "seeked",
  ];

  function bindMediaEvents(surface, el) {
    if (!el || surface.mediaEl === el) return;
    const onMediaEvent = mediaEventHandlerForSurface(surface);
    if (surface.mediaEl && surface.bound) {
      for (let i = 0; i < MEDIA_SOURCE_EVENTS.length; i++) {
        surface.mediaEl.removeEventListener(
          MEDIA_SOURCE_EVENTS[i],
          onMediaEvent,
        );
      }
    }
    if (surface.mediaEl !== el) {
      if (surface.cleanImageBitmap) {
        try { surface.cleanImageBitmap.close && surface.cleanImageBitmap.close(); } catch {}
        surface.cleanImageBitmap = null;
      }
      surface.cleanImageLoading = false;
      surface.cleanImagePath = null;
      if (surface.glState) surface.glState.hasPrev = false;
    }
    surface.mediaEl = el;
    surface.bound = true;
    surface.sourceDirty = true;
    for (let i = 0; i < MEDIA_SOURCE_EVENTS.length; i++) {
      el.addEventListener(MEDIA_SOURCE_EVENTS[i], onMediaEvent);
    }
  }

  function attach(name, mediaEl, container, type, filterMode, target = null) {
    const surface = ensureSurface(name);
    const targetChanged =
      surface.target !== target ||
      surface.mediaEl !== mediaEl ||
      surface.type !== type;
    surface.container = container;
    surface.target = target;
    surface.type = type;
    surface.filterMode = filterMode || "off";
    surface.active = true;
    surface.awaitingFreshFrame = true;
    surface.nextVideoRenderAt = 0;
    surface.sourceDirty = true;
    bindMediaEvents(surface, mediaEl);
    try {
      ensureCanvas(surface);
    } catch {
      if (mediaEl) mediaEl.classList.remove("mediaHidden");
      surface.active = false;
      return;
    }
    if (targetChanged) {
      // The retained hold frame is the only thing that actually survives a
      // composite, so it -- not the live canvas -- decides whether there is a
      // frame worth keeping on screen while the new target loads.
      surface.hasDrawn = surface.holdActive;
      if (surface.holdActive) ensureHoldCanvas(surface);
      else if (surface.canvas) {
        surface.canvas.style.display = "none";
        surface.canvas.classList.remove("ready");
      }
      if (surface.glState) surface.glState.hasPrev = false;
    }
    if (mediaEl) {
      // Always keep the CSS approximation of this target's appearance on the
      // source element -- images and video alike, and whether or not it is
      // currently hidden behind the canvas. It costs nothing while hidden and
      // guarantees that any frame in which the element is visible (canvas not
      // drawn yet, decode still pending, GL unavailable) is already colour
      // graded rather than raw.
      syncMediaElementAppearance(mediaEl, target, "none");
      if (
        surface.holdActive ||
        (surface.canvas && surface.canvas.classList.contains("ready"))
      )
        mediaEl.classList.add("mediaHidden");
      else mediaEl.classList.remove("mediaHidden");
    }
    if (type === "video" && mediaEl && typeof mediaEl.requestVideoFrameCallback === "function") {
      surface.videoFrameActive = true;
      surface.videoFrameToken++;
      const frameToken = surface.videoFrameToken;
      const onFrame = (now) => {
        if (
          !surface.active ||
          !surface.videoFrameActive ||
          frameToken !== surface.videoFrameToken
        )
          return;
        const isPreviewSurface = String(surface.name || "") === "preview";
        // The preview pane's maxFps is fixed at 60 regardless of overlay cost, so
        // resolving the overlay config here would be pure waste (an allocation-
        // heavy call — colorFilters array + several template strings — on EVERY
        // native video frame callback, i.e. up to the clip's actual fps, not the
        // throttled render fps). Skipping it for preview measurably cuts JS
        // garbage during video playback, which otherwise risks a GC pause showing
        // up as a stuck frame (the video keeps decoding underneath; only the
        // canvas redraw stalls) — worse the longer/higher-fps the clip.
        const maxFps = isPreviewSurface
          ? 60
          : Math.max(
              1,
              Number(
                mediaOverlayLiveVideoProfile(
                  resolveMediaOverlayConfigForTarget(surface.target),
                ).maxFps,
              ) || 24,
            );
        const intervalMs = 1000 / maxFps;
        const t = Number.isFinite(Number(now)) ? Number(now) : performance.now();
        if (surface.awaitingFreshFrame || !surface.nextVideoRenderAt || t >= surface.nextVideoRenderAt) {
          surface.nextVideoRenderAt = t + intervalMs;
          surface.sourceDirty = true;
          requestRender();
        }
        mediaEl.requestVideoFrameCallback(onFrame);
      };
      mediaEl.requestVideoFrameCallback(onFrame);
    } else {
      surface.videoFrameToken++;
      surface.videoFrameActive = false;
    }
    updateEngineState();
    requestRender();
  }

  function detach(name, options = null) {
    const surface = surfaces.get(name);
    if (!surface) return;
    const preserveFrame = !!(options && options.preserveFrame);
    // Snapshot the live frame into the retained 2D canvas while the surface is
    // still active and the GL buffer is still valid -- one tick later it is
    // gone. This is what actually makes preserveFrame preserve anything.
    if (preserveFrame && !surface.holdActive) captureHoldFrame(surface);
    if (!preserveFrame) releaseHoldFrame(surface);
    surface.active = false;
    surface.target = null;
    surface.awaitingFreshFrame = false;
    surface.videoFrameActive = false;
    surface.videoFrameToken++;
    surface.nextVideoRenderAt = 0;
    if (surface.cleanImageBitmap) {
      try { surface.cleanImageBitmap.close && surface.cleanImageBitmap.close(); } catch {}
      surface.cleanImageBitmap = null;
    }
    surface.cleanImageLoading = false;
    surface.cleanImagePath = null;
    if (!preserveFrame) {
      surface.hasDrawn = false;
      if (surface.canvas) {
        surface.canvas.style.display = "none";
        surface.canvas.classList.remove("ready");
      }
      if (surface.glState) surface.glState.hasPrev = false;
    } else {
      surface.hasDrawn = surface.holdActive;
    }
    if (!preserveFrame && surface.uploadCanvas) {
      resizeCanvasBuffer(surface.uploadCanvas, 1, 1);
    }
    updateEngineState();
  }

  function reset(name) {
    const surface = surfaces.get(name);
    if (!surface) return;
    surface.active = false;
    surface.target = null;
    surface.hasDrawn = false;
    surface.awaitingFreshFrame = false;
    surface.videoFrameActive = false;
    surface.videoFrameToken++;
    if (surface.cleanImageBitmap) {
      try { surface.cleanImageBitmap.close && surface.cleanImageBitmap.close(); } catch {}
      surface.cleanImageBitmap = null;
    }
    surface.cleanImageLoading = false;
    surface.cleanImagePath = null;
    destroyHoldFrame(surface);
    if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
    if (surface.canvas && surface.canvas.parentElement) {
      surface.canvas.parentElement.removeChild(surface.canvas);
    }
    surface.canvas = null;
    surface.glState = null;
    surface.sourceDirty = true;
    surface.sourceUploadedW = 0;
    surface.sourceUploadedH = 0;
    if (surface.uploadCanvas) resizeCanvasBuffer(surface.uploadCanvas, 1, 1);
    surface.uploadCanvas = null;
    surface.uploadCtx = null;
    updateEngineState();
  }

  function requestRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(render);
  }

  function render(time) {
    rafId = null;
    let needsMore = false;
    for (const surface of surfaces.values()) {
      if (!surface.active) continue;
      if (drawSurface(surface, time)) needsMore = true;
    }
    updateEngineState();
    if (needsMore) requestRender();
  }

  function uploadSourceTexture(surface, drawSource) {
    const state = surface.glState;
    const gl = state.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawSource);
    configureTexture(gl, state.sourceTexture);
  }

  function prepareStillImageUploadSource(surface, drawSource, srcW, srcH, maxPixels) {
    const sourcePixels =
      Math.max(1, Number(srcW) || 1) * Math.max(1, Number(srcH) || 1);
    const pixelBudget = Math.max(1, Number(maxPixels) || 1);
    if (!surface || !drawSource || !(sourcePixels > pixelBudget * 1.35)) {
      return { source: drawSource, width: srcW, height: srcH };
    }
    if (!surface.uploadCanvas) {
      surface.uploadCanvas = document.createElement("canvas");
      surface.uploadCtx =
        surface.uploadCanvas.getContext("2d", {
          alpha: true,
          desynchronized: true,
        }) || surface.uploadCanvas.getContext("2d", { alpha: true });
    }
    const ctx = surface.uploadCtx;
    if (!ctx) return { source: drawSource, width: srcW, height: srcH };
    const scale = Math.sqrt(pixelBudget / sourcePixels);
    const nextW = Math.max(1, Math.round(srcW * scale));
    const nextH = Math.max(1, Math.round(srcH * scale));
    resizeCanvasBuffer(surface.uploadCanvas, nextW, nextH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, nextW, nextH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawSource, 0, 0, nextW, nextH);
    return { source: surface.uploadCanvas, width: nextW, height: nextH };
  }

  function uniform1f(gl, location, value) {
    if (location) gl.uniform1f(location, Number(value) || 0);
  }

  function drawSurface(surface, time) {
    let overlayCfg = resolveMediaOverlayConfigForSurface(surface);
    if (!overlayCfg) {
      if (surface.canvas) {
        surface.canvas.style.display = "none";
        surface.canvas.classList.remove("ready");
      }
      if (surface.mediaEl) {
        surface.mediaEl.classList.remove("mediaHidden");
        syncMediaElementAppearance(surface.mediaEl, surface.target, "none");
      }
      surface.hasDrawn = false;
      surface.awaitingFreshFrame = false;
      return false;
    }
    if (!surface.mediaEl || !surface.container || !surface.canvas || !surface.glState)
      return false;

    const el = surface.mediaEl;
    const isVideo = surface.type === "video";

    let drawSource = el;
    let srcW = isVideo ? el.videoWidth : el.naturalWidth;
    let srcH = isVideo ? el.videoHeight : el.naturalHeight;
    const ready = isVideo
      ? el.readyState >= 2 && srcW > 0 && srcH > 0
      : el.complete && srcW > 0 && srcH > 0;
    if (!ready) {
      if (!surface.hasDrawn && surface.canvas) {
        surface.canvas.style.display = "none";
        surface.canvas.classList.remove("ready");
        if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
      } else if (surface.hasDrawn && surface.mediaEl) {
        surface.mediaEl.classList.add("mediaHidden");
      }
      return false;
    }

    // Never read pixels from a video that is seeking. In WebKit, uploading a
    // video frame that has not arrived yet blocks the page (and the window)
    // until the decoder produces one; a scrub is a stream of seeks, so it froze
    // the whole fullscreen window on its last frame. Keep showing what was
    // drawn -- `seeked` marks the source dirty and asks for the next render.
    if (isVideo && el.seeking && surface.hasDrawn) return false;

    if (!isVideo && window.electronAPI && window.electronAPI.isTauri) {
      if (surface.cleanImageBitmap && surface.cleanImageBitmap.width > 0) {
        drawSource = surface.cleanImageBitmap;
        srcW = drawSource.width;
        srcH = drawSource.height;
      }
    }

    const cw = surface.container.clientWidth || 0;
    const ch = surface.container.clientHeight || 0;
    if (!cw || !ch || !(srcW > 0) || !(srcH > 0)) return false;

    let sourceCrop = { sx: 0, sy: 0, sw: srcW, sh: srcH };
    const croppedSrcW = Math.max(1, Number(sourceCrop.sw || srcW || 1));
    const croppedSrcH = Math.max(1, Number(sourceCrop.sh || srcH || 1));
    const rect = computeContainRect(croppedSrcW, croppedSrcH, cw, ch);
    const dpr = window.devicePixelRatio || 1;
    const isPreviewSurface = String(surface.name || "") === "preview";
    const isVideoPlaying = isVideo && !el.paused && !el.ended;
    const liveVideoProfile =
      isVideoPlaying && !isPreviewSurface
        ? mediaOverlayLiveVideoProfile(overlayCfg)
        : null;
    let pixelScale = 1;
    if (isPreviewSurface && isVideoPlaying) {
      pixelScale = capScaleForPixelBudget(
        cw * dpr,
        ch * dpr,
        previewRenderMaxPixels(surface, true, true, overlayCfg),
      );
    } else if (liveVideoProfile) {
      pixelScale = capScaleForPixelBudget(
        cw * dpr,
        ch * dpr,
        liveVideoProfile.maxOutputPixels,
      );
    }
    const detailScale = computePreviewRenderScale(
      surface,
      overlayCfg,
      rect,
      croppedSrcW,
      croppedSrcH,
      isVideo,
      pixelScale,
    );
    const baseRenderDpr = Math.max(0.5, dpr * pixelScale * detailScale);
    // Cursor zoom scales this canvas up with CSS, so its backing store has to
    // grow with it or the filtered picture is the only thing on screen that
    // goes soft. The boost is bounded by what the source actually holds and by
    // its own pixel budget, and it steps in powers of two so a continuous zoom
    // reallocates the canvas a handful of times rather than every frame.
    const renderDpr =
      baseRenderDpr *
      mediaZoomRenderBoost(
        surface.container,
        rect,
        croppedSrcW,
        croppedSrcH,
        baseRenderDpr,
        isVideoPlaying,
      );
    const pixelW = Math.max(1, Math.round(cw * renderDpr));
    const pixelH = Math.max(1, Math.round(ch * renderDpr));
    if (surface.canvas.width !== pixelW || surface.canvas.height !== pixelH) {
      surface.canvas.width = pixelW;
      surface.canvas.height = pixelH;
      surface.glState.hasPrev = false;
      // Stills may have been downscaled to the old output size; restage.
      if (!isVideo) surface.sourceDirty = true;
    }

    const filterAnimationEnabled = animatedMediaFiltersEnabledForType(
      surface.type,
    );
    const needsAnim = filterAnimationEnabled && !!overlayCfg.grain;
    // Grain (and any other time-based overlay) has to keep painting on stills
    // and paused video. Re-uploading the source every frame is wasted work —
    // only playing video, a new still, or a dirty source needs a new texture.
    const sourceNeedsUpload =
      !surface.hasDrawn ||
      !surface.sourceUploadedW ||
      !!surface.sourceDirty ||
      (isVideoPlaying && !surface.videoFrameActive);

    if (sourceNeedsUpload) {
      if (!isVideo) {
        const uploadMaxPixels = Math.max(
          1,
          Math.round(Math.max(1, rect.w * renderDpr)) *
            Math.round(Math.max(1, rect.h * renderDpr)),
        );
        try {
          const staged = prepareStillImageUploadSource(
            surface,
            drawSource,
            srcW,
            srcH,
            uploadMaxPixels,
          );
          drawSource = staged.source;
          srcW = staged.width;
          srcH = staged.height;
        } catch {}
      }
    } else {
      srcW = surface.sourceUploadedW;
      srcH = surface.sourceUploadedH;
    }

    sourceCrop = { sx: 0, sy: 0, sw: srcW, sh: srcH };
    const uploadSrcW = Math.max(1, Number(sourceCrop.sw || srcW || 1));
    const uploadSrcH = Math.max(1, Number(sourceCrop.sh || srcH || 1));

    const state = surface.glState;
    const gl = state.gl;
    if (sourceNeedsUpload) {
      try {
        uploadSourceTexture(surface, drawSource);
        surface.sourceDirty = false;
        surface.sourceUploadedW = srcW;
        surface.sourceUploadedH = srcH;
      } catch {
        if (!isVideo && window.electronAPI && window.electronAPI.isTauri)
          kickLoadCleanImageForSurface(surface, surface.target);
        if (!surface.hasDrawn) {
          surface.canvas.style.display = "none";
          surface.canvas.classList.remove("ready");
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
        }
        return false;
      }
    }

    gl.viewport(0, 0, pixelW, pixelH);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.vertexBuffer);
    gl.enableVertexAttribArray(state.positionLocation);
    gl.vertexAttribPointer(state.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.sourceTexture);
    gl.uniform1i(state.uniforms.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.prevTexture);
    gl.uniform1i(state.uniforms.u_prev, 1);
    gl.uniform2f(state.uniforms.u_canvas, pixelW, pixelH);
    gl.uniform2f(state.uniforms.u_source, srcW, srcH);
    gl.uniform2f(state.uniforms.u_cropOrigin, sourceCrop.sx || 0, sourceCrop.sy || 0);
    gl.uniform2f(state.uniforms.u_cropSize, uploadSrcW, uploadSrcH);
    gl.uniform2f(
      state.uniforms.u_destOrigin,
      rect.x * renderDpr,
      rect.y * renderDpr,
    );
    gl.uniform2f(
      state.uniforms.u_destSize,
      Math.max(1, rect.w * renderDpr),
      Math.max(1, rect.h * renderDpr),
    );
    uniform1f(gl, state.uniforms.u_time, time || performance.now());
    uniform1f(gl, state.uniforms.u_hasPrev, state.hasPrev ? 1 : 0);
    uniform1f(gl, state.uniforms.u_brightness, overlayCfg.brightness);
    uniform1f(gl, state.uniforms.u_contrast, overlayCfg.contrast);
    uniform1f(gl, state.uniforms.u_saturation, overlayCfg.saturation);
    uniform1f(gl, state.uniforms.u_temperature, overlayCfg.temperature);
    uniform1f(gl, state.uniforms.u_hue, overlayCfg.hueShift);
    uniform1f(gl, state.uniforms.u_blackCrush, overlayCfg.blackCrush);
    uniform1f(gl, state.uniforms.u_whiteCrush, overlayCfg.whiteCrush);
    uniform1f(gl, state.uniforms.u_colorCrush, overlayCfg.colorCrush);
    uniform1f(gl, state.uniforms.u_pixelate, overlayCfg.pixelate);
    uniform1f(gl, state.uniforms.u_blur, overlayCfg.blur);
    uniform1f(gl, state.uniforms.u_detail, 0);
    uniform1f(gl, state.uniforms.u_chroma, overlayCfg.chroma);
    uniform1f(gl, state.uniforms.u_halation, 0);
    uniform1f(gl, state.uniforms.u_ghosting, 0);
    uniform1f(gl, state.uniforms.u_lineDamage, 0);
    uniform1f(gl, state.uniforms.u_grain, overlayCfg.grain);
    uniform1f(gl, state.uniforms.u_vignette, overlayCfg.vignette);
    uniform1f(gl, state.uniforms.u_cornerRadius, overlayCfg.cornerRadius);
    uniform1f(gl, state.uniforms.u_animated, filterAnimationEnabled ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.prevTexture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, pixelW, pixelH, 0);
    configureTexture(gl, state.prevTexture);
    state.hasPrev = true;
    state.prevW = pixelW;
    state.prevH = pixelH;

    surface.canvas.style.display = "block";
    surface.canvas.classList.add("ready");
    surface.canvas.classList.remove("videoCanvasStale");
    surface.hasDrawn = true;
    surface.awaitingFreshFrame = false;
    // The live canvas now holds a real frame for the CURRENT target, so drop
    // the retained one in the same tick. Both are fully filtered, so this is a
    // straight cut between two graded frames -- never a dissolve through an
    // ungraded one.
    releaseHoldFrame(surface);
    if (surface.mediaEl) {
      // Hide the source element behind the canvas but LEAVE its CSS appearance
      // in place. Stripping it here was the main blink: the element is opacity:0
      // so the filter costs nothing, yet the moment anything un-hid it again --
      // the next file change, a not-ready draw, a detach -- it painted raw,
      // unfiltered media for a frame or two before the canvas caught up.
      surface.mediaEl.classList.add("mediaHidden");
    }

    if (needsAnim) return true;
    if (isVideo) {
      if (surface.videoFrameActive) return false;
      if (!el.paused) return true;
    }
    return false;
  }

  // Synchronously redraw one surface and return its canvas. The GL context uses
  // preserveDrawingBuffer:false, so its buffer is cleared once the browser
  // composites — a later drawImage() of the canvas (e.g. capturing a transition
  // frame) reads black. Rendering on demand here means the caller can drawImage
  // the result in the SAME JS tick, before the buffer is discarded.
  const renderSurfaceNow = (name) => {
    const surface = surfaces.get(name);
    if (!surface || !surface.active || !surface.mediaEl) return null;
    try { drawSurface(surface, performance.now()); } catch { return null; }
    return surface.hasDrawn && surface.canvas ? surface.canvas : null;
  };

  return {
    attach,
    detach,
    reset,
    requestRender,
    renderSurfaceNow,
    hasSurfaceDrawn: (name) => {
      const surface = surfaces.get(name);
      return !!(surface && surface.hasDrawn);
    },
    // Is the surface showing a real filtered frame of this target -- drawn
    // since it was attached to it, and not the frame held from the last one?
    // The opening zoom (media/open-zoom.js) waits on this.
    isShowingTarget: (name, target) => {
      const surface = surfaces.get(name);
      if (!surface || !surface.active || !surface.hasDrawn) return false;
      if (surface.awaitingFreshFrame || surface.holdActive) return false;
      const t = surface.target;
      return !!t && (t === target || (target && t.id != null && t.id === target.id));
    },
    // The retained filtered frame, as a 2D canvas whose pixels persist. This is
    // the only trustworthy record of what the surface last put on screen.
    holdFrameCanvas: (name) => {
      const surface = surfaces.get(name);
      return surface && surface.holdActive && surface.holdCanvas
        ? surface.holdCanvas
        : null;
    },
    releaseHoldFrame: (name) => {
      const surface = surfaces.get(name);
      if (surface) releaseHoldFrame(surface);
    },
  };
})();
