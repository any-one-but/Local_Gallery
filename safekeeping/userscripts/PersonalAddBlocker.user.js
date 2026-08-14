// ==UserScript==
// @name         PersnalAdBlocker
// @version      3.2.0
// @description  Blocks ads
// @author       normal person
// @match        *://simpcity.cr/*
// @match        *://coomer.st/*
// @match        *://kemono.cr/*
// @match        *://melkormancin.com/
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
.shortcode-home-header

{
    display: none !important;
}
`);