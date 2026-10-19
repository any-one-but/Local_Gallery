/* Settings metadata sync
   Keeping the settings documents in step after a load or change. */

/* Settings runs in a second webview, so its in-memory WS object is distinct
   from the gallery's. Tauri app events keep metadata live in both directions;
   each side also saves received documents so closing either window during the
   normal save debounce cannot lose the last edit. */
const SETTINGS_METADATA_SYNC_EVENT = "local-gallery-metadata-sync";
const SETTINGS_METADATA_SYNC_DOC_IDS = Object.freeze([
  META_DOC_IDS.scores,
  META_DOC_IDS.scoreHistory,
  META_DOC_IDS.dailyJournals,
  META_DOC_IDS.tags,
  META_DOC_IDS.tagAlbums,
  META_DOC_IDS.appearancePresets,
  META_DOC_IDS.appearanceAssignments,
  META_DOC_IDS.prefGeneral,
  META_DOC_IDS.prefNotifications,
  META_DOC_IDS.prefAppearance,
  META_DOC_IDS.prefPlayback,
  META_DOC_IDS.prefThumbnails,
  META_DOC_IDS.prefFilenames,
  META_DOC_IDS.prefControls,
  META_DOC_IDS.keybinds,
]);
const SETTINGS_METADATA_SYNC_SENDER =
  `${IS_SETTINGS_WINDOW ? "settings" : "main"}-${Date.now()}-${Math.random()}`;
let SETTINGS_METADATA_SYNC_READY = false;
let SETTINGS_METADATA_SYNC_APPLYING = false;
let SETTINGS_METADATA_SYNC_PENDING_DOCS = null;
let SETTINGS_METADATA_SYNC_TIMER = 0;
const SETTINGS_METADATA_SYNC_DIRTY_IDS = new Set();

function settingsMetadataSyncDocIds() {
  return SETTINGS_METADATA_SYNC_DOC_IDS.slice();
}

function emitSettingsMetadataSync(payload) {
  const emit = window.__TAURI__?.event?.emit;
  if (typeof emit !== "function") return;
  emit(
    SETTINGS_METADATA_SYNC_EVENT,
    Object.assign({ sender: SETTINGS_METADATA_SYNC_SENDER }, payload || {}),
  ).catch(() => {});
}

function broadcastSettingsMetadataDocuments(docIds = null) {
  if (!SETTINGS_METADATA_SYNC_READY || !WS.meta || !WS.root) return;
  const requested = Array.isArray(docIds) && docIds.length
    ? docIds
    : settingsMetadataSyncDocIds();
  const docs = {};
  for (let i = 0; i < requested.length; i++) {
    const docId = String(requested[i] || "");
    if (!SETTINGS_METADATA_SYNC_DOC_IDS.includes(docId)) continue;
    const log = metaDocObjectForId(docId);
    if (log) docs[docId] = log;
  }
  if (Object.keys(docs).length) {
    emitSettingsMetadataSync({ kind: "documents", docs });
  }
}

function scheduleSettingsMetadataBroadcast(docIds = null) {
  if (
    SETTINGS_METADATA_SYNC_APPLYING ||
    !SETTINGS_METADATA_SYNC_READY ||
    !WS.root
  ) return;
  const ids = Array.isArray(docIds) && docIds.length
    ? docIds
    : settingsMetadataSyncDocIds();
  ids.forEach((docId) => {
    const id = String(docId || "");
    if (SETTINGS_METADATA_SYNC_DOC_IDS.includes(id)) {
      SETTINGS_METADATA_SYNC_DIRTY_IDS.add(id);
    }
  });
  if (SETTINGS_METADATA_SYNC_TIMER) return;
  SETTINGS_METADATA_SYNC_TIMER = setTimeout(() => {
    SETTINGS_METADATA_SYNC_TIMER = 0;
    const pending = Array.from(SETTINGS_METADATA_SYNC_DIRTY_IDS);
    SETTINGS_METADATA_SYNC_DIRTY_IDS.clear();
    broadcastSettingsMetadataDocuments(pending);
  }, 0);
}

function refreshAfterSettingsMetadataSync(docIds) {
  const ids = new Set(docIds || []);
  rebuildKeybindIndex();
  if (IS_SETTINGS_WINDOW) applyLoadedOptionsToDocument();
  else applyOptionsEverywhere(false);
  if (MENU_OPEN) {
    setMenuTab(
      isMenuTabAvailable(MENU_ACTIVE_TAB) ? MENU_ACTIVE_TAB : "controls",
    );
  }
  if (ids.has(META_DOC_IDS.scoreHistory) && MENU_ACTIVE_TAB === "calendar") {
    renderCalendarUi();
  }
  syncButtons();
  syncMetaButtons();
}

function applySettingsMetadataDocuments(docs) {
  if (!docs || typeof docs !== "object" || !WS.root) return;
  const docIds = Object.keys(docs).filter(
    (docId) => SETTINGS_METADATA_SYNC_DOC_IDS.includes(docId),
  );
  if (!docIds.length) return;
  SETTINGS_METADATA_SYNC_APPLYING = true;
  try {
    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i];
      metaApplyDocLogById(docId, docs[docId]);
    }
    metaTrackDirtyDocIds(docIds);
    metaScheduleSave();
    refreshAfterSettingsMetadataSync(docIds);
  } finally {
    SETTINGS_METADATA_SYNC_APPLYING = false;
  }
}

function settingsWorkspaceDidLoad() {
  SETTINGS_METADATA_SYNC_READY = true;
  if (SETTINGS_METADATA_SYNC_PENDING_DOCS) {
    const pending = SETTINGS_METADATA_SYNC_PENDING_DOCS;
    SETTINGS_METADATA_SYNC_PENDING_DOCS = null;
    applySettingsMetadataDocuments(pending);
  }
  emitSettingsMetadataSync({ kind: "request" });
  if (IS_SETTINGS_WINDOW) {
    openMenu(window.__LG_SETTINGS_INITIAL_TAB__ || MENU_LAST_TAB || "controls");
  }
}

async function initializeSettingsMetadataSync() {
  const listen = window.__TAURI__?.event?.listen;
  if (typeof listen !== "function") return;
  try {
    await listen(SETTINGS_METADATA_SYNC_EVENT, (event) => {
      const payload = event && event.payload;
      if (!payload || payload.sender === SETTINGS_METADATA_SYNC_SENDER) return;
      if (payload.kind === "request") {
        broadcastSettingsMetadataDocuments();
        return;
      }
      if (payload.kind !== "documents" || !payload.docs) return;
      if (!SETTINGS_METADATA_SYNC_READY || !WS.root) {
        SETTINGS_METADATA_SYNC_PENDING_DOCS = Object.assign(
          SETTINGS_METADATA_SYNC_PENDING_DOCS || {},
          payload.docs,
        );
        return;
      }
      applySettingsMetadataDocuments(payload.docs);
    });
  } catch {}
}
