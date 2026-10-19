/* Item menu parts
   Submenu markup, item info, container sort and media type rows. */

function buildDropdownMenuSubmenuHtml(label, buttonsHtml) {
  if (!buttonsHtml) return "";
  return `
        <div class="dropdownMenuSubmenu">
          <button type="button" class="dropdownMenuSubmenuTrigger" aria-haspopup="menu" aria-expanded="false">
            <span>${escapeHtml(String(label || ""))}</span>
            <span class="dropdownMenuSubmenuCaret" aria-hidden="true">${SUBMENU_CHEVRON_SVG}</span>
          </button>
          <div class="dropdownMenu dropdownMenuSubmenuPanel">
            ${buttonsHtml}
          </div>
        </div>
      `;
}

function buildPaginatedDropdownMenuSubmenuHtml(label, itemHtmlList) {
  const items = Array.isArray(itemHtmlList) ? itemHtmlList.filter(Boolean) : [];
  if (!items.length) return "";
  const panelItems =
    !BUILDING_NAVIGATION_ONLY_ACTION_MENU &&
    items.length > MAX_NUMBERED_ITEM_MENU_OPTIONS
      ? items
          .slice(0, MAX_NUMBERED_ITEM_MENU_OPTIONS - 1)
          .concat(
            buildPaginatedDropdownMenuSubmenuHtml(
              "More...",
              items.slice(MAX_NUMBERED_ITEM_MENU_OPTIONS - 1),
            ),
          )
      : items;
  return buildDropdownMenuSubmenuHtml(label, panelItems.join(""));
}

function itemInfoRowsForTarget(target) {
  const item = target && typeof target === "object" ? target : null;
  if (!item) return [];
  if (item.kind === "dir") {
    const node = item.node || null;
    if (!node) return [];
    const path = String(node.path || "");
    const tags = metaGetUserTags(path);
    return [
      // Info, not display: the full real name, whatever the Display names
      // settings do to it elsewhere. Only the root drops its hiding dot.
      [
        "Name",
        (node === WS.root
          ? rootDisplayFolderName(node.name)
          : String(node.name || "")) || "Root",
      ],
      ["Type", folderItemTypeLabelForNode(node)],
      ["Location", displayPath(path) || "Root"],
      ["Folders", String(getDirectFolderCountForNode(node))],
      ["Files", String(getRecursiveFileCountForNode(node))],
      ["Size", formatBytes(getDirRecursiveSizeBytesForNode(node, new Map()))],
      ["Score", String(metaGetScore(path) || 0)],
      ["Tags", tags.length ? tags.join(", ") : "None"],
    ];
  }
  if (item.kind === "file") {
    const rec = item.record || null;
    if (!rec) return [];
    const modified = Math.max(0, Number(rec.lastModified) || 0);
    return [
      ["Name", String(rec.name || "")],
      ["Type", fileItemTypeLabelForRecord(rec)],
      ["Location", displayRelPath(rec.relPath || rec.dirPath || "") || "Root"],
      ["Size", formatBytes(Math.max(0, Number(rec.size) || 0))],
      ["Modified", modified ? new Date(modified).toLocaleString() : "Unknown"],
    ];
  }
  if (item.kind === "tag") {
    const entry = item.entry || null;
    if (!entry) return [];
    const metrics = getTagEntryAggregateMetrics(entry, new Map());
    const rows = [
      ["Name", String(entry.label || entry.tag || entry.album || entry.gallery || "")],
      ["Type", tagItemTypeLabelForEntry(entry)],
      ["Location", displayPath(entry.originPath || "") || "Root"],
      ["Folders", String(Math.max(0, Number(metrics.folderCount) || 0))],
      ["Files", String(Math.max(0, Number(metrics.fileCount) || 0))],
      ["Size", formatBytes(Math.max(0, Number(metrics.sizeBytes) || 0))],
      ["Score", String(Number(metrics.score) || 0)],
    ];
    if (!entry.special && entry.tag) {
      const parents = tagParentNames(entry.tag);
      rows.push(["Inside", parents.length ? parents.map(tagDisplayName).join(", ") : "None"]);
      rows.push(["Exclusive", tagIsExclusive(entry.tag) ? "Yes" : "No"]);
    }
    return rows;
  }
  return [];
}

function createItemInfoDropdown(target) {
  const rows = itemInfoRowsForTarget(target);
  if (!rows.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "dropdownMenuSubmenu dropdownMenuItemInfo";
  wrap.addEventListener("click", (e) => e.stopPropagation());
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dropdownMenuSubmenuTrigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span>Item Info</span><span class="dropdownMenuSubmenuCaret" aria-hidden="true">${SUBMENU_CHEVRON_SVG}</span>`;
  const panel = document.createElement("div");
  panel.className =
    "dropdownMenu dropdownMenuSubmenuPanel dropdownMenuItemInfoCard";
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "dropdownMenuItemInfoRow";
    const key = document.createElement("span");
    key.className = "dropdownMenuItemInfoLabel";
    key.textContent = String(label || "");
    const shown = document.createElement("span");
    shown.className = "dropdownMenuItemInfoValue";
    shown.textContent = String(value == null ? "" : value);
    row.appendChild(key);
    row.appendChild(shown);
    panel.appendChild(row);
  });
  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

// Inside the app menu's Selected Item submenu, Item Info is always visible as
// a passive header. Moving the already-rendered rows keeps the standalone item
// menu's flyout intact while ensuring keyboard navigation starts at the first
// real action below the header.
function promoteItemInfoDropdownToHeader(menuEl) {
  if (!menuEl) return null;
  const infoDropdown = Array.from(menuEl.children || []).find((child) =>
    child.classList?.contains("dropdownMenuItemInfo"),
  );
  const infoCard = infoDropdown?.querySelector?.(
    ":scope > .dropdownMenuItemInfoCard",
  );
  if (!infoDropdown || !infoCard) return null;

  const header = document.createElement("section");
  header.className = "dropdownMenuItemInfoHeader";
  header.setAttribute("aria-label", "Item Info");

  const title = document.createElement("div");
  title.className = "dropdownMenuItemInfoHeaderTitle";
  title.textContent = "Item Info";
  header.appendChild(title);
  Array.from(infoCard.children || []).forEach((row) => header.appendChild(row));
  infoDropdown.replaceWith(header);
  return header;
}

function buildItemInfoDropdownHtml(target) {
  const rows = itemInfoRowsForTarget(target);
  if (!rows.length) return "";
  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <div class="dropdownMenuItemInfoRow">
          <span class="dropdownMenuItemInfoLabel">${escapeHtml(String(label || ""))}</span>
          <span class="dropdownMenuItemInfoValue">${escapeHtml(String(value == null ? "" : value))}</span>
        </div>`,
    )
    .join("");
  return `
    <div class="dropdownMenuSubmenu dropdownMenuItemInfo">
      <button type="button" class="dropdownMenuSubmenuTrigger" aria-haspopup="dialog" aria-expanded="false">
        <span>Item Info</span>
        <span class="dropdownMenuSubmenuCaret" aria-hidden="true">${SUBMENU_CHEVRON_SVG}</span>
      </button>
      <div class="dropdownMenu dropdownMenuSubmenuPanel dropdownMenuItemInfoCard">
        ${rowsHtml}
      </div>
    </div>`;
}

function containerSortModeForTarget(target) {
  if (!target) return "";
  if (target.kind === "dir")
    return metaGetFolderContainerSortMode(target.node?.path || "");
  if (target.kind === "tag")
    return metaGetTagContainerSortMode(tagThumbnailKeyForEntry(target.entry));
  return "";
}

function setContainerSortModeForTarget(target, mode) {
  if (!target) return false;
  if (target.kind === "dir")
    return metaSetFolderContainerSortMode(target.node?.path || "", mode);
  if (target.kind === "tag")
    return metaSetTagContainerSortMode(
      tagThumbnailKeyForEntry(target.entry),
      mode,
    );
  return false;
}

function applyContainerSortSelection(target, mode) {
  const next = normalizeContainerSortMode(mode);
  const changed = setContainerSortModeForTarget(target, next);
  closeTagContextMenu();
  closeActionMenus();
  if (!changed) return false;
  applyFolderSortModeEverywhere(true);
  showStatusMessage(
    `Container sort: ${next ? dirSortModeLabel(next) : "None"}.`,
  );
  return true;
}

function createContainerSortSubmenu(target) {
  const current = containerSortModeForTarget(target);
  const buttons = containerSortModeOptions().map((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${option.value === current ? "●" : "○"} ${option.label}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyContainerSortSelection(target, option.value);
    });
    return btn;
  });
  return createDropdownMenuSubmenu("Sort", buttons);
}

function createContainerSortCycleButton(target) {
  const current = containerSortModeForTarget(target);
  return createCyclingItemMenuButton(
    "Sort",
    containerSortModeOptions(),
    current,
    (mode) => {
      const next = normalizeContainerSortMode(mode);
      if (!setContainerSortModeForTarget(target, next)) return;
      applyFolderSortModeEverywhere(true);
      showStatusMessage(
        `Container sort: ${next ? dirSortModeLabel(next) : "None"}.`,
      );
    },
  );
}

function buildContainerSortSubmenuHtml(target) {
  const current = containerSortModeForTarget(target);
  const buttonsHtml = containerSortModeOptions()
    .map(
      (option) =>
        `<button type="button" data-action="container-sort:${escapeHtml(option.value || "none")}">${option.value === current ? "●" : "○"} ${escapeHtml(option.label)}</button>`,
    )
    .join("");
  return buildDropdownMenuSubmenuHtml("Sort", buttonsHtml);
}

function folderMediaFilterAxisSelectionForPath(path) {
  return tagMediaFilterAxisSelection(
    metaGetFolderMediaFilter(path),
    TAG_MEDIA_FILTER_MEDIA_TYPES,
  );
}

function folderMediaFilterCycleOptions() {
  return tagMediaFilterAxisCycleOptions(TAG_MEDIA_FILTER_MEDIA_TYPES, "All");
}

function applyFolderMediaFilterSelection(dirNode, onlyType) {
  const path = String(dirNode?.path || "");
  const isRootNode = !!dirNode && dirNode === WS.root;
  if (!dirNode || (!path && !isRootNode)) return false;
  const nextValue = setTagMediaFilterAxis(
    metaGetFolderMediaFilter(path),
    TAG_MEDIA_FILTER_MEDIA_TYPES,
    onlyType || null,
  );
  const changed = metaSetFolderMediaFilter(path, nextValue);
  closeTagContextMenu();
  closeActionMenus();
  if (!changed) return false;
  metaScheduleSave(META_DOC_IDS.tags);
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Folder media type filter: ${onlyType ? `${tagMediaFilterTypeLabel(onlyType)} only` : "all"}.`,
  );
  return true;
}

function createFolderMediaFilterCycleButton(dirNode) {
  const path = String(dirNode?.path || "");
  const isRootNode = !!dirNode && dirNode === WS.root;
  if (!dirNode || (!path && !isRootNode)) return null;
  return createCyclingItemMenuButton(
    "Media type",
    folderMediaFilterCycleOptions(),
    folderMediaFilterAxisSelectionForPath(path),
    (onlyType) => {
      applyFolderMediaFilterSelection(dirNode, onlyType || "");
    },
  );
}

function buildFolderMediaFilterSubmenuHtml(dirNode) {
  const path = String(dirNode?.path || "");
  const isRootNode = !!dirNode && dirNode === WS.root;
  if (!dirNode || (!path && !isRootNode)) return "";
  const current = folderMediaFilterAxisSelectionForPath(path);
  const buttonsHtml = folderMediaFilterCycleOptions()
    .map(
      (option) =>
        `<button type="button" data-action="folder-media-type:${escapeHtml(option.value || "all")}">${option.value === current ? "●" : "○"} ${escapeHtml(option.label)}</button>`,
    )
    .join("");
  return buildDropdownMenuSubmenuHtml("Media type", buttonsHtml);
}

function buildFolderThumbnailSubmenuHtml(options) {
  const cfg = options || {};
  let buttonsHtml = "";
  if (cfg.showUseDefaultThumbnail)
    buttonsHtml += `<button type="button" data-action="thumbnail-default">Default</button>`;
  if (cfg.showSetRandomThumbnail)
    buttonsHtml += `<button type="button" data-action="thumbnail-random">Random</button>`;
  if (cfg.showSetRotateThumbnail)
    buttonsHtml += `<button type="button" data-action="thumbnail-rotate">Shuffle</button>`;
  if (cfg.showSetNoThumbnail)
    buttonsHtml += `<button type="button" data-action="thumbnail-none">Blank</button>`;
  return buildDropdownMenuSubmenuHtml("Thumbnail", buttonsHtml);
}

// Item-menu options keep the menu open by default, so any number of settings
// can be flipped in one visit. Only these close it: they either hand the app to
// an inline text field (which the menu would be competing with for keys), or
// take the item out from under the menu entirely.
const MENU_CLOSING_ITEM_ACTIONS = new Set([
  "rename",
  "rename-file",
  "tag",
  "album",
  "move-to-trash",
  "put-back",
  "remove-from-album",
  "remove-from-tag",
  "send-to-storage",
  "remove-from-storage",
  "empty-trash",
  "edit-thumbnail",
  "loose-set-merge",
  "create-inverse",
  "delete",
]);

function isStickyItemMenuAction(action) {
  const raw = String(action || "");
  if (!raw) return false;
  return !MENU_CLOSING_ITEM_ACTIONS.has(raw);
}

function buildFolderAddToSubmenuHtml(state) {
  if (!state || state.isRootNode || state.isTrashRootPortal) return "";
  const button = (label, action, disabled = false, className = "") =>
    `<button type="button"${className ? ` class="${escapeHtml(className)}"` : ""} data-action="${escapeHtml(action)}"${disabled ? " disabled" : ""}>${escapeHtml(label)}</button>`;
  const containerSubmenu = (label, action, disabled = false) =>
    disabled
      ? button(label, action, true)
      : buildDropdownMenuSubmenuHtml(label, button("Create new", action));
  const restricted = state.isStorageRestricted || state.isTrashItem;
  let items = "";
  items += containerSubmenu("Tag", "tag", restricted);
  items += containerSubmenu("Album", "album", restricted);
  items += containerSubmenu("Gallery", "gallery", restricted);
  if (!state.isFavorite) items += button("Favorites", "favorite", restricted);
  if (!state.isHidden) items += button("Hidden", "hidden", restricted);
  if (!state.canRemoveFromStorage)
    items += button("Storage", "send-to-storage", !state.canSendToStorage);
  return buildDropdownMenuSubmenuHtml("Add To...", items);
}

function buildFolderOverridesSubmenuHtml(target, state) {
  if (!target || !state) return "";
  let items = buildContainerSortSubmenuHtml(target);
  if (!state.isStorageRestricted && !state.isTrashItem) {
    items += `<button type="button" data-action="appearance-preset-set">Filters</button>`;
    items += buildFolderMediaFilterSubmenuHtml(state.dirNode);
  }
  return buildDropdownMenuSubmenuHtml("Overrides", items);
}

function buildFileThumbnailSubmenuHtml(
  thumbnailTargets,
  includeEditThumbnail = true,
) {
  const targets = Array.isArray(thumbnailTargets) ? thumbnailTargets : [];
  const buttonItems = targets
    .map((t) => {
        const label = String(t?.label || "");
        const action = String(t?.action || "");
        if (!label || !action) return "";
        return `<button type="button" data-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
      })
    .filter(Boolean);
  // "Edit thumbnail" (the removed mouse crop-editor window) is no longer offered;
  // thumbnails are edited with the keyboard. Other thumbnail actions remain.
  return buildPaginatedDropdownMenuSubmenuHtml("Thumbnail", buttonItems);
}
