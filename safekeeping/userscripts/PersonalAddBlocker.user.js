// ==UserScript==
// @name         PersnalAdBlocker
// @version      3.2.0
// @description  Blocks ads
// @author       normal person
// @match        *://simpcity.cr/*
// @match        *://coomer.st/*
// @match        *://kemono.cr/*
// @include      /^https?:\/\/([^\/]+\.)?bunkr\.[a-z0-9-]+(\/|$)/
// @match        *://melkormancin.com/
// @match        *://www.youtube.com/*
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

/* ───────── CSS ───────── */
/* .— { display: none !important; }  |.  `// @match        *://melkormancin.com/`     --> */

GM_addStyle(`
.ad-container,
.blockitsowereplaceit,
.prm-wrapper,
.p-footer,
.p-header,
.shareButtons-buttons,
.p-breadcrumbs.p-breadcrumbs--bottom,
.blockMessage.blockMessage--none,
.p-description,
.p-navEl-link.nav-bonga,
.p-navEl-link.nav-dfake,
.p-navEl-link.nav-faze,
.p-navEl-link.nav-tpd,
.ts-outstream-video__video,
#announcement-banner,
.ts-im-container,
#footer,
#footer-about,
.ad-container,
.allow-same-origin.allow-popups.allow-forms.allow-scripts.allow-popups-to-escape-sandbox,
.ts-outstream-video__video,
.ts-outstream-video__video_vertical,
#ad-banner,
.leadimage,
.shortcode-home-header,
[id^="__clb-spot"]

{
    display: none !important;
}
`);

/* ───────── YouTube: hide the comments section ───────── */

(function () {
    'use strict';

    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

    const COMMENT_SELECTORS = [
        'ytd-comments',
        '#comments',
    ];

    function hideComments() {
        for (const selector of COMMENT_SELECTORS) {
            document.querySelectorAll(selector).forEach(el => {
                el.style.display = 'none';
            });
        }
    }

    // Run on initial load and whenever the DOM changes (YouTube is an SPA)
    const observer = new MutationObserver(hideComments);
    observer.observe(document.body, { childList: true, subtree: true });

    hideComments();
})();