/* Metadata documents
   The list of .local-gallery log files and which preference section each
   option is saved in. */

const META_DOC_IDS = Object.freeze({
  scores: "scores",
  scoreHistory: "scoreHistory",
  dailyJournals: "dailyJournals",
  tags: "tags",
  tagAlbums: "tagAlbums",
  trash: "trash",
  thumbnails: "thumbnails",
  aspectRatios: "aspectRatios",
  appearancePresets: "appearancePresets",
  appearanceAssignments: "appearanceAssignments",
  prefGeneral: "prefGeneral",
  prefNotifications: "prefNotifications",
  prefAppearance: "prefAppearance",
  prefPlayback: "prefPlayback",
  prefThumbnails: "prefThumbnails",
  prefFilenames: "prefFilenames",
  prefControls: "prefControls",
  keybinds: "keybinds",
});

const META_DOC_FILE_NAMES = Object.freeze({
  [META_DOC_IDS.scores]: "scores.log.json",
  [META_DOC_IDS.scoreHistory]: "score-history.log.json",
  [META_DOC_IDS.dailyJournals]: "daily-journals.log.json",
  [META_DOC_IDS.tags]: "tags.log.json",
  [META_DOC_IDS.tagAlbums]: "tag-albums.log.json",
  [META_DOC_IDS.trash]: "trash.log.json",
  [META_DOC_IDS.thumbnails]: "custom-thumbnails.log.json",
  [META_DOC_IDS.aspectRatios]: "aspect-ratios.log.json",
  [META_DOC_IDS.appearancePresets]: "appearance-presets.log.json",
  [META_DOC_IDS.appearanceAssignments]: "appearance-assignments.log.json",
  [META_DOC_IDS.prefGeneral]: "preferences.general.log.json",
  [META_DOC_IDS.prefNotifications]: "preferences.notifications.log.json",
  [META_DOC_IDS.prefAppearance]: "preferences.appearance.log.json",
  [META_DOC_IDS.prefPlayback]: "preferences.playback.log.json",
  [META_DOC_IDS.prefThumbnails]: "preferences.thumbnails.log.json",
  [META_DOC_IDS.prefFilenames]: "preferences.filenames.log.json",
  [META_DOC_IDS.prefControls]: "preferences.controls.log.json",
  [META_DOC_IDS.keybinds]: "keyboard-configuration.log.json",
});

const META_DOC_ID_BY_FILE_NAME = (() => {
  const out = new Map();
  Object.keys(META_DOC_FILE_NAMES).forEach((docId) => {
    out.set(META_DOC_FILE_NAMES[docId], docId);
  });
  return out;
})();

const META_LOCAL_KEY_PREFIXES = Object.freeze({
  [META_DOC_IDS.scores]: "LocalGalleryScoresV2",
  [META_DOC_IDS.scoreHistory]: "LocalGalleryScoreHistoryV2",
  [META_DOC_IDS.dailyJournals]: "LocalGalleryDailyJournalsV1",
  [META_DOC_IDS.tags]: "LocalGalleryTagsV2",
  [META_DOC_IDS.tagAlbums]: "LocalGalleryTagAlbumsV2",
  [META_DOC_IDS.trash]: "LocalGalleryTrashV1",
  [META_DOC_IDS.thumbnails]: "LocalGalleryThumbnailsV2",
  [META_DOC_IDS.aspectRatios]: "LocalGalleryAspectRatiosV1",
  [META_DOC_IDS.appearancePresets]: "LocalGalleryAppearancePresetsV2",
  [META_DOC_IDS.appearanceAssignments]: "LocalGalleryAppearanceAssignmentsV2",
  [META_DOC_IDS.prefGeneral]: "LocalGalleryPreferencesGeneralV2",
  [META_DOC_IDS.prefNotifications]: "LocalGalleryPreferencesNotificationsV2",
  [META_DOC_IDS.prefAppearance]: "LocalGalleryPreferencesAppearanceV2",
  [META_DOC_IDS.prefPlayback]: "LocalGalleryPreferencesPlaybackV2",
  [META_DOC_IDS.prefThumbnails]: "LocalGalleryPreferencesThumbnailsV2",
  [META_DOC_IDS.prefFilenames]: "LocalGalleryPreferencesFilenamesV2",
  [META_DOC_IDS.prefControls]: "LocalGalleryPreferencesControlsV2",
  [META_DOC_IDS.keybinds]: "LocalGalleryKeyboard",
});

const META_ALL_DOC_IDS = Object.freeze([
  META_DOC_IDS.scores,
  META_DOC_IDS.scoreHistory,
  META_DOC_IDS.dailyJournals,
  META_DOC_IDS.tags,
  META_DOC_IDS.tagAlbums,
  META_DOC_IDS.trash,
  META_DOC_IDS.thumbnails,
  META_DOC_IDS.aspectRatios,
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

const META_PREFERENCE_SECTION_OPTION_KEYS = Object.freeze({
  notifications: Object.freeze(notificationSourceOptionKeys()),
  appearance: Object.freeze(
    [].concat(APPEARANCE_SLIDER_OPTION_KEYS, [
      "activeAppearancePresetId",
      "animatedMediaFilters",
    ]),
  ),
  playback: Object.freeze([
    "preloadNextMode",
    "slideshowDefault",
    "videoAudio",
    "videoSkipStep",
    "videoEndBehavior",
  ]),
  thumbnails: Object.freeze(
    [
      "clickSelectedRotatingThumbTeleports",
      "previewFileThumbnailTitleSize",
      "previewRootFolderThumbnailTitleSize",
      "previewSubfolderThumbnailTitleSize",
      "previewTagThumbnailTitleSize",
      "mediaThumbnails",
      "thumbnailEdits",
      "defaultThumbnailsOnly",
      "fullResThumbnails",
      "thumbnailStyle",
      "thumbnailScaleCropped",
      "thumbnailScaleAspect",
    ].concat(thumbnailVisibilityOptionKeys()),
  ),
  filenames: Object.freeze([
    "forceTitleCaps",
    "showPositionNumbersInNames",
    "showTagFolderSpacerRow",
    "showSpecialContainerSpacerRow",
    "appTheme",
    "uiTint",
    "uiHighlight",
    "appMenuDistance",
    "appMenuHeight",
    "appMenuPlacement",
    "bubbleTint",
    "showFileNames",
    "hideFileExtensionsInFileNames",
    "hideUnderscoresInFileNames",
    "hideBeforeLastDashInFileNames",
    "hideAfterFirstUnderscoreInFileNames",
  ]),
  controls: Object.freeze([
    "muteMessages",
  ]),
});

const META_PREFERENCE_DOC_BY_OPTION_KEY = (() => {
  const out = new Map();
  const pairs = [
    [
      META_DOC_IDS.prefNotifications,
      META_PREFERENCE_SECTION_OPTION_KEYS.notifications,
    ],
    [
      META_DOC_IDS.prefAppearance,
      META_PREFERENCE_SECTION_OPTION_KEYS.appearance,
    ],
    [META_DOC_IDS.prefPlayback, META_PREFERENCE_SECTION_OPTION_KEYS.playback],
    [
      META_DOC_IDS.prefThumbnails,
      META_PREFERENCE_SECTION_OPTION_KEYS.thumbnails,
    ],
    [META_DOC_IDS.prefFilenames, META_PREFERENCE_SECTION_OPTION_KEYS.filenames],
    [META_DOC_IDS.prefControls, META_PREFERENCE_SECTION_OPTION_KEYS.controls],
  ];
  for (let i = 0; i < pairs.length; i++) {
    const [docId, keys] = pairs[i];
    for (let j = 0; j < keys.length; j++) out.set(String(keys[j] || ""), docId);
  }
  return out;
})();

const META_GENERAL_PREFERENCE_OPTION_KEYS = Object.freeze(
  Object.keys(normalizeOptions(defaultOptions())).filter(
    (key) => !META_PREFERENCE_DOC_BY_OPTION_KEY.has(String(key || "")),
  ),
);

function metaPreferenceDocIdForOptionKey(key) {
  const normalizedKey = String(key || "");
  return (
    META_PREFERENCE_DOC_BY_OPTION_KEY.get(normalizedKey) ||
    META_DOC_IDS.prefGeneral
  );
}

function metaPreferenceDocIdsForOptionKeys(keys) {
  const out = new Set();
  const list = Array.isArray(keys) ? keys : Array.from(keys || []);
  for (let i = 0; i < list.length; i++) {
    out.add(metaPreferenceDocIdForOptionKey(list[i]));
  }
  return Array.from(out);
}
