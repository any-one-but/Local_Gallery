/* Music player
   The mp3 player for __LOCAL_GALLERY_MUSIC__. */

/* =========================================================
       Music player
       =========================================================

   A deliberately small player for mp3 files the user drops into
   <library>/__LOCAL_GALLERY_MUSIC__ (INTERNAL_MUSIC_DIR_NAME). That folder is
   skipped by every library scan, so it never appears anywhere in the app and
   there is no way to reveal it -- unlike the Trash.

   What it is: a song name, previous / play-pause / next, and two toggles
   (Shuffle, Repeat song). No artwork, artists, playlists or library of its
   own: the folder, sorted by name, is the list, and it is re-read whenever the
   panel opens or a song ends, so new files simply show up.

   It never plays on its own: nothing starts until the user presses play, which
   starts the first song (or a random one with Shuffle on). It plays through its
   own detached Audio element, so video sound and music play together and
   nothing that pauses or mutes <video> elements touches it. Panic pauses it
   (and resumes it afterwards); Lock now stops it.

   The panel (#musicPlayer) is its own surface, laid out like a player rather
   than a list, and keyboard-driven like the menus: while it is open it takes
   the keyboard (capture listener on window). The user's own movement keys move
   between the buttons, the enter / select-menu key presses one, Space is
   play/pause, and the exit key, Escape or the player key closes it. Music keeps
   playing when it is closed. toggleMusicPlayer opens it (M by default);
   musicPlayPause / musicNext / musicPrevious / musicToggleShuffle /
   musicToggleRepeat work from anywhere and ship unbound. Shuffle and Repeat are options (musicShuffle, musicRepeat). */
const MUSIC_AUDIO_EXT_RE = /\.mp3$/i;
const MUSIC_RESTART_THRESHOLD_S = 3;
const MUSIC = {
  audio: null,
  tracks: [], // { name, title, handle }
  current: null, // track name
  history: [], // names, for Previous with Shuffle on
  objectUrl: "",
  open: false,
  focus: { row: 0, col: 1 }, // play button
  loading: false,
  failures: 0,
  panicResume: false,
  message: "",
  el: null,
};

function musicShuffleEnabled() {
  return !!(WS.meta && WS.meta.options && WS.meta.options.musicShuffle);
}

function musicRepeatEnabled() {
  return !!(WS.meta && WS.meta.options && WS.meta.options.musicRepeat);
}

function musicAudio() {
  if (MUSIC.audio) return MUSIC.audio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = appVolumeFactor();
  audio.addEventListener("ended", () => {
    musicOnEnded();
  });
  audio.addEventListener("error", () => {
    if (!MUSIC.current) return;
    // A file that will not play is skipped, but never in a loop over a
    // folder where nothing plays.
    MUSIC.failures++;
    if (MUSIC.failures >= Math.max(1, MUSIC.tracks.length)) {
      MUSIC.failures = 0;
      MUSIC.message = "These files can't be played.";
      renderMusicPlayer();
      return;
    }
    musicNext();
  });
  audio.addEventListener("playing", () => {
    MUSIC.failures = 0;
  });
  for (const type of ["play", "pause", "loadedmetadata"]) {
    audio.addEventListener(type, () => renderMusicPlayer());
  }
  audio.addEventListener("timeupdate", () => {
    if (MUSIC.open) renderMusicProgress();
  });
  MUSIC.audio = audio;
  return audio;
}

function musicIsPlaying() {
  return !!(MUSIC.audio && !MUSIC.audio.paused && !MUSIC.audio.ended);
}

function musicTrackTitle(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

async function musicFolderHandle({ create = true } = {}) {
  const root = WS.meta && WS.meta.fsRootHandle;
  if (!root || typeof root.getDirectoryHandle !== "function") return null;
  try {
    return await root.getDirectoryHandle(INTERNAL_MUSIC_DIR_NAME, { create });
  } catch {
    return null;
  }
}

// Re-read the folder. The playing song keeps its place when it is still there.
async function musicLoadTracks() {
  if (MUSIC.loading) return MUSIC.tracks;
  MUSIC.loading = true;
  try {
    const dir = await musicFolderHandle();
    if (!dir) {
      MUSIC.tracks = [];
      return MUSIC.tracks;
    }
    const tracks = [];
    for await (const [name, handle] of dir.entries()) {
      if (!handle || handle.kind !== "file") continue;
      if (name.startsWith(".") || !MUSIC_AUDIO_EXT_RE.test(name)) continue;
      tracks.push({ name, title: musicTrackTitle(name), handle });
    }
    tracks.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
    MUSIC.tracks = tracks;
    return tracks;
  } finally {
    MUSIC.loading = false;
  }
}

function musicTrackIndex(name) {
  return MUSIC.tracks.findIndex((t) => t.name === name);
}

async function musicSourceUrl(track) {
  const file = await track.handle.getFile();
  const nativePath = file && typeof file.path === "string" ? file.path : "";
  const lg = window.__lg || null;
  // The desktop app streams from its loopback server (or its media protocol);
  // a browser plays the File itself.
  if (nativePath && lg) {
    if (typeof lg.videoUrl === "function") return lg.videoUrl(nativePath);
    if (typeof lg.assetUrl === "function") return lg.assetUrl(nativePath);
  }
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    if (MUSIC.objectUrl) {
      try {
        URL.revokeObjectURL(MUSIC.objectUrl);
      } catch {}
    }
    MUSIC.objectUrl = URL.createObjectURL(file);
    return MUSIC.objectUrl;
  }
  return "";
}

async function musicPlayTrack(track, { pushHistory = true } = {}) {
  if (!track) return false;
  const audio = musicAudio();
  let src = "";
  try {
    src = await musicSourceUrl(track);
  } catch {}
  if (!src) {
    MUSIC.message = `Couldn't open ${track.title}.`;
    renderMusicPlayer();
    return false;
  }
  if (pushHistory && MUSIC.current && MUSIC.current !== track.name) {
    MUSIC.history.push(MUSIC.current);
    if (MUSIC.history.length > 200) MUSIC.history.shift();
  }
  const changed = MUSIC.current !== track.name;
  MUSIC.current = track.name;
  MUSIC.message = "";
  audio.src = src;
  try {
    await audio.play();
  } catch {}
  renderMusicPlayer();
  // With the player closed, a new song is announced (the panel shows it
  // itself when open).
  if (changed && !MUSIC.open) showStatusMessage(`Now playing ${track.title}`);
  return true;
}

function musicRandomTrack(excludeName) {
  const pool = MUSIC.tracks.filter((t) => t.name !== excludeName);
  const list = pool.length ? pool : MUSIC.tracks;
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

function musicEmptyMessage() {
  return `Add mp3 files to Local Gallery/${INTERNAL_MUSIC_DIR_NAME}`;
}

async function musicTogglePlay() {
  if (!WS.root) {
    MUSIC.message = "Open your library first.";
    renderMusicPlayer();
    return false;
  }
  const audio = musicAudio();
  if (MUSIC.current && audio.src) {
    if (audio.paused) {
      try {
        await audio.play();
      } catch {}
    } else {
      audio.pause();
    }
    renderMusicPlayer();
    return true;
  }
  await musicLoadTracks();
  if (!MUSIC.tracks.length) {
    MUSIC.message = musicEmptyMessage();
    renderMusicPlayer();
    return false;
  }
  const first = musicShuffleEnabled() ? musicRandomTrack("") : MUSIC.tracks[0];
  return musicPlayTrack(first, { pushHistory: false });
}

async function musicNext() {
  await musicLoadTracks();
  if (!MUSIC.tracks.length) {
    MUSIC.message = musicEmptyMessage();
    renderMusicPlayer();
    return false;
  }
  let track;
  if (musicShuffleEnabled()) {
    track = musicRandomTrack(MUSIC.current);
  } else {
    const i = musicTrackIndex(MUSIC.current);
    track = MUSIC.tracks[(i + 1) % MUSIC.tracks.length];
  }
  return musicPlayTrack(track);
}

async function musicPrevious() {
  const audio = musicAudio();
  // Past the first few seconds, Previous means "from the top", as on any player.
  if (MUSIC.current && audio.currentTime > MUSIC_RESTART_THRESHOLD_S) {
    audio.currentTime = 0;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {}
    }
    return true;
  }
  await musicLoadTracks();
  if (!MUSIC.tracks.length) {
    MUSIC.message = musicEmptyMessage();
    renderMusicPlayer();
    return false;
  }
  if (musicShuffleEnabled()) {
    while (MUSIC.history.length) {
      const name = MUSIC.history.pop();
      const track = MUSIC.tracks[musicTrackIndex(name)];
      if (track) return musicPlayTrack(track, { pushHistory: false });
    }
  }
  const i = musicTrackIndex(MUSIC.current);
  const n = MUSIC.tracks.length;
  const track = MUSIC.tracks[i < 0 ? n - 1 : (i - 1 + n) % n];
  return musicPlayTrack(track, { pushHistory: false });
}

async function musicOnEnded() {
  const audio = musicAudio();
  if (musicRepeatEnabled() && MUSIC.current) {
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch {}
    return;
  }
  await musicNext();
}

function musicToggleOption(key, label) {
  const next = toggleOptionValue(key);
  metaScheduleSave();
  showStatusMessage(`${label} ${next ? "on" : "off"}.`);
  renderMusicPlayer();
  return true;
}

function musicStop() {
  if (!MUSIC.audio) return;
  try {
    MUSIC.audio.pause();
  } catch {}
  MUSIC.audio.removeAttribute("src");
  try {
    MUSIC.audio.load();
  } catch {}
  MUSIC.current = null;
  MUSIC.history = [];
  if (MUSIC.objectUrl) {
    try {
      URL.revokeObjectURL(MUSIC.objectUrl);
    } catch {}
    MUSIC.objectUrl = "";
  }
  renderMusicPlayer();
}

function musicOnPanic(active) {
  if (!MUSIC.audio) return;
  if (active) {
    MUSIC.panicResume = musicIsPlaying();
    try {
      MUSIC.audio.pause();
    } catch {}
    if (MUSIC.open) closeMusicPlayer();
    return;
  }
  if (MUSIC.panicResume) {
    MUSIC.panicResume = false;
    MUSIC.audio.play().catch(() => {});
  }
}

// --- The panel ---------------------------------------------------------------

// Two rows: the transport (previous, play, next) and the toggles.
const MUSIC_CONTROLS = [
  ["previous", "play", "next"],
  ["shuffle", "repeat"],
];

function musicPlayerEl() {
  if (MUSIC.el) return MUSIC.el;
  const el = document.createElement("div");
  el.id = "musicPlayer";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Music");
  el.innerHTML = `
    <div class="mpTitle"></div>
    <div class="mpProgress"><div class="mpProgressFill"></div></div>
    <div class="mpTransport">
      <span class="mpButton mpSide" data-control="previous">${appIconHtml("luSkipBack")}</span>
      <span class="mpButton mpPlay" data-control="play"></span>
      <span class="mpButton mpSide" data-control="next">${appIconHtml("luSkipForward")}</span>
    </div>
    <div class="mpToggles">
      <span class="mpButton mpToggle" data-control="shuffle">${appIconHtml("luShuffle")}<span>Shuffle</span></span>
      <span class="mpButton mpToggle" data-control="repeat">${appIconHtml("luRepeat1")}<span>Repeat</span></span>
    </div>`;
  document.body.appendChild(el);
  MUSIC.el = el;
  return el;
}

function renderMusicProgress() {
  const el = MUSIC.el;
  const audio = MUSIC.audio;
  if (!el) return;
  const fill = el.querySelector(".mpProgressFill");
  if (!fill) return;
  const d = audio ? Number(audio.duration) : 0;
  const t = audio ? Number(audio.currentTime) : 0;
  fill.style.width = d > 0 && Number.isFinite(d) ? `${Math.min(100, (t / d) * 100)}%` : "0%";
}

function renderMusicPlayer() {
  if (!MUSIC.el) return;
  const el = MUSIC.el;
  const track = MUSIC.current ? MUSIC.tracks[musicTrackIndex(MUSIC.current)] : null;
  const title = el.querySelector(".mpTitle");
  const text =
    MUSIC.message ||
    (track ? track.title : MUSIC.current ? musicTrackTitle(MUSIC.current) : "");
  title.textContent = text || (MUSIC.tracks.length ? "Press play" : musicEmptyMessage());
  title.classList.toggle("mpTitleQuiet", !track && !MUSIC.current);
  const play = el.querySelector('[data-control="play"]');
  const playing = musicIsPlaying();
  play.innerHTML = appIconHtml(playing ? "luPause" : "luPlay");
  play.setAttribute("aria-label", playing ? "Pause" : "Play");
  el.querySelector('[data-control="shuffle"]').classList.toggle("mpOn", musicShuffleEnabled());
  el.querySelector('[data-control="repeat"]').classList.toggle("mpOn", musicRepeatEnabled());
  const focused = MUSIC_CONTROLS[MUSIC.focus.row]?.[MUSIC.focus.col];
  el.querySelectorAll(".mpButton").forEach((b) => {
    b.classList.toggle("mpFocus", b.dataset.control === focused);
  });
  renderMusicProgress();
}

async function openMusicPlayer() {
  if (MUSIC.open) return true;
  try {
    allowMenuClose();
    closeActionMenus();
  } catch {}
  const el = musicPlayerEl();
  MUSIC.open = true;
  MUSIC.focus = { row: 0, col: 1 };
  if (!MUSIC.current) MUSIC.message = "";
  renderMusicPlayer();
  el.classList.add("mpOpen");
  if (WS.root) {
    await musicLoadTracks();
    renderMusicPlayer();
  }
  return true;
}

function closeMusicPlayer() {
  if (!MUSIC.open) return false;
  MUSIC.open = false;
  if (MUSIC.el) MUSIC.el.classList.remove("mpOpen");
  return true;
}

function toggleMusicPlayer() {
  if (MUSIC.open) {
    closeMusicPlayer();
    return true;
  }
  openMusicPlayer();
  return true;
}

function musicMoveFocus(dRow, dCol) {
  let { row, col } = MUSIC.focus;
  if (dRow) {
    const nextRow = Math.max(0, Math.min(MUSIC_CONTROLS.length - 1, row + dRow));
    if (nextRow !== row) {
      // Down lands on the first toggle; up lands back on play.
      col = nextRow === 0 ? 1 : 0;
      row = nextRow;
    }
  }
  if (dCol) {
    col = Math.max(0, Math.min(MUSIC_CONTROLS[row].length - 1, col + dCol));
  }
  MUSIC.focus = { row, col };
  renderMusicPlayer();
}

function musicActivateFocused() {
  switch (MUSIC_CONTROLS[MUSIC.focus.row]?.[MUSIC.focus.col]) {
    case "previous":
      musicPrevious();
      return;
    case "play":
      musicTogglePlay();
      return;
    case "next":
      musicNext();
      return;
    case "shuffle":
      musicToggleOption("musicShuffle", "Shuffle");
      return;
    case "repeat":
      musicToggleOption("musicRepeat", "Repeat song");
      return;
  }
}

function handleMusicKeybindAction(action) {
  switch (action) {
    case "toggleMusicPlayer":
      return toggleMusicPlayer();
    case "musicPlayPause":
      musicTogglePlay();
      return true;
    case "musicNext":
      musicNext();
      return true;
    case "musicPrevious":
      musicPrevious();
      return true;
    case "musicToggleShuffle":
      return musicToggleOption("musicShuffle", "Shuffle");
    case "musicToggleRepeat":
      return musicToggleOption("musicRepeat", "Repeat song");
    default:
      return false;
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!MUSIC.open) return;
    if (typeof lockScreenIsOpen === "function" && lockScreenIsOpen()) return;
    if (isTextInputTarget(e.target)) return;
    const key = keybindValueFromEvent(e);
    const action = key ? keybindActionFor(key) : null;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === "Escape") {
      stop();
      closeMusicPlayer();
      return;
    }
    if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      stop();
      if (!e.repeat) musicTogglePlay();
      return;
    }
    switch (action) {
      case "selectLeft":
        stop();
        musicMoveFocus(0, -1);
        return;
      case "selectRight":
        stop();
        musicMoveFocus(0, 1);
        return;
      case "selectUp":
        stop();
        musicMoveFocus(-1, 0);
        return;
      case "selectDown":
        stop();
        musicMoveFocus(1, 0);
        return;
      case "enterDir":
      case "openAppMenu":
        stop();
        if (!e.repeat) musicActivateFocused();
        return;
      case "leaveDir":
      case "back":
      case "toggleMusicPlayer":
        stop();
        closeMusicPlayer();
        return;
      case "musicPlayPause":
      case "musicNext":
      case "musicPrevious":
      case "musicToggleShuffle":
      case "musicToggleRepeat":
        stop();
        if (!e.repeat) handleMusicKeybindAction(action);
        return;
      case "volumeUp":
      case "volumeDown":
        stop();
        stepAppVolume(action === "volumeUp" ? 1 : -1);
        return;
    }
    // Everything else stays out of the library while the player is up;
    // browser shortcuts with Cmd/Ctrl still reach the browser.
    if (action || !(e.metaKey || e.ctrlKey)) stop();
  },
  true,
);
