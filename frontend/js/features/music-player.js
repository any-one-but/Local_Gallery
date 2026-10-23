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

   It lives in the settings menu, as its own section (Music), built like any
   other: a line saying what is playing, with a progress line, then Play or
   Pause, Next song, Previous song, Shuffle, Repeat song and a Songs list to
   pick one from. Walked with the menu's own keys. Music keeps playing when the
   menu closes. musicPlayPause / musicNext / musicPrevious / musicToggleShuffle
   / musicToggleRepeat work from anywhere and ship unbound. Shuffle and Repeat
   are options (musicShuffle, musicRepeat). (It used to be a panel of its own,
   #musicPlayer, opened with M; that went in Checkpoint 0330.) */
const MUSIC_AUDIO_EXT_RE = /\.mp3$/i;
const MUSIC_RESTART_THRESHOLD_S = 3;
const MUSIC = {
  audio: null,
  tracks: [], // { name, title, handle }
  current: null, // track name
  history: [], // names, for Previous with Shuffle on
  objectUrl: "",
  loading: false,
  listed: false, // the folder has been read since the library opened
  failures: 0,
  panicResume: false,
  message: "",
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
  audio.addEventListener("timeupdate", () => renderMusicProgress());
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
    MUSIC.listed = true;
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
  // A new song is announced, unless the Music section is on screen and
  // shows it itself.
  if (changed && !musicMenuIsShowing()) showStatusMessage(`Now playing ${track.title}`);
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
    return;
  }
  if (MUSIC.panicResume) {
    MUSIC.panicResume = false;
    MUSIC.audio.play().catch(() => {});
  }
}

// --- In the settings menu ----------------------------------------------------

function musicMenuIsShowing() {
  return !!document.querySelector("#appActionMenu.open .appMenuMusicNow");
}

function musicTimeLabel(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function musicNowText() {
  const track = MUSIC.current ? MUSIC.tracks[musicTrackIndex(MUSIC.current)] : null;
  if (MUSIC.message) return MUSIC.message;
  if (track) return track.title;
  if (MUSIC.current) return musicTrackTitle(MUSIC.current);
  if (!MUSIC.listed) return "";
  return MUSIC.tracks.length ? "Nothing playing" : musicEmptyMessage();
}

// The progress line and the time, updated in place as the song plays.
function renderMusicProgress() {
  const now = document.querySelector("#appActionMenu.open .appMenuMusicNow");
  if (!now) return;
  const audio = MUSIC.audio;
  const d = audio ? Number(audio.duration) : 0;
  const t = audio ? Number(audio.currentTime) : 0;
  const known = d > 0 && Number.isFinite(d) && !!MUSIC.current;
  const fill = now.querySelector(".appMenuMusicFill");
  if (fill) fill.style.width = known ? `${Math.min(100, (t / d) * 100)}%` : "0%";
  const time = now.querySelector(".appMenuMusicTime");
  if (time) time.textContent = known ? `${musicTimeLabel(t)} / ${musicTimeLabel(d)}` : "";
}

// Something about the player changed: redraw the Music section if it is on
// screen, keeping the cursor where it is.
function renderMusicPlayer() {
  if (!musicMenuIsShowing() || typeof refreshAppMenuContents !== "function") return;
  refreshAppMenuContents(captureNumberedMenuKeyState(appActionMenuEl));
}

function musicMenuRow(label, stateKey, run, on = null) {
  const btn = appMenuChoiceButton(label, run, on);
  if (btn) btn.dataset.menuStateKey = stateKey;
  return btn;
}

function buildAppMenuMusicSubmenu() {
  // The folder is read the first time the section is built, and then again
  // whenever a song ends or one is picked, so new files simply appear.
  if (WS.root && !MUSIC.listed && !MUSIC.loading) {
    musicLoadTracks().then(() => renderMusicPlayer());
  }
  const now = document.createElement("div");
  now.className = "appMenuMusicNow";
  now.innerHTML =
    `<div class="appMenuMusicTitle"></div>` +
    `<div class="appMenuMusicBar"><div class="appMenuMusicFill"></div></div>` +
    `<div class="appMenuMusicTime"></div>`;
  const text = musicNowText();
  now.querySelector(".appMenuMusicTitle").textContent = text || "\u00a0";
  now.classList.toggle("appMenuMusicQuiet", !MUSIC.current);
  const playing = musicIsPlaying();
  const rows = [
    now,
    musicMenuRow(playing ? "Pause" : "Play", "music:play", () => musicTogglePlay()),
    musicMenuRow("Next song", "music:next", () => musicNext()),
    musicMenuRow("Previous song", "music:previous", () => musicPrevious()),
    musicMenuRow("Shuffle", "music:shuffle", () => musicToggleOption("musicShuffle", "Shuffle"), musicShuffleEnabled()),
    musicMenuRow("Repeat song", "music:repeat", () => musicToggleOption("musicRepeat", "Repeat song"), musicRepeatEnabled()),
  ];
  if (MUSIC.tracks.length) {
    rows.push(
      createDropdownMenuSubmenu(
        "Songs",
        MUSIC.tracks.map((track) =>
          appMenuChoiceButton(
            track.title,
            () => musicPlayTrack(track),
            track.name === MUSIC.current,
          ),
        ),
        "",
      ),
    );
  }
  const submenu = createDropdownMenuSubmenu("Music", rows.filter(Boolean), "");
  // The time is filled in once the section is on screen.
  queueMicrotask(renderMusicProgress);
  return submenu;
}

function handleMusicKeybindAction(action) {
  switch (action) {
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
