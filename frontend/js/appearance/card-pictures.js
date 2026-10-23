/* Card pictures
   The square that holds a folder card's picture, so a name can sit under it. */

/* ===== Card pictures ===== */

// A folder card's picture is placed inside the card -- and a picture whose
// thumbnail has been zoomed or moved (Cmd+arrows) is absolutely positioned
// larger than the card, kept in bounds only because the card clips it. With
// Folder names on "Under picture" the card cannot clip any more: it is taller
// than the picture, to hold the name underneath, and clipping it would cut
// the name off. So every part of a folder card except its name overlay (and
// a rename field) lives in a `.cardPicture` square, and that square is what
// clips and what the zoomed picture is placed against.
//
// The square is there in both modes. Under "On picture" it is
// `display: contents` -- it draws no box, and everything in it is placed and
// clipped by the card exactly as before. Under "Under picture" it is a real
// square (card-captions.css).
//
// Cards are built by several renderers and their pictures are swapped in
// later by the thumbnail loaders, so rather than each of them knowing about
// the square, one observer moves anything that lands loose in a folder card
// into it. Moving a node within the page in the same task keeps an <img>
// loading and a <video> playing.

const CARD_PICTURE_CARD_SELECTOR =
  ".gridFolders .folderCard.folderThumbCard:not(.previewTagFolderCard)";
const CARD_PICTURE_KEEPS_OUT = ".metaBlock, input, textarea";

function wrapCardPicture(card) {
  if (!card || !card.isConnected) return;
  let picture = null;
  const loose = [];
  for (const child of card.children) {
    if (child.classList.contains("cardPicture")) picture = child;
    else if (!child.matches(CARD_PICTURE_KEEPS_OUT)) loose.push(child);
  }
  if (!loose.length) return;
  if (!picture) {
    picture = document.createElement("div");
    picture.className = "cardPicture";
    card.insertBefore(picture, card.firstChild);
  }
  for (const child of loose) picture.appendChild(child);
}

function wrapCardPicturesIn(node) {
  if (!node || node.nodeType !== 1) return;
  const own = node.closest(CARD_PICTURE_CARD_SELECTOR);
  if (own) wrapCardPicture(own);
  if (node.firstElementChild)
    node.querySelectorAll(CARD_PICTURE_CARD_SELECTOR).forEach(wrapCardPicture);
}

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) wrapCardPicturesIn(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
