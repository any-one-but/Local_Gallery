    /* =========================================================
       Core model
       ========================================================= */

    const imgRE = /\.(jpe?g|png|gif|webp|tiff|bmp|avif)$/i;
    const vidRE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
    const indexPrefixRE = /^(\d+)\s-\s/;

    const FAVORITE_TAG = "__favorite__";
    const HIDDEN_TAG = "__hidden__";

    function isImageName(name) { return imgRE.test((name || "").toLowerCase()); }
    function isVideoName(name) { return vidRE.test((name || "").toLowerCase()); }

    function fileKey(file, relPathOverride) {
      const rp = relPathOverride || file.webkitRelativePath || "";
      return (file.name + "::" + file.lastModified + "::" + file.size + "::" + rp);
    }

    function splitIndexPrefix(name) {
      const s = String(name || "");
      const m = s.match(indexPrefixRE);
      if (!m) return { idx: null, clean: s };
      return { idx: parseInt(m[1], 10), clean: s.slice(m[0].length) };
    }

    function toTitleCaps(str) {
      return String(str || "").replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      });
    }

    function displayName(name) {
      const opt = (typeof WS !== "undefined" && WS.meta && WS.meta.options) ? WS.meta.options : null;
      let out = splitIndexPrefix(name).clean;
      out = applyFileNameFilters(out, opt);
      if (opt && opt.hideUnderscoresInNames) out = out.replace(/_/g, " ");
      if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
      return out;
    }

    function splitNameExt(name) {
      const raw = String(name || "");
      const i = raw.lastIndexOf(".");
      if (i <= 0) return { base: raw, ext: "" };
      return { base: raw.slice(0, i), ext: raw.slice(i) };
    }

    function applyFileNameFilters(base, opt) {
      let out = String(base || "");
      if (opt && opt.hideBeforeLastDashInFileNames) {
        const idx = out.lastIndexOf(" - ");
        if (idx >= 0) out = out.slice(idx + 3);
      }
      if (opt && opt.hideAfterFirstUnderscoreInFileNames) {
        const idx = out.indexOf("_");
        if (idx >= 0) out = out.slice(0, idx);
      }
      return out;
    }

    function compareIndexedNames(a, b) {
      const A = splitIndexPrefix(a);
      const B = splitIndexPrefix(b);
      const ai = (A.idx === null || !Number.isFinite(A.idx)) ? Infinity : A.idx;
      const bi = (B.idx === null || !Number.isFinite(B.idx)) ? Infinity : B.idx;
      if (ai !== bi) return ai - bi;
      const ac = (A.clean || "").toLowerCase();
      const bc = (B.clean || "").toLowerCase();
      const c = ac.localeCompare(bc);
      if (c) return c;
      return String(a || "").localeCompare(String(b || ""));
    }

    function displayPath(path) {
      const p = String(path || "");
      try {
        if (typeof WS !== "undefined" && WS.dirByPath && WS.dirByPath.has(p)) {
          const node = WS.dirByPath.get(p);
          if (node) {
            const parts = [];
            let cur = node;
            while (cur) {
              parts.push(dirDisplayName(cur));
              cur = cur.parent;
            }
            parts.reverse();
            return parts.join("/") || "";
          }
        }
      } catch {}
      const parts = p.split("/").filter(Boolean);
      const out = parts.map(seg => displayName(seg));
      return out.join("/") || "";
    }

    function displayRelPath(relPath) {
      const parts = String(relPath || "").split("/").filter(Boolean);
      const out = parts.map(seg => displayName(seg));
      return out.join("/") || "";
    }

    function normalizeFolderNameInput(name) {
      return String(name || "").trim();
    }

    function isValidFolderName(name) {
      if (!name) return false;
      if (name === "." || name === "..") return false;
      if (/[\/\\]/.test(name)) return false;
      return true;
    }

    function isValidFileName(name) {
      if (!name) return false;
      if (name === "." || name === "..") return false;
      if (/[\/\\]/.test(name)) return false;
      return true;
    }

    function remapPathPrefix(oldPrefix, newPrefix, path) {
      const p = String(path || "");
      if (!oldPrefix) return p;
      if (p === oldPrefix) return newPrefix;
      if (p.startsWith(oldPrefix + "/")) return newPrefix + p.slice(oldPrefix.length);
      return p;
    }

    function remapPathSet(src, oldPrefix, newPrefix) {
      const next = new Set();
      for (const p of src || []) next.add(remapPathPrefix(oldPrefix, newPrefix, p));
      return next;
    }

    function remapPathMapKeys(src, oldPrefix, newPrefix) {
      const next = new Map();
      for (const [key, value] of src || []) {
        next.set(remapPathPrefix(oldPrefix, newPrefix, key), value);
      }
      return next;
    }

    function makeDirNode(name, parent) {
      return {
        type: "dir",
        name,
        parent,
        childrenDirs: [],
        childrenFiles: [],
        lastIndex: 0,
        path: ""
      };
    }

    /* =========================================================
       Online profile adapter (PartyGuest parity, no UI)
       ========================================================= */

    const ONLINE_POSTS_PER_PAGE = 50;
    const ONLINE_PAGE_DELAY_MS = 200;
    const REDDIT_POSTS_PER_PAGE = 100;
    const REDDIT_PAGE_DELAY_MS = 250;
    const REDDIT_PROFILE_ORIGIN = "https://www.reddit.com";
    const DEVIANTART_PROFILE_ORIGIN = "https://www.deviantart.com";
    const DEVIANTART_BACKEND_ORIGIN = "https://backend.deviantart.com";
    const DEVIANTART_PAGE_DELAY_MS = 300;
    const REDDIT_API_USER_AGENT = "Mozilla/5.0 (compatible; LocalGallery/1.0)";

    function sleepMs(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isRedditHost(hostname) {
      const host = String(hostname || "").toLowerCase();
      return host === "reddit.com" || host.endsWith(".reddit.com");
    }

    function isDeviantArtHost(hostname) {
      const host = String(hostname || "").toLowerCase();
      return host === "deviantart.com" || host.endsWith(".deviantart.com");
    }

    function normalizeRedditProfileOrigin(originRaw) {
      try {
        const parsed = new URL(String(originRaw || REDDIT_PROFILE_ORIGIN));
        if (isRedditHost(parsed.hostname)) return REDDIT_PROFILE_ORIGIN;
      } catch {}
      return REDDIT_PROFILE_ORIGIN;
    }

    function normalizeDeviantArtProfileOrigin(originRaw) {
      try {
        const parsed = new URL(String(originRaw || DEVIANTART_PROFILE_ORIGIN));
        if (isDeviantArtHost(parsed.hostname)) return DEVIANTART_PROFILE_ORIGIN;
      } catch {}
      return DEVIANTART_PROFILE_ORIGIN;
    }

    function buildOnlineProfileSourceUrl(profile) {
      const source = (profile && profile.sourceUrl) ? String(profile.sourceUrl).trim() : "";
      if (source) return source;
      const service = String(profile && profile.service || "").toLowerCase();
      const userId = encodeURIComponent(String(profile && profile.userId || "").trim());
      const origin = String(profile && profile.origin || "").replace(/\/$/, "");
      if (!userId) return "";
      if (service === "reddit") {
        const base = normalizeRedditProfileOrigin(origin || REDDIT_PROFILE_ORIGIN).replace(/\/$/, "");
        return `${base}/user/${userId}`;
      }
      if (service === "deviantart") {
        const base = normalizeDeviantArtProfileOrigin(origin || DEVIANTART_PROFILE_ORIGIN).replace(/\/$/, "");
        return `${base}/${userId}`;
      }
      if (!origin || !service) return "";
      return `${origin}/${service}/user/${userId}`;
    }

    function decodeHtmlEntities(raw) {
      return String(raw || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'");
    }

    function normalizeOnlineAbsoluteUrl(raw, baseOrigin) {
      let next = decodeHtmlEntities(raw).trim();
      if (!next) return "";
      if (/^\/\//.test(next)) next = "https:" + next;
      try {
        return new URL(next, baseOrigin || "https://example.invalid").toString();
      } catch {
        return "";
      }
    }

    function urlLooksLikeMedia(u) {
      const base = (String(u || "").split("?")[0] || "").toLowerCase();
      if (!base) return false;
      if (imgRE.test(base) || vidRE.test(base)) return true;
      if (/\.gifv$/i.test(base)) return true;
      return false;
    }

    function appendUniqueUrl(target, seen, raw, baseOrigin) {
      let url = normalizeOnlineAbsoluteUrl(raw, baseOrigin);
      if (!url) return;
      if (/\.gifv(\?|$)/i.test(url)) {
        url = url.replace(/\.gifv(?=\?|$)/i, ".mp4");
      }
      if (!urlLooksLikeMedia(url)) return;
      const key = (normalizeOnlineFileUrl(url, baseOrigin) || url).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      target.push(url);
    }

    function collectRedditMediaUrlsFromPost(postData, baseOrigin) {
      const urls = [];
      const seen = new Set();
      const add = (raw) => appendUniqueUrl(urls, seen, raw, baseOrigin);
      const scan = (data) => {
        if (!data || typeof data !== "object") return;

        const rv = (data.secure_media && data.secure_media.reddit_video) || (data.media && data.media.reddit_video) || null;
        if (rv && rv.fallback_url) add(rv.fallback_url);

        const rvPreview = data.preview && data.preview.reddit_video_preview ? data.preview.reddit_video_preview : null;
        if (rvPreview && rvPreview.fallback_url) add(rvPreview.fallback_url);

        if (data.gallery_data && Array.isArray(data.gallery_data.items) && data.media_metadata && typeof data.media_metadata === "object") {
          for (const item of data.gallery_data.items) {
            if (!item || !item.media_id) continue;
            const meta = data.media_metadata[item.media_id];
            if (!meta || typeof meta !== "object") continue;
            if (meta.s && meta.s.u) add(meta.s.u);
            if (meta.s && meta.s.gif) add(meta.s.gif);
            if (meta.s && meta.s.mp4) add(meta.s.mp4);
          }
        }

        if (data.url_overridden_by_dest) add(data.url_overridden_by_dest);
        else if (data.url && data.is_reddit_media_domain) add(data.url);

        if (data.preview && Array.isArray(data.preview.images)) {
          for (const image of data.preview.images) {
            if (!image || typeof image !== "object") continue;
            if (image.source && image.source.url) add(image.source.url);
            if (image.variants && image.variants.gif && image.variants.gif.source && image.variants.gif.source.url) {
              add(image.variants.gif.source.url);
            }
          }
        }
      };

      scan(postData);
      if (!urls.length && postData && Array.isArray(postData.crosspost_parent_list)) {
        for (const item of postData.crosspost_parent_list) {
          scan(item);
          if (urls.length) break;
        }
      }

      return urls;
    }

    function mapRedditListingToPosts(listing, page, userId, baseOrigin) {
      const out = [];
      const children = listing && listing.data && Array.isArray(listing.data.children) ? listing.data.children : [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const data = child && child.data && typeof child.data === "object" ? child.data : null;
        if (!data) continue;
        const mediaUrls = collectRedditMediaUrlsFromPost(data, baseOrigin);
        if (!mediaUrls.length) continue;
        const post = {
          id: data.id != null ? String(data.id) : ("reddit_post_" + String(page) + "_" + String(i + 1)),
          user: data.author || userId,
          service: "reddit",
          title: data.title || "",
          created: data.created_utc,
          created_utc: data.created_utc,
          permalink: data.permalink || "",
          url: data.permalink ? `${baseOrigin}${String(data.permalink)}` : (data.url || ""),
          pgPage: page,
          pgIdxOnPage: i + 1,
          attachments: mediaUrls.map(u => ({ url: u }))
        };
        out.push(post);
      }
      const after = listing && listing.data ? (listing.data.after || null) : null;
      return { posts: out, after };
    }

    async function fetchRedditUserPosts(userId, origin, opts = {}) {
      const posts = [];
      const responses = [];
      const pageSize = Number.isFinite(opts.pageSize) ? Math.max(1, Math.min(100, opts.pageSize)) : REDDIT_POSTS_PER_PAGE;
      const delayMs = Number.isFinite(opts.pageDelayMs) ? opts.pageDelayMs : REDDIT_PAGE_DELAY_MS;
      const fetchFn = (typeof opts.fetch === "function") ? opts.fetch : fetch;
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.fetchUrl === "function")
        ? window.electronAPI
        : null;
      const responseBodyLimit = Number.isFinite(opts.responseBodyLimit) ? Math.max(256, opts.responseBodyLimit) : 18000;
      const base = normalizeRedditProfileOrigin(origin);
      const profileUrl = `${base}/user/${encodeURIComponent(String(userId || "").trim())}`;

      let page = 1;
      let after = null;
      let lastError = null;

      const pushResponse = (entry) => {
        const rawBody = (entry && typeof entry.responseText === "string") ? entry.responseText : "";
        const text = rawBody.length > responseBodyLimit ? rawBody.slice(0, responseBodyLimit) : rawBody;
        responses.push(Object.assign({}, entry, {
          ts: (entry && typeof entry.ts === "number") ? entry.ts : Date.now(),
          responseText: text,
          responseBytes: rawBody.length,
          truncated: rawBody.length > responseBodyLimit
        }));
      };

      while (true) {
        if (typeof opts.progressCb === "function") {
          try { opts.progressCb(page, posts.length); } catch {}
        }

        const afterParam = after ? `&after=${encodeURIComponent(after)}` : "";
        const apiUrl = `${base}/user/${encodeURIComponent(String(userId || "").trim())}/submitted/.json?raw_json=1&limit=${pageSize}${afterParam}`;
        let resp = null;
        try {
          if (electronApi) {
            const res = await electronApi.fetchUrl({
              url: apiUrl,
              headers: {
                Accept: "application/json,text/plain,*/*",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": REDDIT_API_USER_AGENT
              },
              referrer: profileUrl
            });
            const status = (res && typeof res.status === "number") ? res.status : 0;
            const responseText = (res && typeof res.text === "string") ? res.text : "";
            if (!res || !res.ok) {
              if (status > 0) lastError = `http_${status}`;
              else lastError = res && res.error ? String(res.error) : "network_error";
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: false,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
            try {
              resp = JSON.parse(responseText || "");
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: true,
                status,
                error: "",
                parseOk: true,
                responseText
              });
            } catch {
              lastError = "invalid_json";
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: true,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          } else {
            const res = await fetchFn(apiUrl, {
              cache: "no-store",
              headers: {
                Accept: "application/json,text/plain,*/*",
                "X-Requested-With": "XMLHttpRequest"
              },
              referrer: profileUrl,
              referrerPolicy: "no-referrer-when-downgrade"
            });
            let status = 0;
            let responseText = "";
            if (res) {
              if (typeof res.status === "number") status = res.status;
              try { responseText = await res.text(); } catch {}
            }
            if (!res || !res.ok) {
              lastError = status > 0 ? `http_${status}` : "network_error";
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: !!(res && res.ok),
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
            try {
              resp = JSON.parse(responseText || "");
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: true,
                status,
                error: "",
                parseOk: true,
                responseText
              });
            } catch {
              lastError = "invalid_json";
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset: posts.length,
                ok: true,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          }
        } catch {
          lastError = "network_error";
          pushResponse({
            ts: Date.now(),
            source: electronApi ? "electron" : "browser",
            url: apiUrl,
            page,
            offset: posts.length,
            ok: false,
            status: 0,
            error: lastError,
            parseOk: false,
            responseText: ""
          });
          break;
        }

        const mapped = mapRedditListingToPosts(resp, page, userId, base);
        if (Array.isArray(mapped.posts) && mapped.posts.length) {
          for (const post of mapped.posts) posts.push(post);
        }
        after = mapped.after || null;
        if (!after) break;
        page++;
        if (delayMs > 0) await sleepMs(delayMs + Math.floor(Math.random() * 200));
      }

      return { posts, error: lastError, responses };
    }

    const DEVIANTART_RESERVED_ROUTE_HEADS = new Set([
      "",
      "about",
      "account",
      "adopt",
      "artists",
      "browse",
      "core-membership",
      "daily-deviations",
      "download",
      "forum",
      "forums",
      "help",
      "jobs",
      "join",
      "notifications",
      "messages",
      "shop",
      "settings",
      "tag",
      "watch",
      "wishlist"
    ]);

    function parseXmlTagAttributes(attrText) {
      const out = {};
      const src = String(attrText || "");
      const re = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let m = null;
      while ((m = re.exec(src)) !== null) {
        const key = String(m[1] || "").toLowerCase();
        const value = decodeHtmlEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : "");
        if (key) out[key] = value;
      }
      return out;
    }

    function extractRssTagText(xmlChunk, tagName) {
      const src = String(xmlChunk || "");
      const tag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!tag) return "";
      const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = re.exec(src);
      if (!m) return "";
      return decodeHtmlEntities(String(m[1] || "").trim());
    }

    function extractRssNextHref(xmlText, baseOrigin) {
      const src = String(xmlText || "");
      const re = /<atom:link\b([^>]*?)\/?>/gi;
      let m = null;
      while ((m = re.exec(src)) !== null) {
        const attrs = parseXmlTagAttributes(m[1] || "");
        const rel = String(attrs.rel || "").toLowerCase();
        if (rel !== "next") continue;
        const href = String(attrs.href || "").trim();
        if (!href) continue;
        try {
          return new URL(href, baseOrigin || DEVIANTART_BACKEND_ORIGIN).toString();
        } catch {}
      }
      return null;
    }

    function collectDeviantArtMediaUrlsFromItemXml(itemXml, baseOrigin) {
      const urls = [];
      const seen = new Set();
      const add = (raw) => appendUniqueUrl(urls, seen, raw, baseOrigin);
      const xml = String(itemXml || "");

      const mediaContentRe = /<media:content\b([^>]*?)\/?>/gi;
      let m = null;
      while ((m = mediaContentRe.exec(xml)) !== null) {
        const attrs = parseXmlTagAttributes(m[1] || "");
        if (attrs.url) add(attrs.url);
      }

      const enclosureRe = /<enclosure\b([^>]*?)\/?>/gi;
      while ((m = enclosureRe.exec(xml)) !== null) {
        const attrs = parseXmlTagAttributes(m[1] || "");
        if (attrs.url) add(attrs.url);
      }

      if (!urls.length) {
        const desc = extractRssTagText(xml, "description");
        const imgRe = /https?:\/\/[^\s"'<>]+/gi;
        let dm = null;
        while ((dm = imgRe.exec(desc)) !== null) add(dm[0]);
      }

      return urls;
    }

    function mapDeviantArtRssToPosts(xmlText, page, userId, baseOrigin) {
      const src = String(xmlText || "");
      if (!src.trim()) return { posts: [], nextUrl: null, error: "invalid_xml" };

      const channelHead = src.split(/<item\b/i)[0] || src;
      const channelDesc = extractRssTagText(channelHead, "description");
      if (/error generating rss/i.test(channelDesc)) {
        return { posts: [], nextUrl: null, error: "invalid_profile" };
      }

      const posts = [];
      const itemRe = /<item\b[\s\S]*?<\/item>/gi;
      let itemMatch = null;
      let idx = 0;
      while ((itemMatch = itemRe.exec(src)) !== null) {
        idx++;
        const itemXml = itemMatch[0] || "";
        const mediaUrls = collectDeviantArtMediaUrlsFromItemXml(itemXml, baseOrigin);
        if (!mediaUrls.length) continue;

        const link = extractRssTagText(itemXml, "link");
        const guid = extractRssTagText(itemXml, "guid");
        const title = extractRssTagText(itemXml, "title");
        const pubDate = extractRssTagText(itemXml, "pubDate");
        let createdTs = null;
        try {
          const t = Date.parse(pubDate);
          if (Number.isFinite(t)) createdTs = Math.floor(t / 1000);
        } catch {}

        let id = "";
        const idSrc = link || guid;
        const idMatch = /-(\d+)(?:[/?#]|$)/.exec(idSrc);
        if (idMatch && idMatch[1]) id = idMatch[1];
        if (!id && guid) id = guid;
        if (!id && link) id = link;
        if (!id) id = `deviantart_post_${String(page)}_${String(idx)}`;

        posts.push({
          id: String(id),
          user: userId,
          service: "deviantart",
          title: title || "",
          created: createdTs,
          created_utc: createdTs,
          url: link || guid || "",
          permalink: link || guid || "",
          pgPage: page,
          pgIdxOnPage: idx,
          attachments: mediaUrls.map(u => ({ url: u }))
        });
      }

      const nextUrl = extractRssNextHref(src, baseOrigin);
      if (!posts.length && !nextUrl) return { posts: [], nextUrl: null, error: null };
      return { posts, nextUrl, error: null };
    }

    async function fetchDeviantArtUserPosts(userId, origin, opts = {}) {
      const posts = [];
      const responses = [];
      const delayMs = Number.isFinite(opts.pageDelayMs) ? opts.pageDelayMs : DEVIANTART_PAGE_DELAY_MS;
      const fetchFn = (typeof opts.fetch === "function") ? opts.fetch : fetch;
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.fetchUrl === "function")
        ? window.electronAPI
        : null;
      const responseBodyLimit = Number.isFinite(opts.responseBodyLimit) ? Math.max(256, opts.responseBodyLimit) : 18000;
      const maxPages = Number.isFinite(opts.maxPages) ? Math.max(1, Math.min(500, opts.maxPages)) : 200;
      const baseProfile = normalizeDeviantArtProfileOrigin(origin);
      const user = String(userId || "").trim();
      const profileUrl = `${baseProfile.replace(/\/$/, "")}/${encodeURIComponent(user)}`;
      const firstFeedUrl = `${DEVIANTART_BACKEND_ORIGIN}/rss.xml?type=deviation&q=${encodeURIComponent(`gallery:${user}`)}`;

      let page = 1;
      let pageUrl = firstFeedUrl;
      let lastError = null;

      const pushResponse = (entry) => {
        const rawBody = (entry && typeof entry.responseText === "string") ? entry.responseText : "";
        const text = rawBody.length > responseBodyLimit ? rawBody.slice(0, responseBodyLimit) : rawBody;
        responses.push(Object.assign({}, entry, {
          ts: (entry && typeof entry.ts === "number") ? entry.ts : Date.now(),
          responseText: text,
          responseBytes: rawBody.length,
          truncated: rawBody.length > responseBodyLimit
        }));
      };

      while (pageUrl && page <= maxPages) {
        if (typeof opts.progressCb === "function") {
          try { opts.progressCb(page, posts.length); } catch {}
        }

        let responseText = "";
        let status = 0;
        let ok = false;
        let source = electronApi ? "electron" : "browser";
        try {
          if (electronApi) {
            const res = await electronApi.fetchUrl({
              url: pageUrl,
              headers: {
                Accept: "application/xml,text/xml,text/plain,*/*",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": REDDIT_API_USER_AGENT
              },
              referrer: profileUrl
            });
            status = (res && typeof res.status === "number") ? res.status : 0;
            responseText = (res && typeof res.text === "string") ? res.text : "";
            ok = !!(res && res.ok);
            if (!ok) {
              if (status > 0) lastError = `http_${status}`;
              else lastError = res && res.error ? String(res.error) : "network_error";
              pushResponse({
                ts: Date.now(),
                source,
                url: pageUrl,
                page,
                offset: posts.length,
                ok: false,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          } else {
            const res = await fetchFn(pageUrl, {
              cache: "no-store",
              headers: {
                Accept: "application/xml,text/xml,text/plain,*/*",
                "X-Requested-With": "XMLHttpRequest"
              },
              referrer: profileUrl,
              referrerPolicy: "no-referrer-when-downgrade"
            });
            if (res && typeof res.status === "number") status = res.status;
            try { responseText = res ? await res.text() : ""; } catch {}
            ok = !!(res && res.ok);
            if (!ok) {
              lastError = status > 0 ? `http_${status}` : "network_error";
              pushResponse({
                ts: Date.now(),
                source,
                url: pageUrl,
                page,
                offset: posts.length,
                ok: false,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          }
        } catch {
          lastError = "network_error";
          pushResponse({
            ts: Date.now(),
            source,
            url: pageUrl,
            page,
            offset: posts.length,
            ok: false,
            status: 0,
            error: lastError,
            parseOk: false,
            responseText: ""
          });
          break;
        }

        const mapped = mapDeviantArtRssToPosts(responseText, page, user, baseProfile);
        if (mapped.error) {
          lastError = mapped.error;
          pushResponse({
            ts: Date.now(),
            source,
            url: pageUrl,
            page,
            offset: posts.length,
            ok,
            status,
            error: lastError,
            parseOk: false,
            responseText
          });
          break;
        }

        pushResponse({
          ts: Date.now(),
          source,
          url: pageUrl,
          page,
          offset: posts.length,
          ok,
          status,
          error: "",
          parseOk: true,
          responseText
        });

        if (Array.isArray(mapped.posts) && mapped.posts.length) {
          for (const post of mapped.posts) posts.push(post);
        }

        if (!mapped.nextUrl) break;
        pageUrl = mapped.nextUrl;
        page++;
        if (delayMs > 0) await sleepMs(delayMs + Math.floor(Math.random() * 220));
      }

      return { posts, error: lastError, responses };
    }

    function parseOnlineProfileUrl(rawUrl) {
      let raw = String(rawUrl || "").trim();
      if (!raw) return { ok: false, error: "invalid-url" };
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        raw = "https://" + raw;
      }
      let url = null;
      try { url = new URL(raw); } catch { return { ok: false, error: "invalid-url" }; }
      if (isDeviantArtHost(url.hostname)) {
        let userId = "";
        const host = String(url.hostname || "").toLowerCase();
        if (host.endsWith(".deviantart.com") && host !== "www.deviantart.com" && host !== "deviantart.com" && host !== "backend.deviantart.com") {
          const sub = host.slice(0, -".deviantart.com".length);
          if (sub && !sub.includes(".")) userId = decodeURIComponent(sub).trim();
        }
        if (!userId) {
          const qRaw = String(url.searchParams.get("q") || "").trim();
          const qMatch = /^gallery:(.+)$/i.exec(qRaw);
          if (qMatch && qMatch[1]) userId = String(qMatch[1]).trim();
        }
        if (!userId && host !== "backend.deviantart.com") {
          const parts = (url.pathname || "").split("/").filter(Boolean);
          if (parts.length) {
            const first = decodeURIComponent(parts[0] || "").replace(/^@+/, "").trim();
            if (first && !DEVIANTART_RESERVED_ROUTE_HEADS.has(first.toLowerCase())) userId = first;
          }
        }
        if (!userId) return { ok: false, error: "invalid-profile-path" };
        const origin = DEVIANTART_PROFILE_ORIGIN;
        return {
          ok: true,
          origin,
          service: "deviantart",
          userId,
          profileKey: "deviantart::" + userId,
          dataRoot: origin.replace(/\/$/, "") + "/data"
        };
      }
      if (isRedditHost(url.hostname)) {
        const parts = (url.pathname || "").split("/").filter(Boolean);
        const head = String(parts[0] || "").toLowerCase();
        if ((head === "user" || head === "u") && parts.length >= 2) {
          const userId = decodeURIComponent(parts[1] || "").trim();
          if (!userId) return { ok: false, error: "invalid-profile-path" };
          const origin = REDDIT_PROFILE_ORIGIN;
          return {
            ok: true,
            origin,
            service: "reddit",
            userId,
            profileKey: "reddit::" + userId,
            dataRoot: origin.replace(/\/$/, "") + "/data"
          };
        }
        return { ok: false, error: "invalid-profile-path" };
      }
      const parts = (url.pathname || "").split("/").filter(Boolean);
      if (parts.length < 3 || parts[1] !== "user") {
        return { ok: false, error: "invalid-profile-path" };
      }
      const service = decodeURIComponent(parts[0] || "").trim();
      const userId = decodeURIComponent(parts[2] || "").trim();
      if (!service || !userId) return { ok: false, error: "invalid-profile-path" };
      const origin = url.origin;
      return {
        ok: true,
        origin,
        service,
        userId,
        profileKey: service + "::" + userId,
        dataRoot: origin.replace(/\/$/, "") + "/data"
      };
    }

    function resolveOnlineFileUrl(obj, dataRoot) {
      if (!obj) return null;
      if (obj.path) {
        if (String(obj.path).startsWith("http")) return obj.path;
        const p = obj.path.startsWith("/") ? obj.path : ("/" + obj.path);
        const base = String(dataRoot || "").replace(/\/$/, "");
        return base ? (base + p) : p;
      }
      if (obj.url && String(obj.url).startsWith("http")) return obj.url;
      return null;
    }

    function normalizeOnlineFileUrl(u, baseOrigin) {
      if (!u) return "";
      try {
        const url = new URL(u, baseOrigin || "https://example.invalid");
        let path = url.pathname || "";
        const idx = path.indexOf("/data/");
        if (idx >= 0) path = path.slice(idx);
        return path.toLowerCase();
      } catch {
        return (String(u).split("?")[0] || "").toLowerCase();
      }
    }

    function buildPgFilesForPosts(posts, opts = {}) {
      if (!Array.isArray(posts) || !posts.length) return { totalFiles: 0 };
      const origin = String(opts.origin || "");
      const dataRoot = String(opts.dataRoot || (origin ? origin.replace(/\/$/, "") + "/data" : ""));
      const perPostFiles = [];
      let totalFiles = 0;

      for (const meta of posts) {
        const refs = [];
        const addRef = (o) => {
          const u = resolveOnlineFileUrl(o, dataRoot);
          if (u) refs.push(u);
        };

        if (Array.isArray(meta.pgFiles) && meta.pgFiles.length) {
          for (const f of meta.pgFiles) {
            const u = (f && f.url) ? f.url : resolveOnlineFileUrl(f, dataRoot);
            if (u) refs.push(u);
          }
        } else {
          if (meta.file) addRef(meta.file);
          if (Array.isArray(meta.attachments)) meta.attachments.forEach(addRef);
        }

        const seen = new Set();
        const files = [];
        for (const ref of refs) {
          const base = (String(ref).split("?")[0] || "");
          const isImg = imgRE.test(base);
          const isVid = vidRE.test(base);
          if (!isImg && !isVid) continue;
          const key = normalizeOnlineFileUrl(ref, origin);
          if (seen.has(key)) continue;
          seen.add(key);
          files.push({ url: ref, isVid });
        }
        perPostFiles.push(files);
        totalFiles += files.length;
      }

      let g = totalFiles;
      for (let i = 0; i < posts.length; i++) {
        const meta = posts[i];
        const files = perPostFiles[i] || [];
        const pgFiles = [];
        let local = 1;
        for (const f of files) {
          pgFiles.push({ g, local, url: f.url, isVid: !!f.isVid });
          g--;
          local++;
        }
        meta.pgFiles = pgFiles;
      }

      return { totalFiles };
    }

    async function fetchOnlineProfilePosts(service, userId, origin, opts = {}) {
      if (String(service || "").toLowerCase() === "deviantart") {
        return fetchDeviantArtUserPosts(userId, origin, opts);
      }
      if (String(service || "").toLowerCase() === "reddit") {
        return fetchRedditUserPosts(userId, origin, opts);
      }
      const posts = [];
      const responses = [];
      const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : ONLINE_POSTS_PER_PAGE;
      const delayMs = Number.isFinite(opts.pageDelayMs) ? opts.pageDelayMs : ONLINE_PAGE_DELAY_MS;
      const fetchFn = (typeof opts.fetch === "function") ? opts.fetch : fetch;
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.fetchUrl === "function")
        ? window.electronAPI
        : null;
      const responseBodyLimit = Number.isFinite(opts.responseBodyLimit) ? Math.max(256, opts.responseBodyLimit) : 18000;
      let page = 1;
      let lastError = null;

      const pushResponse = (entry) => {
        const rawBody = (entry && typeof entry.responseText === "string") ? entry.responseText : "";
        const text = rawBody.length > responseBodyLimit ? rawBody.slice(0, responseBodyLimit) : rawBody;
        responses.push(Object.assign({}, entry, {
          ts: (entry && typeof entry.ts === "number") ? entry.ts : Date.now(),
          responseText: text,
          responseBytes: rawBody.length,
          truncated: rawBody.length > responseBodyLimit
        }));
      };

      while (true) {
        if (typeof opts.progressCb === "function") {
          try { opts.progressCb(page, posts.length); } catch {}
        }

        const offset = (page - 1) * pageSize;
        const base = String(origin || "").replace(/\/$/, "");
        const apiUrl = `${base}/api/v1/${service}/user/${userId}/posts?o=${offset}`;
        let resp = null;
        try {
          if (electronApi) {
            const res = await electronApi.fetchUrl({
              url: apiUrl,
              headers: {
                Accept: "text/css",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": navigator.userAgent
              },
              referrer: `${base}/${service}/user/${userId}`
            });
            const status = (res && typeof res.status === "number") ? res.status : 0;
            const responseText = (res && typeof res.text === "string") ? res.text : "";
            if (!res || !res.ok) {
              if (res && typeof res.status === "number" && res.status > 0) lastError = `http_${res.status}`;
              else lastError = res && res.error ? res.error : "network_error";
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset,
                ok: false,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
            try {
              resp = JSON.parse(responseText || "");
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset,
                ok: true,
                status,
                error: "",
                parseOk: true,
                responseText
              });
            } catch {
              lastError = "invalid_json";
              pushResponse({
                ts: Date.now(),
                source: "electron",
                url: apiUrl,
                page,
                offset,
                ok: true,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          } else {
            const res = await fetchFn(apiUrl, {
              cache: "no-store",
              headers: {
                Accept: "text/css",
                "X-Requested-With": "XMLHttpRequest"
              },
              referrer: `${base}/${service}/user/${userId}`,
              referrerPolicy: "no-referrer-when-downgrade"
            });
            let status = 0;
            let responseText = "";
            if (res) {
              if (typeof res.status === "number") status = res.status;
              try { responseText = await res.text(); } catch {}
            }
            if (!res || !res.ok) {
              lastError = res ? `http_${res.status}` : "network_error";
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset,
                ok: !!(res && res.ok),
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
            try {
              resp = JSON.parse(responseText);
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset,
                ok: true,
                status,
                error: "",
                parseOk: true,
                responseText
              });
            } catch {
              lastError = "invalid_json";
              pushResponse({
                ts: Date.now(),
                source: "browser",
                url: apiUrl,
                page,
                offset,
                ok: true,
                status,
                error: lastError,
                parseOk: false,
                responseText
              });
              break;
            }
          }
        } catch {
          lastError = "network_error";
          pushResponse({
            ts: Date.now(),
            source: electronApi ? "electron" : "browser",
            url: apiUrl,
            page,
            offset,
            ok: false,
            status: 0,
            error: lastError,
            parseOk: false,
            responseText: ""
          });
          break;
        }

        const arr = Array.isArray(resp) ? resp : (resp && (resp.results || resp.posts)) || [];
        if (!Array.isArray(arr) || arr.length === 0) break;
        for (let i = 0; i < arr.length; i++) {
          const copy = Object.assign({}, arr[i]);
          copy.pgPage = page;
          copy.pgIdxOnPage = i + 1;
          posts.push(copy);
        }
        if (arr.length < pageSize) break;
        page++;
        if (delayMs > 0) await sleepMs(delayMs + Math.floor(Math.random() * 150));
      }

      return { posts, error: lastError, responses };
    }

    function getOnlineApiErrorMessage(err) {
      const error = String(err || "").trim();
      if (!error) return "Network error.";
      if (error === "invalid_json") return "API returned non-JSON. Check Responses tab.";
      if (error === "invalid_xml") return "API returned invalid XML. Check Responses tab.";
      if (error === "invalid_profile") return "Profile not found or no public gallery feed.";
      if (error.startsWith("http_")) return `API error (${error.slice(5)})`;
      if (error === "network_error") return "Network error.";
      return `API error (${error})`;
    }

    function normalizeOnlinePosts(posts, opts = {}) {
      const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : ONLINE_POSTS_PER_PAGE;
      const origin = String(opts.origin || "");
      const dataRoot = String(opts.dataRoot || (origin ? origin.replace(/\/$/, "") + "/data" : ""));
      const out = Array.isArray(posts) ? posts.map(p => Object.assign({}, p)) : [];
      const total = out.length;

      for (let i = 0; i < out.length; i++) {
        const p = out[i];
        if (!Number.isFinite(p.pgPage) || !Number.isFinite(p.pgIdxOnPage)) {
          p.pgPage = Math.floor(i / pageSize) + 1;
          p.pgIdxOnPage = (i % pageSize) + 1;
        }
        p.pgGlobalIndex = total - i;
      }

      buildPgFilesForPosts(out, { origin, dataRoot });
      return out;
    }

    if (typeof window !== "undefined") {
      window.LGOnline = Object.assign(window.LGOnline || {}, {
        parseOnlineProfileUrl,
        fetchOnlineProfilePosts,
        normalizeOnlinePosts,
        buildPgFilesForPosts
      });
    }

    const ONLINE_PROFILE_CACHE = new Map();
    const ONLINE_RENAME_MAP = {
      profiles: {},
      posts: {},
      files: {}
    };
    const ONLINE_PRELOAD_CACHE = new Set();
    const ONLINE_MATERIALIZED_MAP = {
      placements: {},
      posts: {}
    };
    const ONLINE_DOWNLOAD_JOBS = new Map();
    let ONLINE_DOWNLOAD_RENDER_TIMER = null;
    const ONLINE_API_RESPONSE_LOG = [];
    const ONLINE_API_RESPONSE_LOG_LIMIT = 250;
    const ONLINE_API_RESPONSE_BODY_LIMIT = 18000;
    const ONLINE_DEFAULT_ICON = "🌐";

    function getOnlineProfileForDirNode(dirNode) {
      const meta = (dirNode && dirNode.onlineMeta) ? dirNode.onlineMeta : null;
      const profileKey = sanitizeOnlineMapKey(meta && meta.profileKey);
      if (!profileKey) return null;
      const entry = ONLINE_PROFILE_CACHE.get(profileKey);
      if (!entry || !entry.profile) return null;
      return entry.profile;
    }

    function getOnlineProfileFaviconUrl(profile) {
      let source = buildOnlineProfileSourceUrl(profile);
      if (!source) source = String(profile && profile.origin || "").trim();
      if (!source) return "";
      try {
        const parsed = new URL(source);
        const proto = String(parsed.protocol || "").toLowerCase();
        if (proto !== "http:" && proto !== "https:") return "";
        return parsed.origin.replace(/\/$/, "") + "/favicon.ico";
      } catch {
        return "";
      }
    }

    function getOnlineDirFaviconUrl(dirNode) {
      const profile = getOnlineProfileForDirNode(dirNode);
      return getOnlineProfileFaviconUrl(profile);
    }

    function buildOnlineSourceIconHtml(dirNode, opts = {}) {
      const className = String(opts.className || "").trim();
      const imgClassName = String(opts.imgClassName || "").trim();
      const fallbackClassName = String(opts.fallbackClassName || "").trim();
      const titleText = String(opts.title || "Online");
      const faviconUrl = getOnlineDirFaviconUrl(dirNode);

      const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
      const titleAttr = titleText ? ` title="${escapeHtml(titleText)}"` : "";
      const imgClassAttr = imgClassName ? ` class="${escapeHtml(imgClassName)}"` : "";
      const fallbackClassAttr = fallbackClassName ? ` class="${escapeHtml(fallbackClassName)}"` : "";

      if (!faviconUrl) {
        return `<span${classAttr}${titleAttr}><span${fallbackClassAttr}>${ONLINE_DEFAULT_ICON}</span></span>`;
      }

      return `<span${classAttr}${titleAttr}><img${imgClassAttr} src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline-flex';"><span${fallbackClassAttr} style="display:none;">${ONLINE_DEFAULT_ICON}</span></span>`;
    }

    function scheduleOnlineDownloadUiRefresh() {
      if (ONLINE_DOWNLOAD_RENDER_TIMER) return;
      ONLINE_DOWNLOAD_RENDER_TIMER = setTimeout(() => {
        ONLINE_DOWNLOAD_RENDER_TIMER = null;
        if (!WS.root) return;
        renderDirectoriesPane(true);
      }, 80);
    }

    function sanitizeOnlineMapKey(value) {
      return String(value || "");
    }

    function getOnlinePlacementBucket(profileKey, create = false) {
      const key = sanitizeOnlineMapKey(profileKey);
      if (!key) return null;
      if (!ONLINE_MATERIALIZED_MAP.placements[key] && create) {
        ONLINE_MATERIALIZED_MAP.placements[key] = {};
      }
      return ONLINE_MATERIALIZED_MAP.placements[key] || null;
    }

    function getOnlinePostBucket(profileKey, placementKey, create = false) {
      const pKey = sanitizeOnlineMapKey(profileKey);
      const plKey = sanitizeOnlineMapKey(placementKey);
      if (!pKey || !plKey) return null;
      if (!ONLINE_MATERIALIZED_MAP.posts[pKey] && create) {
        ONLINE_MATERIALIZED_MAP.posts[pKey] = {};
      }
      const root = ONLINE_MATERIALIZED_MAP.posts[pKey] || null;
      if (!root) return null;
      if (!root[plKey] && create) root[plKey] = {};
      return root[plKey] || null;
    }

    function isOnlinePlacementMaterialized(profileKey, placementKey) {
      const bucket = getOnlinePlacementBucket(profileKey, false);
      if (!bucket) return false;
      const key = sanitizeOnlineMapKey(placementKey);
      return !!(key && bucket[key]);
    }

    function isOnlinePostMaterialized(profileKey, placementKey, postKey) {
      const bucket = getOnlinePostBucket(profileKey, placementKey, false);
      if (!bucket) return false;
      const key = sanitizeOnlineMapKey(postKey);
      return !!(key && bucket[key]);
    }

    function markOnlinePlacementMaterialized(profileKey, placementKey) {
      const key = sanitizeOnlineMapKey(placementKey);
      const bucket = getOnlinePlacementBucket(profileKey, true);
      if (!bucket || !key) return false;
      if (bucket[key]) return false;
      bucket[key] = 1;
      return true;
    }

    function markOnlinePostMaterialized(profileKey, placementKey, postKey) {
      const key = sanitizeOnlineMapKey(postKey);
      const bucket = getOnlinePostBucket(profileKey, placementKey, true);
      if (!bucket || !key) return false;
      if (bucket[key]) return false;
      bucket[key] = 1;
      return true;
    }

    function clearOnlineMaterializedProfile(profileKey) {
      const key = sanitizeOnlineMapKey(profileKey);
      if (!key) return;
      delete ONLINE_MATERIALIZED_MAP.placements[key];
      delete ONLINE_MATERIALIZED_MAP.posts[key];
    }

    function clearOnlineMaterializedPlacement(profileKey, placementKey) {
      const pKey = sanitizeOnlineMapKey(profileKey);
      const plKey = sanitizeOnlineMapKey(placementKey);
      if (!pKey || !plKey) return;
      if (ONLINE_MATERIALIZED_MAP.placements[pKey]) {
        delete ONLINE_MATERIALIZED_MAP.placements[pKey][plKey];
        if (!Object.keys(ONLINE_MATERIALIZED_MAP.placements[pKey]).length) {
          delete ONLINE_MATERIALIZED_MAP.placements[pKey];
        }
      }
      if (ONLINE_MATERIALIZED_MAP.posts[pKey]) {
        delete ONLINE_MATERIALIZED_MAP.posts[pKey][plKey];
        if (!Object.keys(ONLINE_MATERIALIZED_MAP.posts[pKey]).length) {
          delete ONLINE_MATERIALIZED_MAP.posts[pKey];
        }
      }
    }

    function resetOnlineMaterializedMap(raw) {
      ONLINE_MATERIALIZED_MAP.placements = {};
      ONLINE_MATERIALIZED_MAP.posts = {};
      if (!raw || typeof raw !== "object") return;

      const placementsRaw = (raw.placements && typeof raw.placements === "object") ? raw.placements : {};
      for (const profileKey of Object.keys(placementsRaw)) {
        const src = placementsRaw[profileKey];
        if (!src || typeof src !== "object") continue;
        const dst = {};
        for (const placementKey of Object.keys(src)) {
          if (src[placementKey]) dst[String(placementKey)] = 1;
        }
        if (Object.keys(dst).length) ONLINE_MATERIALIZED_MAP.placements[String(profileKey)] = dst;
      }

      const postsRaw = (raw.posts && typeof raw.posts === "object") ? raw.posts : {};
      for (const profileKey of Object.keys(postsRaw)) {
        const byPlacement = postsRaw[profileKey];
        if (!byPlacement || typeof byPlacement !== "object") continue;
        const dstByPlacement = {};
        for (const placementKey of Object.keys(byPlacement)) {
          const srcPosts = byPlacement[placementKey];
          if (!srcPosts || typeof srcPosts !== "object") continue;
          const dstPosts = {};
          for (const postKey of Object.keys(srcPosts)) {
            if (srcPosts[postKey]) dstPosts[String(postKey)] = 1;
          }
          if (Object.keys(dstPosts).length) dstByPlacement[String(placementKey)] = dstPosts;
        }
        if (Object.keys(dstByPlacement).length) ONLINE_MATERIALIZED_MAP.posts[String(profileKey)] = dstByPlacement;
      }
    }

    function buildOnlineMaterializedDoc() {
      return {
        placements: ONLINE_MATERIALIZED_MAP.placements || {},
        posts: ONLINE_MATERIALIZED_MAP.posts || {}
      };
    }

    function normalizeOnlineBasePath(p) {
      return String(p || "").replace(/^\/+|\/+$/g, "");
    }

    function makeOnlinePlacementId(profileKey, mode, basePath) {
      return String(profileKey || "") + "::" + String(mode || "profile") + "::" + normalizeOnlineBasePath(basePath);
    }

    function deriveOnlineUserLabel(profile, posts) {
      const sample = Array.isArray(posts) && posts.length ? posts[0] : null;
      const v = (sample && (sample.user || sample.user_name || sample.username || sample.userId || sample.author))
        || (profile && profile.userId)
        || "profile";
      return String(v || "profile");
    }

    async function ensureSiteLogHandles() {
      const sys = WS.meta && WS.meta.fsSysDirHandle ? WS.meta.fsSysDirHandle : null;
      if (!sys) return null;
      if (WS.meta.fsSiteLogDirHandle && WS.meta.fsSiteLogProfilesDirHandle && WS.meta.fsSiteLogIndexHandle && WS.meta.fsSiteLogRenamesHandle) {
        return {
          dir: WS.meta.fsSiteLogDirHandle,
          profilesDir: WS.meta.fsSiteLogProfilesDirHandle,
          indexFile: WS.meta.fsSiteLogIndexHandle,
          renamesFile: WS.meta.fsSiteLogRenamesHandle
        };
      }
      try {
        const dir = await sys.getDirectoryHandle("site_log", { create: true });
        const profilesDir = await dir.getDirectoryHandle("profiles", { create: true });
        const indexFile = await dir.getFileHandle("profiles.index.json", { create: true });
        const renamesFile = await dir.getFileHandle("renames.json", { create: true });
        WS.meta.fsSiteLogDirHandle = dir;
        WS.meta.fsSiteLogProfilesDirHandle = profilesDir;
        WS.meta.fsSiteLogIndexHandle = indexFile;
        WS.meta.fsSiteLogRenamesHandle = renamesFile;
        return { dir, profilesDir, indexFile, renamesFile };
      } catch {
        return null;
      }
    }

    async function siteLogLoadIndex() {
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.indexFile) return null;
      const doc = await metaLoadFsDoc(handles.indexFile);
      if (doc && doc.schema === 1 && doc.profiles && typeof doc.profiles === "object") return doc;
      return { schema: 1, profiles: {} };
    }

    async function siteLogSaveIndex(doc) {
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.indexFile) return false;
      await metaSaveFsDoc(handles.indexFile, doc);
      return true;
    }

    async function siteLogUpsertPlacement(profileKey, sourceUrl, placement) {
      const key = String(profileKey || "");
      if (!key) return { ok: false };
      const index = (await siteLogLoadIndex()) || { schema: 1, profiles: {} };
      const entry = index.profiles[key] || { url: "", versions: [], latestId: null, placements: [] };
      entry.url = String(sourceUrl || entry.url || "");
      const placements = Array.isArray(entry.placements) ? entry.placements : [];
      const mode = placement && placement.mode ? placement.mode : "profile";
      const basePath = normalizeOnlineBasePath(placement && placement.basePath ? placement.basePath : "");
      const id = (placement && placement.id) ? String(placement.id) : makeOnlinePlacementId(key, mode, basePath);
      const now = Date.now();
      let existing = placements.find(p => String(p.id) === id);
      if (!existing) {
        existing = { id, mode, basePath, addedAt: now, lastUsed: now };
        placements.push(existing);
      } else {
        existing.mode = mode;
        existing.basePath = basePath;
        existing.lastUsed = now;
      }
      entry.placements = placements;
      index.profiles[key] = entry;
      await siteLogSaveIndex(index);
      return { ok: true, placementId: id };
    }

    async function siteLogDeleteProfile(profileKey) {
      const key = String(profileKey || "");
      if (!key) return false;
      const handles = await ensureSiteLogHandles();
      const index = await siteLogLoadIndex();
      if (!handles || !index || !index.profiles || !index.profiles[key]) return false;
      const entry = index.profiles[key];
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      if (handles.profilesDir) {
        for (const v of versions) {
          if (!v || !v.file) continue;
          try { await handles.profilesDir.removeEntry(String(v.file)); } catch {}
        }
      }
      delete index.profiles[key];
      await siteLogSaveIndex(index);
      return true;
    }

    async function siteLogLoadRenames() {
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.renamesFile) return false;
      const doc = await metaLoadFsDoc(handles.renamesFile);
      if (doc && doc.schema === 1 && doc.renames && typeof doc.renames === "object") {
        ONLINE_RENAME_MAP.profiles = doc.renames.profiles || {};
        ONLINE_RENAME_MAP.posts = doc.renames.posts || {};
        ONLINE_RENAME_MAP.files = doc.renames.files || {};
        resetOnlineMaterializedMap(doc.materialized);
        return true;
      }
      resetOnlineMaterializedMap(null);
      return false;
    }

    async function siteLogSaveRenames() {
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.renamesFile) return false;
      const doc = {
        schema: 1,
        updatedAt: Date.now(),
        renames: {
          profiles: ONLINE_RENAME_MAP.profiles || {},
          posts: ONLINE_RENAME_MAP.posts || {},
          files: ONLINE_RENAME_MAP.files || {}
        },
        materialized: buildOnlineMaterializedDoc()
      };
      await metaSaveFsDoc(handles.renamesFile, doc);
      return true;
    }

    async function saveOnlineProfileVersion(profile, posts, sourceUrl) {
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.profilesDir) return { saved: false, reason: "no_site_log" };
      const ts = Date.now();
      const key = String(profile?.profileKey || "profile");
      const profileHash = String(hash32(key));
      const fileName = `profile_${profileHash}_${ts}.json`;
      const doc = {
        schema: 1,
        profile: Object.assign({}, profile || {}, { sourceUrl: String(sourceUrl || "") }),
        fetchedAt: ts,
        posts: Array.isArray(posts) ? posts : []
      };
      try {
        const fh = await handles.profilesDir.getFileHandle(fileName, { create: true });
        await metaSaveFsDoc(fh, doc);
      } catch {
        return { saved: false, reason: "write_failed" };
      }

      const index = (await siteLogLoadIndex()) || { schema: 1, profiles: {} };
      const entry = index.profiles[key] || { url: String(sourceUrl || ""), versions: [], latestId: null };
      entry.url = String(sourceUrl || entry.url || "");
      entry.versions = Array.isArray(entry.versions) ? entry.versions : [];
      const versionId = String(ts);
      entry.versions.push({ id: versionId, ts, file: fileName });
      entry.latestId = versionId;
      index.profiles[key] = entry;
      await siteLogSaveIndex(index);
      return { saved: true, file: fileName, ts };
    }

    function inferOnlineFileExt(fileObj) {
      const raw = String((fileObj && (fileObj.name || fileObj.path || fileObj.url)) || "").trim();
      if (!raw) return "";
      let pathLike = raw;
      try {
        pathLike = new URL(raw, "https://example.invalid").pathname || raw;
      } catch {}
      let base = "";
      try {
        base = decodeURIComponent(String(pathLike).split("/").pop() || "");
      } catch {
        base = String(pathLike).split("/").pop() || "";
      }
      base = String(base).split("?")[0].split("#")[0];
      const m = /\.([A-Za-z0-9]{1,10})$/.exec(base);
      if (m && m[1]) return String(m[1]).toLowerCase();
      return "";
    }

    function formatOnlineFilename(post, fileObj, index, globalIndex, userOverride) {
      const user = String(userOverride || post?.user || post?.user_name || post?.username || post?.userId || post?.author || "profile");
      const sanitizeUserFolder = s => {
        s = (s || "").normalize("NFC");
        s = s.replace(/\s+/g, "_");
        s = s.replace(/[\\/:*?"<>|]+/g, "");
        s = s.replace(/[\x00-\x1F\x7F]/g, "");
        s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
        return s;
      };
      const sanitizeNamePart = s => {
        s = (s || "").normalize("NFC");
        s = s.replace(/\s+/g, " ");
        s = s.replace(/ - /g, "-");
        s = s.replace(/[\\/:*?"<>|]+/g, "");
        s = s.replace(/[\x00-\x1F\x7F]/g, "");
        s = s.replace(/ +/g, " ").replace(/^ +| +$/g, "");
        return s;
      };
      const titleRaw = (post && post.title && String(post.title).trim()) ? String(post.title) : ("post_" + (post && post.id != null ? post.id : "0"));
      const threadRaw = user;
      const userSec = sanitizeUserFolder(user);
      let threadSec = sanitizeNamePart(threadRaw).slice(0, 40);
      if (!threadSec) threadSec = sanitizeNamePart(user).slice(0, 40);
      let titleSec = sanitizeNamePart(titleRaw).slice(0, 40);
      if (!titleSec) titleSec = sanitizeNamePart("post_" + (post && post.id != null ? post.id : "0")).slice(0, 40);
      let ext = inferOnlineFileExt(fileObj);
      if (!ext) {
        const rawUrl = String(fileObj && (fileObj.path || fileObj.url || "") || "");
        const baseUrl = (rawUrl.split("?")[0] || "").toLowerCase();
        if (vidRE.test(baseUrl) || !!(fileObj && fileObj.isVid)) ext = "mp4";
        else if (imgRE.test(baseUrl) || !!(fileObj && fileObj.isImg)) ext = "jpg";
        else ext = "bin";
      }
      const gPost = String(globalIndex || 0).padStart(6, "0");
      const fIdx = String(index || 0).padStart(6, "0");
      let dateSec = "000000";
      try {
        const raw = post && (post.published || post.published_at || post.added || post.added_at || post.created || post.created_at || post.created_utc || post.posted || post.posted_at);
        if (raw != null) {
          let d = null;
          if (typeof raw === "number" && isFinite(raw)) {
            const ms = raw > 1e12 ? raw : (raw * 1000);
            d = new Date(ms);
          } else if (typeof raw === "string" && raw.trim()) {
            d = new Date(raw);
          }
          if (d && isFinite(d.getTime())) {
            const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
            const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(d.getUTCDate()).padStart(2, "0");
            dateSec = yy + mm + dd;
          }
        }
      } catch {}
      const base = `${dateSec}-${threadSec}-${gPost} - ${titleSec}`;
      const fileName = `${base}_${fIdx}.${ext}`;
      const postFolder = base;
      return `${userSec}/${postFolder}/${fileName}`;
    }

    function getOnlineProfileRename(profileKey) {
      if (!profileKey) return null;
      const name = ONLINE_RENAME_MAP.profiles ? ONLINE_RENAME_MAP.profiles[String(profileKey)] : null;
      return name ? String(name) : null;
    }

    function getOnlinePostRename(profileKey, postKey) {
      if (!profileKey || !postKey) return null;
      const bucket = ONLINE_RENAME_MAP.posts ? ONLINE_RENAME_MAP.posts[String(profileKey)] : null;
      const name = bucket ? bucket[String(postKey)] : null;
      return name ? String(name) : null;
    }

    function getOnlineFileRename(profileKey, fileUrl) {
      if (!profileKey || !fileUrl) return null;
      const bucket = ONLINE_RENAME_MAP.files ? ONLINE_RENAME_MAP.files[String(profileKey)] : null;
      const name = bucket ? bucket[String(fileUrl)] : null;
      return name ? String(name) : null;
    }

    function dirDisplayName(node) {
      if (node && node.onlineMeta) {
        const meta = node.onlineMeta;
        if (meta.kind === "profile") {
          const override = getOnlineProfileRename(meta.profileKey);
          if (override) return displayName(override) || displayName(node.name || "folder") || "folder";
        } else if (meta.kind === "post") {
          const override = getOnlinePostRename(meta.profileKey, meta.postKey);
          if (override) return displayName(override) || displayName(node.name || "folder") || "folder";
        }
      }
      return displayName(node?.name || "folder") || "folder";
    }

    function fileDisplayNameForRecord(rec) {
      if (rec && rec.online && rec.onlineMeta) {
        const meta = rec.onlineMeta;
        const override = getOnlineFileRename(meta.profileKey, meta.fileUrl);
        if (override) {
          const ext = splitNameExt(rec.name || "").ext || "";
          return fileDisplayName(String(override) + ext) || fileDisplayName(rec.name || "file") || "file";
        }
      }
      return fileDisplayName(rec?.name || "file") || "file";
    }

    function onlineLoadMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return (opt && opt.onlineLoadMode === "preload") ? "preload" : "as-needed";
    }

    function listOnlineFoldersFirstEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.listOnlineFoldersFirst);
    }

    function shouldPreloadOnlineForDir(dirNode) {
      if (!dirNode || onlineLoadMode() !== "preload") return false;
      if (dirNode.onlineMeta && (dirNode.onlineMeta.kind === "profile" || dirNode.onlineMeta.kind === "post")) return true;
      const children = dirNode.childrenDirs || [];
      return children.some(d => d && d.onlineMeta && d.onlineMeta.kind === "post");
    }

    function preloadOnlineRecord(rec) {
      if (!rec || !rec.online || !rec.url) return;
      const key = String(rec.url || "");
      if (ONLINE_PRELOAD_CACHE.has(key)) return;
      ONLINE_PRELOAD_CACHE.add(key);
      if (rec.type === "image") {
        const img = new Image();
        img.src = rec.url;
        PRELOAD_CACHE.set(key, img);
        return;
      }
      if (rec.type === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        normalizeVideoPlaybackRate(v);
        v.playsInline = true;
        v.src = rec.url;
        try { v.load(); } catch {}
        PRELOAD_CACHE.set(key, v);
      }
    }

    function preloadOnlineMediaForDir(dirNode) {
      if (!shouldPreloadOnlineForDir(dirNode)) return;
      const hasPostChildren = !(dirNode.onlineMeta) && (dirNode.childrenDirs || []).some(d => d && d.onlineMeta && d.onlineMeta.kind === "post");
      const includeChildren = !!(dirNode.onlineMeta && dirNode.onlineMeta.kind === "profile") || hasPostChildren;
      const ids = getOrderedFileIdsForDir(dirNode, includeChildren);
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || !rec.online) continue;
        preloadOnlineRecord(rec);
      }
    }

    function ensureOnlineWorkspaceReady() {
      if (WS.root) return;
      clearWorkspaceEmptyState();
      WS.root = makeDirNode("root", null);
      WS.root.path = "";
      WS.dirByPath.set("", WS.root);
      applyMediaFilterFromOptions();
      WS.view.randomSeed = computeWorkspaceSeed();
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;
      WS.meta.storageMode = "local";
      WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
      metaInitForCurrentWorkspace();
      WS.nav.dirNode = WS.root;
    }

    function injectOnlineProfileIntoWorkspace(profileKey) {
      const opts = arguments.length > 1 ? arguments[1] : null;
      const silent = !!(opts && opts.silent);
      const mode = (opts && opts.mode === "posts") ? "posts" : "profile";
      const basePath = normalizeOnlineBasePath(opts && opts.basePath ? opts.basePath : "");
      const placementKey = (opts && opts.placementId) ? String(opts.placementId) : makeOnlinePlacementId(profileKey, mode, basePath);
      if (isOnlinePlacementMaterialized(profileKey, placementKey)) {
        return { ok: false, error: "materialized" };
      }
      const entry = ONLINE_PROFILE_CACHE.get(profileKey);
      if (!entry || !entry.profile) return { ok: false, error: "missing-profile" };
      const posts = Array.isArray(entry.posts) ? entry.posts : [];
      if (!posts.length) return { ok: false, error: "no-posts" };
      if (!entry.injectedPlacements) {
        entry.injectedPlacements = new Set();
        if (entry.injected === true) entry.injectedPlacements.add(placementKey);
      }
      if (entry.injectedPlacements.has(placementKey)) return { ok: false, error: "already-added" };

      ensureOnlineWorkspaceReady();

      const userLabel = deriveOnlineUserLabel(entry.profile, posts);
      let addedFiles = 0;

      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postIndex = (typeof post.pgGlobalIndex === "number") ? post.pgGlobalIndex : (posts.length - i);
        const files = Array.isArray(post.pgFiles) ? post.pgFiles : [];
        const postKey = (post && post.id != null) ? String(post.id) : ("idx:" + String(postIndex || i + 1));
        if (isOnlinePostMaterialized(profileKey, placementKey, postKey)) continue;
        for (let j = 0; j < files.length; j++) {
          const f = files[j];
          if (!f || !f.url) continue;
          const fileIndex = (typeof f.g === "number") ? f.g : ((typeof f.local === "number") ? f.local : (j + 1));
          const baseRel = formatOnlineFilename(post, { path: f.url, isVid: !!f.isVid, isImg: !f.isVid }, fileIndex, postIndex, userLabel);
          const parts = String(baseRel || "").split("/").filter(Boolean);
          if (!parts.length) continue;
          const userFolder = parts[0] || "";
          const postFolder = parts[1] || "";
          const fileName = parts[parts.length - 1];
          const baseParts = basePath ? basePath.split("/").filter(Boolean) : [];
          const pathParts = (mode === "posts")
            ? baseParts.concat(postFolder ? [postFolder, fileName] : [fileName])
            : baseParts.concat(userFolder ? [userFolder, postFolder, fileName] : [postFolder, fileName]);
          const relPath = pathParts.filter(Boolean).join("/");
          const name = fileName;
          const dirPath = pathParts.slice(0, -1).join("/");
          if (!isImageName(name) && !isVideoName(name)) continue;
          const profilePath = mode === "profile"
            ? (baseParts.concat(userFolder ? [userFolder] : []).filter(Boolean).join("/"))
            : "";
          const postPath = mode === "posts"
            ? (baseParts.concat(postFolder ? [postFolder] : []).filter(Boolean).join("/"))
            : (baseParts.concat(userFolder ? [userFolder, postFolder] : [postFolder]).filter(Boolean).join("/"));
          if (profilePath) {
            const pNode = ensureDirPath(profilePath);
            if (pNode && !pNode.onlineMeta) {
              pNode.onlineMeta = { kind: "profile", profileKey, profilePath, placementKey, mode, basePath };
            }
          }
          if (postPath) {
            const postNode = ensureDirPath(postPath);
            if (postNode && !postNode.onlineMeta) {
              postNode.onlineMeta = { kind: "post", profileKey, postKey, placementKey, mode, basePath };
            }
          }
          const placementToken = String(hash32(placementKey));
          const id = "online::" + placementToken + "::" + profileKey + "::" + String(post.id != null ? post.id : postIndex) + "::" + String(fileIndex) + "::" + String(hash32(f.url));
          if (WS.fileById.has(id)) continue;

          const extDot = name.lastIndexOf(".");
          const ext = extDot >= 0 ? name.slice(extDot).toLowerCase() : "";
          const rec = {
            id,
            file: null,
            name,
            relPath,
            dirPath,
            ext,
            type: isVideoName(name) ? "video" : "image",
            size: 0,
            lastModified: 0,
            url: f.url,
            thumbUrl: null,
            videoThumbUrl: null,
            indices: {
              postId: post.id != null ? post.id : null,
              fileIndex,
              postIndex
            },
            thumbMode: null,
            videoThumbMode: null,
            online: true,
            onlineMeta: {
              profileKey,
              postKey,
              fileUrl: String(f.url || ""),
              placementKey,
              mode,
              basePath
            }
          };

          WS.fileById.set(id, rec);
          const dirNode = ensureDirPath(dirPath);
          if (!dirNode.childrenFiles.includes(id)) dirNode.childrenFiles.push(id);
          addedFiles++;
        }
      }

      if (!addedFiles) return { ok: false, error: "no-files" };

      entry.injectedPlacements.add(placementKey);
      entry.userLabel = userLabel;
      entry.fileCount = addedFiles;

      if (applyPendingTagsToWorkspace()) {
        WS.meta.dirty = true;
      }

      if (!silent) {
        WS.view.randomSeed = computeWorkspaceSeed();
        WS.view.randomCache = new Map();
        metaComputeFingerprints();
        WS.meta.dirty = true;
        metaScheduleSave();

        if (!WS.nav.dirNode) WS.nav.dirNode = WS.root;
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }

      return { ok: true, files: addedFiles };
    }

    async function loadOnlineProfilesFromSiteLog(opts = {}) {
      const render = opts.render !== false;
      const handles = await ensureSiteLogHandles();
      if (!handles || !handles.profilesDir) return 0;
      const index = await siteLogLoadIndex();
      if (!index || !index.profiles) return 0;
      let injected = 0;

      for (const profileKey of Object.keys(index.profiles)) {
        const entry = index.profiles[profileKey];
        if (!entry) continue;
        const cached = ONLINE_PROFILE_CACHE.get(profileKey);
        const versions = Array.isArray(entry.versions) ? entry.versions : [];
        if (!versions.length) continue;
        let version = null;
        if (entry.latestId) {
          version = versions.find(v => String(v.id) === String(entry.latestId)) || null;
        }
        if (!version) version = versions[versions.length - 1];
        if (!version || !version.file) continue;

        let doc = null;
        try {
          const fh = await handles.profilesDir.getFileHandle(String(version.file), { create: false });
          doc = await metaLoadFsDoc(fh);
        } catch {
          doc = null;
        }
        if (!doc || !Array.isArray(doc.posts) || !doc.posts.length) continue;

        let profile = (doc.profile && typeof doc.profile === "object") ? Object.assign({}, doc.profile) : {};
        if (!profile.profileKey) profile.profileKey = profileKey;
        if (!profile.sourceUrl) profile.sourceUrl = String(entry.url || "");
        if (!profile.origin || !profile.service || !profile.userId) {
          const parsed = parseOnlineProfileUrl(profile.sourceUrl || "");
          if (parsed && parsed.ok) {
            profile = Object.assign({}, parsed, profile);
          }
        }

        ONLINE_PROFILE_CACHE.set(profileKey, {
          profile,
          posts: doc.posts,
          fetchedAt: doc.fetchedAt || version.ts || Date.now(),
          injected: false,
          injectedPlacements: cached && cached.injectedPlacements ? cached.injectedPlacements : new Set()
        });

        const placements = Array.isArray(entry.placements) ? entry.placements : [];
        if (placements.length) {
          for (const pl of placements) {
            if (!pl) continue;
            const res = injectOnlineProfileIntoWorkspace(profileKey, {
              silent: !render,
              mode: pl.mode === "posts" ? "posts" : "profile",
              basePath: pl.basePath || "",
              placementId: pl.id
            });
            if (res && res.ok) injected++;
          }
        } else {
          const res = injectOnlineProfileIntoWorkspace(profileKey, { silent: !render });
          if (res && res.ok) injected++;
        }
      }

      if (injected && render) {
        WS.view.randomSeed = computeWorkspaceSeed();
        WS.view.randomCache = new Map();
        metaComputeFingerprints();
        WS.meta.dirty = true;
        metaScheduleSave();

        if (!WS.nav.dirNode) WS.nav.dirNode = WS.root;
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }

      return injected;
    }

    function removeOnlineProfileFromWorkspace(profileKey) {
      if (!profileKey) return 0;
      let removed = 0;
      for (const [id, rec] of WS.fileById.entries()) {
        if (!rec || !rec.online || !rec.onlineMeta) continue;
        if (rec.onlineMeta.profileKey !== profileKey) continue;
        const dirNode = WS.dirByPath.get(String(rec.dirPath || ""));
        if (dirNode) {
          dirNode.childrenFiles = (dirNode.childrenFiles || []).filter(fid => fid !== id);
        }
        WS.fileById.delete(id);
        removed++;
      }

      const dirPaths = Array.from(WS.dirByPath.keys())
        .filter(p => p && WS.dirByPath.get(p)?.onlineMeta?.profileKey === profileKey)
        .sort((a, b) => b.length - a.length);
      for (const p of dirPaths) {
        const node = WS.dirByPath.get(p);
        if (!node) continue;
        if ((node.childrenFiles && node.childrenFiles.length) || (node.childrenDirs && node.childrenDirs.length)) continue;
        const parent = node.parent;
        if (parent) {
          parent.childrenDirs = (parent.childrenDirs || []).filter(d => d !== node);
        }
        WS.dirByPath.delete(p);
      }

      return removed;
    }

    async function refreshOnlineProfile(profileKey) {
      const entry = ONLINE_PROFILE_CACHE.get(profileKey);
      if (!entry || !entry.profile) {
        showStatusMessage("Profile not available.");
        return false;
      }
      const profile = entry.profile;
      showBusyOverlay("Refreshing profile...");
      try {
        const result = await fetchOnlineProfilePosts(profile.service, profile.userId, profile.origin, {});
        appendOnlineApiResponses(result && Array.isArray(result.responses) ? result.responses : []);
        const posts = result && Array.isArray(result.posts) ? result.posts : [];
        if (!posts.length) {
          if (result && result.error) {
            showStatusMessage(getOnlineApiErrorMessage(result.error));
          } else {
            showStatusMessage("No posts found.");
          }
          return false;
        }
        const normalized = normalizeOnlinePosts(posts, { origin: profile.origin, dataRoot: profile.dataRoot });
        await saveOnlineProfileVersion(profile, normalized, profile.sourceUrl || "");
        removeOnlineProfileFromWorkspace(profileKey);
        ONLINE_PROFILE_CACHE.set(profileKey, {
          profile,
          posts: normalized,
          fetchedAt: Date.now(),
          injected: false,
          injectedPlacements: new Set()
        });
        const index = await siteLogLoadIndex();
        const entry = index && index.profiles ? index.profiles[profileKey] : null;
        const placements = entry && Array.isArray(entry.placements) ? entry.placements : [];
        let okInjected = false;
        if (placements.length) {
          for (const pl of placements) {
            if (!pl) continue;
            const res = injectOnlineProfileIntoWorkspace(profileKey, {
              mode: pl.mode === "posts" ? "posts" : "profile",
              basePath: pl.basePath || "",
              placementId: pl.id
            });
            if (res && res.ok) okInjected = true;
          }
        } else {
          const injected = injectOnlineProfileIntoWorkspace(profileKey);
          if (injected && injected.ok) okInjected = true;
        }
        if (!okInjected) {
          showStatusMessage("Refresh failed.");
          return false;
        }
        renderOnlineUi();
        showStatusMessage("Profile refreshed.");
        return true;
      } catch {
        showStatusMessage("Refresh failed.");
        return false;
      } finally {
        hideBusyOverlay();
      }
    }

    function buildOnlinePlacementFileSpecs(profileKey, profile, posts, placement) {
      const out = [];
      const mode = placement && placement.mode === "posts" ? "posts" : "profile";
      const basePath = normalizeOnlineBasePath(placement && placement.basePath ? placement.basePath : "");
      const baseParts = basePath ? basePath.split("/").filter(Boolean) : [];
      const userLabel = deriveOnlineUserLabel(profile, posts);
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postIndex = (typeof post.pgGlobalIndex === "number") ? post.pgGlobalIndex : (posts.length - i);
        const files = Array.isArray(post.pgFiles) ? post.pgFiles : [];
        const postKey = (post && post.id != null) ? String(post.id) : ("idx:" + String(postIndex || i + 1));
        for (let j = 0; j < files.length; j++) {
          const f = files[j];
          if (!f || !f.url) continue;
          const fileIndex = (typeof f.g === "number") ? f.g : ((typeof f.local === "number") ? f.local : (j + 1));
          const baseRel = formatOnlineFilename(post, { path: f.url, isVid: !!f.isVid, isImg: !f.isVid }, fileIndex, postIndex, userLabel);
          const parts = String(baseRel || "").split("/").filter(Boolean);
          if (!parts.length) continue;
          const userFolder = parts[0] || "";
          const postFolder = parts[1] || "";
          const fallbackName = parts[parts.length - 1] || "";
          if (!fallbackName) continue;
          if (!isImageName(fallbackName) && !isVideoName(fallbackName)) continue;
          const fileName = resolveOnlineOutputFileName(profileKey, String(f.url || ""), fallbackName);
          const pathParts = (mode === "posts")
            ? baseParts.concat(postFolder ? [postFolder, fileName] : [fileName])
            : baseParts.concat(userFolder ? [userFolder, postFolder, fileName] : [postFolder, fileName]);
          const relPath = pathParts.filter(Boolean).join("/");
          const dirPath = pathParts.slice(0, -1).join("/");
          out.push({
            profileKey: String(profileKey || ""),
            postKey,
            url: String(f.url || ""),
            name: fileName,
            dirPath,
            relPath
          });
        }
      }
      return out;
    }

    function resolveOnlineOutputFileName(profileKey, fileUrl, fallbackName) {
      const rawFallback = String(fallbackName || "").trim();
      const cleanFallback = sanitizeOnlineFileNameForDisk(rawFallback || "file");
      const override = getOnlineFileRename(profileKey, fileUrl);
      if (!override) return cleanFallback;
      const ext = splitNameExt(cleanFallback).ext || "";
      let candidate = String(override);
      const parts = splitNameExt(candidate);
      if (!parts.ext && ext) candidate = parts.base + ext;
      return sanitizeOnlineFileNameForDisk(candidate);
    }

    async function replaceOnlineProfile(profileKey) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Replace requires a writable folder.");
        return false;
      }
      const current = ONLINE_PROFILE_CACHE.get(profileKey);
      if (!current || !current.profile) {
        showStatusMessage("Profile not available.");
        return false;
      }
      const profile = current.profile;
      showBusyOverlay("Checking remote profile...");
      try {
        const result = await fetchOnlineProfilePosts(profile.service, profile.userId, profile.origin, {});
        appendOnlineApiResponses(result && Array.isArray(result.responses) ? result.responses : []);
        const posts = result && Array.isArray(result.posts) ? result.posts : [];
        if (!posts.length) {
          if (result && result.error) {
            showStatusMessage(getOnlineApiErrorMessage(result.error));
          } else {
            showStatusMessage("No posts found.");
          }
          return false;
        }

        const normalized = normalizeOnlinePosts(posts, { origin: profile.origin, dataRoot: profile.dataRoot });
        await saveOnlineProfileVersion(profile, normalized, profile.sourceUrl || "");

        ONLINE_PROFILE_CACHE.set(profileKey, {
          profile,
          posts: normalized,
          fetchedAt: Date.now(),
          injected: false,
          injectedPlacements: current.injectedPlacements ? new Set(current.injectedPlacements) : new Set()
        });

        const index = await siteLogLoadIndex();
        const indexEntry = index && index.profiles ? index.profiles[profileKey] : null;
        const placements = indexEntry && Array.isArray(indexEntry.placements) ? indexEntry.placements : [];
        if (!placements.length) {
          showStatusMessage("No profile placements found to replace.");
          renderOnlineUi();
          return false;
        }

        const expectedByPath = new Map();
        for (const pl of placements) {
          if (!pl) continue;
          const specs = buildOnlinePlacementFileSpecs(profileKey, profile, normalized, pl);
          for (const spec of specs) {
            const key = String(spec.relPath || "").toLowerCase();
            if (!key || expectedByPath.has(key)) continue;
            expectedByPath.set(key, spec);
          }
        }
        const expected = Array.from(expectedByPath.values());
        if (!expected.length) {
          showStatusMessage("No remote media found for replace.");
          renderOnlineUi();
          return false;
        }

        const checkedDirHandles = new Map();
        const tryGetDirHandle = async (dirPath) => {
          const key = String(dirPath || "");
          if (checkedDirHandles.has(key)) return checkedDirHandles.get(key);
          let handle = null;
          try {
            handle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, key);
          } catch {
            handle = null;
          }
          checkedDirHandles.set(key, handle);
          return handle;
        };

        const missing = [];
        for (let i = 0; i < expected.length; i++) {
          const spec = expected[i];
          if (busyLabel) busyLabel.textContent = `Checking files ${i + 1}/${expected.length}...`;
          const dirHandle = await tryGetDirHandle(spec.dirPath);
          if (!dirHandle) {
            missing.push(spec);
            continue;
          }
          let exists = false;
          try {
            await dirHandle.getFileHandle(spec.name, { create: false });
            exists = true;
          } catch {}
          if (!exists) missing.push(spec);
        }

        if (!missing.length) {
          showStatusMessage("Replace complete: no missing files.");
          renderOnlineUi();
          return true;
        }

        let restored = 0;
        let failed = 0;
        for (let i = 0; i < missing.length; i++) {
          const spec = missing[i];
          if (busyLabel) busyLabel.textContent = `Replacing missing files ${i + 1}/${missing.length}...`;
          let dirHandle = null;
          try {
            dirHandle = await ensureDirectoryHandleForPath(WS.meta.fsRootHandle, spec.dirPath);
          } catch {
            failed++;
            continue;
          }
          let alreadyExists = false;
          try {
            await dirHandle.getFileHandle(spec.name, { create: false });
            alreadyExists = true;
          } catch {}
          if (alreadyExists) continue;

          const payload = await fetchOnlineBinary(spec.url, profileKey);
          if (!payload || !payload.ok || !payload.bytes || !payload.bytes.byteLength) {
            failed++;
            continue;
          }
          try {
            const outFile = await dirHandle.getFileHandle(spec.name, { create: true });
            const writable = await outFile.createWritable();
            await writable.write(payload.bytes);
            await writable.close();
            restored++;
          } catch {
            failed++;
          }
        }

        if (restored > 0) {
          try {
            await refreshWorkspaceFromRootHandle();
          } catch {}
        }
        renderOnlineUi();
        if (!restored && failed > 0) {
          showStatusMessage(`Replace failed: ${failed} file${failed === 1 ? "" : "s"} could not be restored.`);
          return false;
        }
        if (failed > 0) {
          showStatusMessage(`Replace complete: restored ${restored}, failed ${failed}.`);
          return restored > 0;
        }
        showStatusMessage(`Replace complete: restored ${restored} missing file${restored === 1 ? "" : "s"}.`);
        return true;
      } catch {
        showStatusMessage("Replace failed.");
        return false;
      } finally {
        hideBusyOverlay();
      }
    }

    async function renameOnlineProfile(profileKey, nextName) {
      if (!profileKey) return false;
      const clean = String(nextName || "").trim();
      if (clean) ONLINE_RENAME_MAP.profiles[String(profileKey)] = clean;
      else delete ONLINE_RENAME_MAP.profiles[String(profileKey)];
      const saved = await siteLogSaveRenames();
      if (!saved) showStatusMessage("Rename saved in memory only.");
      return true;
    }

    async function renameOnlinePost(profileKey, postKey, nextName) {
      if (!profileKey || !postKey) return false;
      const clean = String(nextName || "").trim();
      const bucket = ONLINE_RENAME_MAP.posts[String(profileKey)] || {};
      if (clean) bucket[String(postKey)] = clean;
      else delete bucket[String(postKey)];
      if (Object.keys(bucket).length) ONLINE_RENAME_MAP.posts[String(profileKey)] = bucket;
      else delete ONLINE_RENAME_MAP.posts[String(profileKey)];
      const saved = await siteLogSaveRenames();
      if (!saved) showStatusMessage("Rename saved in memory only.");
      return true;
    }

    async function renameOnlineFile(profileKey, fileUrl, nextName) {
      if (!profileKey || !fileUrl) return false;
      const clean = String(nextName || "").trim();
      const bucket = ONLINE_RENAME_MAP.files[String(profileKey)] || {};
      if (clean) bucket[String(fileUrl)] = clean;
      else delete bucket[String(fileUrl)];
      if (Object.keys(bucket).length) ONLINE_RENAME_MAP.files[String(profileKey)] = bucket;
      else delete ONLINE_RENAME_MAP.files[String(profileKey)];
      const saved = await siteLogSaveRenames();
      if (!saved) showStatusMessage("Rename saved in memory only.");
      return true;
    }

    async function deleteOnlineProfile(profileKey) {
      const key = String(profileKey || "");
      if (!key) return false;
      showBusyOverlay("Deleting profile...");
      try {
        removeOnlineProfileFromWorkspace(key);
        ONLINE_PROFILE_CACHE.delete(key);
        clearOnlineMaterializedProfile(key);
        delete ONLINE_RENAME_MAP.profiles[key];
        delete ONLINE_RENAME_MAP.posts[key];
        delete ONLINE_RENAME_MAP.files[key];
        await siteLogDeleteProfile(key);
        await siteLogSaveRenames();
        WS.view.randomSeed = computeWorkspaceSeed();
        WS.view.randomCache = new Map();
        metaComputeFingerprints();
        WS.meta.dirty = true;
        metaScheduleSave();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        renderOnlineUi();
        showStatusMessage("Profile deleted.");
        return true;
      } catch {
        showStatusMessage("Delete failed.");
        return false;
      } finally {
        hideBusyOverlay();
      }
    }

    function formatOnlineDownloadBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return "0 B";
      if (n < 1024) return `${Math.round(n)} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
      return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function onlineDownloadPercent(job) {
      if (!job) return 0;
      const total = Number(job.totalFiles || 0);
      const completed = Number(job.completedFiles || 0);
      if (!total) return 0;
      return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    }

    function getOnlineDownloadJob(path) {
      const key = String(path || "");
      if (!key) return null;
      return ONLINE_DOWNLOAD_JOBS.get(key) || null;
    }

    function getOnlineDownloadJobForDir(node) {
      if (!node || !node.onlineMeta) return null;
      return getOnlineDownloadJob(String(node.path || ""));
    }

    function startOnlineDownloadJob(path, totalFiles) {
      const key = String(path || "");
      if (!key) return null;
      const job = {
        path: key,
        state: "running",
        totalFiles: Math.max(0, Number(totalFiles || 0)),
        completedFiles: 0,
        failedFiles: 0,
        totalBytes: 0,
        downloadedBytes: 0,
        currentFile: "",
        startedAt: Date.now(),
        finishedAt: 0,
        error: ""
      };
      ONLINE_DOWNLOAD_JOBS.set(key, job);
      scheduleOnlineDownloadUiRefresh();
      return job;
    }

    function updateOnlineDownloadJob(job, patch = {}) {
      if (!job) return;
      Object.assign(job, patch || {});
      scheduleOnlineDownloadUiRefresh();
    }

    function finishOnlineDownloadJob(job, state, error) {
      if (!job) return;
      job.state = String(state || "done");
      job.finishedAt = Date.now();
      if (error) job.error = String(error);
      scheduleOnlineDownloadUiRefresh();
      setTimeout(() => {
        const cur = ONLINE_DOWNLOAD_JOBS.get(job.path);
        if (cur !== job) return;
        if (cur.state === "running") return;
        ONLINE_DOWNLOAD_JOBS.delete(job.path);
        scheduleOnlineDownloadUiRefresh();
      }, 8000);
    }

    function buildOnlineDownloadMetaHtml(node) {
      const job = getOnlineDownloadJobForDir(node);
      if (!job) return "";
      const pct = onlineDownloadPercent(job);
      const total = Number(job.totalFiles || 0);
      const done = Number(job.completedFiles || 0);
      const failed = Number(job.failedFiles || 0);
      const bytesPart = Number(job.downloadedBytes || 0) > 0
        ? ` • ${formatOnlineDownloadBytes(job.downloadedBytes)}`
        : "";
      const status = job.state === "running"
        ? `Downloading ${done}/${total}${failed ? ` • ${failed} failed` : ""}${bytesPart}`
        : (job.state === "done"
          ? `Downloaded ${done}/${total}${bytesPart}`
          : (job.state === "partial"
            ? `Partial ${done}/${total} • ${failed} failed${bytesPart}`
            : `Failed${job.error ? ` • ${job.error}` : ""}`));
      return `
        <div class="onlineDlMeta" title="${escapeHtml(status)}">
          <div class="onlineDlBar"><div class="onlineDlBarFill" style="width:${pct}%"></div></div>
          <div class="onlineDlText">${escapeHtml(status)} • ${pct}%</div>
        </div>
      `;
    }

    function sanitizeOnlineFileNameForDisk(name) {
      let out = String(name || "").trim();
      out = out.replace(/[\x00-\x1F\x7F]+/g, "_");
      out = out.replace(/[\/\\:*?"<>|]+/g, "_");
      out = out.replace(/\s+/g, " ").trim();
      if (!out || out === "." || out === "..") out = "file";
      return out;
    }

    function makeOnlineDownloadFileName(rec, fallbackIndex) {
      const meta = rec && rec.onlineMeta ? rec.onlineMeta : null;
      const original = String(rec?.name || "");
      const originalParts = splitNameExt(original);
      const originalExt = String(originalParts.ext || "");
      const override = meta ? getOnlineFileRename(meta.profileKey, meta.fileUrl) : null;
      let candidate = "";
      if (override) {
        candidate = String(override);
        const p = splitNameExt(candidate);
        if (!p.ext && originalExt) candidate = p.base + originalExt;
      } else if (original) {
        candidate = original;
      } else {
        let fromUrl = "";
        try {
          const u = new URL(String(rec?.url || ""));
          fromUrl = decodeURIComponent(String(u.pathname || "").split("/").pop() || "");
        } catch {}
        candidate = fromUrl || `file_${Number(fallbackIndex || 0) + 1}`;
      }
      candidate = sanitizeOnlineFileNameForDisk(candidate);
      return candidate;
    }

    function decodeBase64ToBytes(base64) {
      const b64 = String(base64 || "");
      if (!b64) return new Uint8Array(0);
      const raw = atob(b64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }

    function getOnlineFetchReferrer(profileKey, url) {
      const entry = ONLINE_PROFILE_CACHE.get(String(profileKey || ""));
      const source = buildOnlineProfileSourceUrl(entry && entry.profile ? entry.profile : null);
      if (source) return source;
      try {
        const u = new URL(String(url || ""));
        return `${u.origin}/`;
      } catch {
        return "";
      }
    }

    async function fetchOnlineBinary(url, profileKey) {
      const targetUrl = String(url || "");
      if (!targetUrl) return { ok: false, status: 0, error: "invalid_url" };
      const referrer = getOnlineFetchReferrer(profileKey, targetUrl);
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.downloadUrl === "function")
        ? window.electronAPI
        : null;
      if (electronApi) {
        const res = await electronApi.downloadUrl({
          url: targetUrl,
          headers: {
            Accept: "*/*",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": navigator.userAgent
          },
          referrer
        });
        if (!res || !res.ok) {
          const status = res && Number.isFinite(res.status) ? Number(res.status) : 0;
          const error = res && res.error ? String(res.error) : (status ? `http_${status}` : "network_error");
          return { ok: false, status, error };
        }
        const bytes = decodeBase64ToBytes(res.data || "");
        return {
          ok: true,
          bytes,
          byteLength: Number(res.bytes || bytes.byteLength || 0),
          contentLength: Number(res.contentLength || bytes.byteLength || 0),
          contentType: String(res.contentType || "")
        };
      }

      try {
        const resp = await fetch(targetUrl, {
          cache: "no-store",
          headers: {
            Accept: "*/*",
            "X-Requested-With": "XMLHttpRequest"
          },
          referrer: referrer || undefined,
          referrerPolicy: "no-referrer-when-downgrade"
        });
        if (!resp || !resp.ok) {
          return { ok: false, status: resp ? resp.status : 0, error: resp ? `http_${resp.status}` : "network_error" };
        }
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        return {
          ok: true,
          bytes,
          byteLength: bytes.byteLength,
          contentLength: Number(resp.headers.get("content-length") || 0) || bytes.byteLength,
          contentType: String(resp.headers.get("content-type") || "")
        };
      } catch {
        return { ok: false, status: 0, error: "network_error" };
      }
    }

    function collectOnlineRecordsForDirNode(dirNode) {
      if (!dirNode || !dirNode.onlineMeta) return [];
      const meta = dirNode.onlineMeta;
      const includeChildren = meta.kind === "profile";
      const ids = getOrderedFileIdsForDir(dirNode, includeChildren);
      const out = [];
      const seen = new Set();
      for (const id of ids) {
        const key = String(id || "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rec = WS.fileById.get(key);
        if (!rec || !rec.online || !rec.onlineMeta || !rec.url) continue;
        if (String(rec.onlineMeta.profileKey || "") !== String(meta.profileKey || "")) continue;
        if (meta.placementKey && String(rec.onlineMeta.placementKey || "") !== String(meta.placementKey || "")) continue;
        if (meta.kind === "post" && String(rec.onlineMeta.postKey || "") !== String(meta.postKey || "")) continue;
        out.push(rec);
      }
      return out;
    }

    function onlinePlacementKeyFromNode(dirNode) {
      const meta = dirNode && dirNode.onlineMeta ? dirNode.onlineMeta : null;
      if (!meta) return "";
      if (meta.placementKey) return String(meta.placementKey);
      return makeOnlinePlacementId(meta.profileKey, meta.mode || "profile", meta.basePath || "");
    }

    async function markOnlineNodeMaterialized(dirNode) {
      if (!dirNode || !dirNode.onlineMeta) return false;
      const meta = dirNode.onlineMeta;
      const profileKey = String(meta.profileKey || "");
      const placementKey = onlinePlacementKeyFromNode(dirNode);
      if (!profileKey || !placementKey) return false;
      let changed = false;
      if (meta.kind === "profile") {
        changed = markOnlinePlacementMaterialized(profileKey, placementKey) || changed;
      } else if (meta.kind === "post") {
        const postKey = String(meta.postKey || "");
        if (postKey) changed = markOnlinePostMaterialized(profileKey, placementKey, postKey) || changed;
      }
      if (changed) await siteLogSaveRenames();
      return changed;
    }

    async function materializeOnlineFolderNode(dirNode, opts = {}) {
      const meta = dirNode && dirNode.onlineMeta ? dirNode.onlineMeta : null;
      if (!meta || (meta.kind !== "profile" && meta.kind !== "post")) {
        if (!opts.silentStatus) showStatusMessage("Not an online folder.");
        return { ok: false, error: "invalid_online_folder" };
      }
      if (!WS.meta.fsRootHandle) {
        if (!opts.silentStatus) showStatusMessage("Downloading requires a writable folder.");
        return { ok: false, error: "no_fs_root" };
      }
      const dirPath = String(dirNode.path || "");
      if (!dirPath) {
        if (!opts.silentStatus) showStatusMessage("Online folder path is invalid.");
        return { ok: false, error: "invalid_path" };
      }
      const activeJob = getOnlineDownloadJob(dirPath);
      if (activeJob && activeJob.state === "running") {
        if (!opts.silentStatus) showStatusMessage("This folder is already downloading.");
        return { ok: false, error: "already_running" };
      }
      const records = collectOnlineRecordsForDirNode(dirNode);
      if (!records.length) {
        if (!opts.silentStatus) showStatusMessage("No online media found in this folder.");
        return { ok: false, error: "no_files" };
      }
      const job = startOnlineDownloadJob(dirPath, records.length);
      if (!job) {
        if (!opts.silentStatus) showStatusMessage("Could not start download job.");
        return { ok: false, error: "job_start_failed" };
      }

      let completed = 0;
      let failed = 0;
      let bytesDone = 0;
      let bytesExpected = 0;
      const usedNamesByDir = new Map();
      const targetHandleCache = new Map();

      const resolveTargetDirPathForRecord = (rec) => {
        if (!rec) return dirPath;
        if (meta.kind !== "profile") return dirPath;
        const recDir = String(rec.dirPath || "");
        if (!recDir || recDir === dirPath) return dirPath;
        if (recDir.startsWith(dirPath + "/")) return recDir;
        return dirPath;
      };

      const getTargetDirHandle = async (targetDirPath) => {
        const key = String(targetDirPath || dirPath);
        if (targetHandleCache.has(key)) return targetHandleCache.get(key);
        const handle = await ensureDirectoryHandleForPath(WS.meta.fsRootHandle, key);
        targetHandleCache.set(key, handle);
        return handle;
      };

      const getDirNameSet = (targetDirPath) => {
        const key = String(targetDirPath || dirPath);
        if (!usedNamesByDir.has(key)) usedNamesByDir.set(key, new Set());
        return usedNamesByDir.get(key);
      };

      try {
        await getTargetDirHandle(dirPath);
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          const metaInfo = rec && rec.onlineMeta ? rec.onlineMeta : null;
          if (!rec || !rec.url || !metaInfo) {
            failed++;
            updateOnlineDownloadJob(job, { failedFiles: failed, completedFiles: completed });
            continue;
          }

          const targetDirPath = resolveTargetDirPathForRecord(rec);
          const targetHandle = await getTargetDirHandle(targetDirPath);
          const dirNameSet = getDirNameSet(targetDirPath);

          const desired = makeOnlineDownloadFileName(rec, i);
          let targetName = desired;
          if (dirNameSet.has(targetName) || await entryExistsInDir(targetHandle, targetName)) {
            targetName = await uniqueDestNameInDir(targetHandle, targetName);
          }
          dirNameSet.add(targetName);

          const shownPath = (targetDirPath && targetDirPath !== dirPath)
            ? `${targetDirPath.split("/").pop() || targetDirPath}/${targetName}`
            : targetName;
          updateOnlineDownloadJob(job, { currentFile: shownPath, completedFiles: completed, failedFiles: failed });
          const payload = await fetchOnlineBinary(rec.url, metaInfo.profileKey);
          if (!payload || !payload.ok || !payload.bytes || !payload.bytes.byteLength) {
            failed++;
            updateOnlineDownloadJob(job, {
              failedFiles: failed,
              completedFiles: completed,
              error: payload && payload.error ? String(payload.error) : "download_failed"
            });
            continue;
          }

          const expected = Number(payload.contentLength || payload.byteLength || payload.bytes.byteLength || 0);
          bytesExpected += expected;
          const got = Number(payload.byteLength || payload.bytes.byteLength || 0);

          try {
            const outFile = await targetHandle.getFileHandle(targetName, { create: true });
            const writable = await outFile.createWritable();
            await writable.write(payload.bytes);
            await writable.close();
            completed++;
            bytesDone += got;
          } catch {
            failed++;
          }

          updateOnlineDownloadJob(job, {
            completedFiles: completed,
            failedFiles: failed,
            downloadedBytes: bytesDone,
            totalBytes: bytesExpected
          });
        }
      } catch (err) {
        const msg = err && err.message ? String(err.message) : "materialize_failed";
        finishOnlineDownloadJob(job, "error", msg);
        if (!opts.silentStatus) showStatusMessage("Download failed.");
        return { ok: false, error: msg, completed, failed, total: records.length };
      }

      const allOk = completed === records.length && failed === 0;
      if (!allOk) {
        const state = completed > 0 ? "partial" : "error";
        finishOnlineDownloadJob(job, state, failed ? `${failed} failed` : "download_failed");
        if (!opts.silentStatus) {
          if (completed > 0) showStatusMessage(`Download partial: ${completed}/${records.length} files completed.`);
          else showStatusMessage("Download failed.");
        }
        return { ok: false, partial: completed > 0, completed, failed, total: records.length };
      }

      await markOnlineNodeMaterialized(dirNode);
      finishOnlineDownloadJob(job, "done", "");

      if (!opts.deferRefresh) {
        try {
          await refreshWorkspaceFromRootHandle();
        } catch {}
      }

      if (!opts.silentStatus) {
        showStatusMessage(`Downloaded ${completed} file${completed === 1 ? "" : "s"} in place.`);
      }
      return { ok: true, completed, failed: 0, total: records.length };
    }

    function dedupeOnlineMaterializeNodes(nodes) {
      const src = Array.isArray(nodes) ? nodes.filter(n => n && n.onlineMeta && (n.onlineMeta.kind === "profile" || n.onlineMeta.kind === "post")) : [];
      src.sort((a, b) => String(a.path || "").length - String(b.path || "").length);
      const out = [];
      const seen = new Set();
      for (const node of src) {
        const path = String(node.path || "");
        if (!path || seen.has(path)) continue;
        const hasAncestorProfile = out.some(prev => {
          const prevPath = String(prev.path || "");
          if (!prevPath) return false;
          if (!(path === prevPath || path.startsWith(prevPath + "/"))) return false;
          return prev.onlineMeta && prev.onlineMeta.kind === "profile";
        });
        if (hasAncestorProfile) continue;
        seen.add(path);
        out.push(node);
      }
      return out;
    }

    async function materializeOnlineFolderSelection(nodes) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Downloading requires a writable folder.");
        return false;
      }
      const targets = dedupeOnlineMaterializeNodes(nodes);
      if (!targets.length) {
        showStatusMessage("No online folders selected.");
        return false;
      }

      let successCount = 0;
      let partialCount = 0;
      let failCount = 0;
      for (let i = 0; i < targets.length; i++) {
        const node = targets[i];
        const label = displayPath(node.path || node.name || "folder");
        showStatusMessage(`Downloading ${i + 1}/${targets.length}: ${label}`);
        const res = await materializeOnlineFolderNode(node, { deferRefresh: true, silentStatus: true });
        if (res && res.ok) successCount++;
        else if (res && res.partial) partialCount++;
        else failCount++;
      }

      if (successCount > 0) {
        try {
          await refreshWorkspaceFromRootHandle();
        } catch {}
      }

      if (successCount && !partialCount && !failCount) {
        showStatusMessage(`Downloaded ${successCount} online folder${successCount === 1 ? "" : "s"} in place.`);
      } else if (successCount || partialCount) {
        showStatusMessage(`Downloads complete: ${successCount} full, ${partialCount} partial, ${failCount} failed.`);
      } else {
        showStatusMessage("All selected online folder downloads failed.");
      }
      return successCount > 0;
    }

    function clampNumber(value, min, max, fallback) {
      const n = typeof value === "number" ? value : parseFloat(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function defaultOptions() {
      return {
        videoPreview: "muted",
        videoGallery: "muted",
        imageThumbSize: "small",
        videoThumbSize: "small",
        mediaThumbUiSize: "small",
        folderPreviewSize: "small",
        hideFileExtensions: false,
        defaultFolderBehavior: "slide",
        folderScoreDisplay: "no-arrows",
        previewMode: "grid",
        videoSkipStep: "10",
        preloadNextMode: "off",
        videoEndBehavior: "loop",
        slideshowDefault: "cycle",
        hideUnderscoresInNames: true,
        hideBeforeLastDashInFileNames: true,
        hideAfterFirstUnderscoreInFileNames: true,
        forceTitleCaps: true,
        banicOpenWindow: true,
        altGalleryMode: true,
        retroMode: false,
        mediaFilter: "off",
        animatedMediaFilters: true,
        crtScanlinesEnabled: false,
        crtPixelateEnabled: false,
        crtGrainEnabled: false,
        crtPixelateResolution: 4,
        crtGrainAmount: 0.06,
        vhsOverlayEnabled: false,
        vhsBlurAmount: 1.2,
        vhsChromaAmount: 1.2,
        filmCornerOverlayEnabled: false,
        colorScheme: "classic",
        leftPaneWidthPct: 0.28,
        treatTagsAsFolders: true,
        showHiddenFolder: false,
        showUntaggedFolder: false,
        showTrashFolder: true,
        showFolderItemCount: true,
        showFolderSize: true,
        showDirFileTypeLabel: true,
        showPreviewFileTypeLabel: true,
        showPreviewFolderItemCount: true,
        showPreviewFileName: true,
        previewThumbFiltersEnabled: false,
        previewThumbFit: "cover",
        onlineLoadMode: "as-needed",
        listOnlineFoldersFirst: false,
        onlineFeaturesEnabled: true,
        hideOptionDescriptions: false,
        hideKeybindDescriptions: false,
        randomActionMode: "firstFileJump"
      };
    }

    function normalizeOptions(o) {
      const d = defaultOptions();
      const src = (o && typeof o === "object") ? o : {};
      const mediaFilterRaw = (src && src.mediaFilter === "vhs") ? "crt" : src.mediaFilter;
      const legacyCrtPixelateResRaw = (src && src.crtPixelateRes != null) ? String(src.crtPixelateRes) : null;
      const legacyCrtOverlayEnabledRaw = (typeof src.crtOverlayEnabled === "boolean") ? src.crtOverlayEnabled : null;
      const legacyCrtOverlayEnabled = (legacyCrtOverlayEnabledRaw !== null)
        ? legacyCrtOverlayEnabledRaw
        : (legacyCrtPixelateResRaw ? legacyCrtPixelateResRaw !== "off" : false);
      const crtScanlinesEnabled = (typeof src.crtScanlinesEnabled === "boolean") ? src.crtScanlinesEnabled : legacyCrtOverlayEnabled;
      const crtPixelateEnabled = (typeof src.crtPixelateEnabled === "boolean") ? src.crtPixelateEnabled : legacyCrtOverlayEnabled;
      const crtGrainEnabled = (typeof src.crtGrainEnabled === "boolean") ? src.crtGrainEnabled : legacyCrtOverlayEnabled;
      const crtPixelateResolution = clampNumber(src.crtPixelateResolution, 2, 8, d.crtPixelateResolution);
      const crtGrainAmount = clampNumber(src.crtGrainAmount, 0, 0.25, d.crtGrainAmount);
      const vhsOverlayEnabled = (typeof src.vhsOverlayEnabled === "boolean") ? src.vhsOverlayEnabled : d.vhsOverlayEnabled;
      const vhsBlurAmount = clampNumber(src.vhsBlurAmount, 0, 3, d.vhsBlurAmount);
      const vhsChromaAmount = clampNumber(src.vhsChromaAmount, 0, 3, d.vhsChromaAmount);
      const filmCornerOverlayEnabled = (typeof src.filmCornerOverlayEnabled === "boolean") ? src.filmCornerOverlayEnabled : d.filmCornerOverlayEnabled;
      const out = {
        videoPreview: (src.videoPreview === "unmuted" || src.videoPreview === "muted" || src.videoPreview === "off") ? src.videoPreview : d.videoPreview,
        videoGallery: (src.videoGallery === "unmuted" || src.videoGallery === "muted" || src.videoGallery === "off") ? src.videoGallery : d.videoGallery,
        imageThumbSize: (src.imageThumbSize === "tiny" || src.imageThumbSize === "small" || src.imageThumbSize === "medium" || src.imageThumbSize === "high") ? src.imageThumbSize : d.imageThumbSize,
        videoThumbSize: (src.videoThumbSize === "tiny" || src.videoThumbSize === "small" || src.videoThumbSize === "medium" || src.videoThumbSize === "high") ? src.videoThumbSize : d.videoThumbSize,
        mediaThumbUiSize: (src.mediaThumbUiSize === "small" || src.mediaThumbUiSize === "medium" || src.mediaThumbUiSize === "large") ? src.mediaThumbUiSize : d.mediaThumbUiSize,
        folderPreviewSize: (src.folderPreviewSize === "small" || src.folderPreviewSize === "medium" || src.folderPreviewSize === "large") ? src.folderPreviewSize : d.folderPreviewSize,
        hideFileExtensions: (typeof src.hideFileExtensions === "boolean") ? src.hideFileExtensions : ((typeof src.showFileExtensions === "boolean") ? !src.showFileExtensions : d.hideFileExtensions),
        defaultFolderBehavior: (src.defaultFolderBehavior === "stop" || src.defaultFolderBehavior === "loop" || src.defaultFolderBehavior === "slide") ? src.defaultFolderBehavior : d.defaultFolderBehavior,
        folderScoreDisplay: (src.folderScoreDisplay === "show" || src.folderScoreDisplay === "no-arrows" || src.folderScoreDisplay === "hidden") ? src.folderScoreDisplay : ((typeof src.showFolderScores === "boolean") ? (src.showFolderScores ? "show" : "hidden") : d.folderScoreDisplay),
        previewMode: (src.previewMode === "grid" || src.previewMode === "expanded") ? src.previewMode : d.previewMode,
        previewThumbFit: (src.previewThumbFit === "contain" || src.previewThumbFit === "cover") ? src.previewThumbFit : d.previewThumbFit,
        onlineLoadMode: (src.onlineLoadMode === "preload" || src.onlineLoadMode === "as-needed") ? src.onlineLoadMode : d.onlineLoadMode,
        listOnlineFoldersFirst: (typeof src.listOnlineFoldersFirst === "boolean") ? src.listOnlineFoldersFirst : d.listOnlineFoldersFirst,
        videoSkipStep: (src.videoSkipStep === "3" || src.videoSkipStep === "5" || src.videoSkipStep === "10" || src.videoSkipStep === "30") ? src.videoSkipStep : d.videoSkipStep,
        preloadNextMode: (src.preloadNextMode === "off" || src.preloadNextMode === "on" || src.preloadNextMode === "ultra") ? src.preloadNextMode : d.preloadNextMode,
        videoEndBehavior: (src.videoEndBehavior === "loop" || src.videoEndBehavior === "next" || src.videoEndBehavior === "stop") ? src.videoEndBehavior : d.videoEndBehavior,
        slideshowDefault: (src.slideshowDefault === "cycle" || src.slideshowDefault === "1" || src.slideshowDefault === "3" || src.slideshowDefault === "5" || src.slideshowDefault === "10") ? src.slideshowDefault : d.slideshowDefault,
        hideUnderscoresInNames: (typeof src.hideUnderscoresInNames === "boolean") ? src.hideUnderscoresInNames : d.hideUnderscoresInNames,
        hideBeforeLastDashInFileNames: (typeof src.hideBeforeLastDashInFileNames === "boolean") ? src.hideBeforeLastDashInFileNames : d.hideBeforeLastDashInFileNames,
        hideAfterFirstUnderscoreInFileNames: (typeof src.hideAfterFirstUnderscoreInFileNames === "boolean") ? src.hideAfterFirstUnderscoreInFileNames : d.hideAfterFirstUnderscoreInFileNames,
        forceTitleCaps: (typeof src.forceTitleCaps === "boolean") ? src.forceTitleCaps : d.forceTitleCaps,
        banicOpenWindow: (typeof src.banicOpenWindow === "boolean") ? src.banicOpenWindow : d.banicOpenWindow,
        altGalleryMode: true,
        retroMode: (typeof src.retroMode === "boolean") ? src.retroMode : d.retroMode,
        colorScheme: (src.colorScheme === "classic" || src.colorScheme === "light" || src.colorScheme === "superdark" || src.colorScheme === "synthwave" || src.colorScheme === "verdant" || src.colorScheme === "azure" || src.colorScheme === "ember" || src.colorScheme === "amber" || src.colorScheme === "retro90s" || src.colorScheme === "retro90s-dark") ? src.colorScheme : d.colorScheme,
        treatTagsAsFolders: d.treatTagsAsFolders,
        showHiddenFolder: (typeof src.showHiddenFolder === "boolean") ? src.showHiddenFolder : ((typeof src.treatHiddenAsFolder === "boolean") ? src.treatHiddenAsFolder : d.showHiddenFolder),
        showUntaggedFolder: (typeof src.showUntaggedFolder === "boolean") ? src.showUntaggedFolder : d.showUntaggedFolder,
        showTrashFolder: (typeof src.showTrashFolder === "boolean") ? src.showTrashFolder : d.showTrashFolder,
        showFolderItemCount: (typeof src.showFolderItemCount === "boolean") ? src.showFolderItemCount : d.showFolderItemCount,
        showFolderSize: (typeof src.showFolderSize === "boolean") ? src.showFolderSize : d.showFolderSize,
        showDirFileTypeLabel: (typeof src.showDirFileTypeLabel === "boolean") ? src.showDirFileTypeLabel : d.showDirFileTypeLabel,
        showPreviewFileTypeLabel: (typeof src.showPreviewFileTypeLabel === "boolean") ? src.showPreviewFileTypeLabel : d.showPreviewFileTypeLabel,
        showPreviewFolderItemCount: (typeof src.showPreviewFolderItemCount === "boolean") ? src.showPreviewFolderItemCount : d.showPreviewFolderItemCount,
        showPreviewFileName: (typeof src.showPreviewFileName === "boolean") ? src.showPreviewFileName : d.showPreviewFileName,
        previewThumbFiltersEnabled: (typeof src.previewThumbFiltersEnabled === "boolean") ? src.previewThumbFiltersEnabled : d.previewThumbFiltersEnabled,
        onlineFeaturesEnabled: (typeof src.onlineFeaturesEnabled === "boolean") ? src.onlineFeaturesEnabled : d.onlineFeaturesEnabled,
        hideOptionDescriptions: (typeof src.hideOptionDescriptions === "boolean") ? src.hideOptionDescriptions : d.hideOptionDescriptions,
        hideKeybindDescriptions: (typeof src.hideKeybindDescriptions === "boolean") ? src.hideKeybindDescriptions : d.hideKeybindDescriptions,
        randomActionMode: (src.randomActionMode === "firstFileJump" || src.randomActionMode === "randomFileSort") ? src.randomActionMode : d.randomActionMode,
        leftPaneWidthPct: (function(){
          const v = parseFloat(src.leftPaneWidthPct);
          if (Number.isFinite(v)) return Math.max(0.05, Math.min(0.9, v));
          return 0.28;
        })(),
        /* Media filters: UI */
        mediaFilter: (
  mediaFilterRaw === 'off' ||
  mediaFilterRaw === 'vibrant' ||
  mediaFilterRaw === 'uv' ||
  mediaFilterRaw === 'orangeTeal' ||
  mediaFilterRaw === 'cinematic' ||
  mediaFilterRaw === 'bw' ||
  mediaFilterRaw === 'infrared'
) ? mediaFilterRaw : d.mediaFilter,
        animatedMediaFilters: (typeof src.animatedMediaFilters === "boolean") ? src.animatedMediaFilters : d.animatedMediaFilters,
        crtScanlinesEnabled,
        crtPixelateEnabled,
        crtGrainEnabled,
        crtPixelateResolution,
        crtGrainAmount,
        vhsOverlayEnabled,
        vhsBlurAmount,
        vhsChromaAmount,
        filmCornerOverlayEnabled
    };
      return out;
    }

    const MEDIA_FILTER_STATE = {
      mode: "off",
      animated: true
    };
    let MEDIA_OVERLAY_STATE = null;
    let THUMB_FILTER_KEY = "";

    const MEDIA_FILTER_CONFIGS = {
      vibrant: { color: "saturate(1.45) contrast(1.12) brightness(1.06) hue-rotate(-3deg)" },
      uv: { color: "saturate(1.6) hue-rotate(220deg) contrast(1.3) brightness(0.95)" },
      orangeTeal: { color: "hue-rotate(-22deg) saturate(1.32) contrast(1.12) brightness(1.05)" },
      cinematic: { color: "contrast(1.3) saturate(1.2) brightness(1.02) hue-rotate(-2deg)" },
      bw: { color: "grayscale(1) contrast(1.08)", forceMonochrome: true },
      infrared: { color: "saturate(1.6) hue-rotate(-45deg) contrast(1.3) brightness(1.05)" }
    };

    const CRT_OVERLAY_CONFIG = {
      scanlines: 0.4,
      scanlineBlur: 0.8,
      chroma: 0.7,
      vignette: 0.22,
      jitter: 0.75,
      blur: 0.25,
      grain: 0.06,
      pixelate: 4
    };

    const VHS_OVERLAY_CONFIG = {
      scanlines: 0,
      scanlineBlur: 0,
      chroma: 1.2,
      vignette: 0.08,
      jitter: 0.55,
      blur: 1.2,
      grain: 0.035,
      pixelate: 0
    };

    const FILM_CORNER_CONFIG = {
      cornerRadius: 0.08
    };

    function buildCrtOverlayConfigFromOptions(opt) {
      if (!opt) return null;
      const scanlinesOn = !!opt.crtScanlinesEnabled;
      const pixelateOn = !!opt.crtPixelateEnabled;
      const grainOn = !!opt.crtGrainEnabled;
      const pixelate = pixelateOn ? clampNumber(opt.crtPixelateResolution, 2, 8, CRT_OVERLAY_CONFIG.pixelate) : 0;
      const grain = grainOn ? clampNumber(opt.crtGrainAmount, 0, 0.25, CRT_OVERLAY_CONFIG.grain) : 0;
      const scanlines = scanlinesOn ? CRT_OVERLAY_CONFIG.scanlines : 0;
      if (!scanlines && !pixelate && !grain) return null;
      return {
        scanlines,
        scanlineBlur: scanlinesOn ? CRT_OVERLAY_CONFIG.scanlineBlur : 0,
        chroma: pixelateOn ? CRT_OVERLAY_CONFIG.chroma : 0,
        vignette: pixelateOn ? CRT_OVERLAY_CONFIG.vignette : 0,
        jitter: pixelateOn ? CRT_OVERLAY_CONFIG.jitter : 0,
        blur: pixelateOn ? CRT_OVERLAY_CONFIG.blur : 0,
        grain,
        pixelate
      };
    }

    function buildVhsOverlayConfigFromOptions(opt) {
      if (!opt || !opt.vhsOverlayEnabled) return null;
      const blur = clampNumber(opt.vhsBlurAmount, 0, 3, VHS_OVERLAY_CONFIG.blur);
      const chroma = clampNumber(opt.vhsChromaAmount, 0, 3, VHS_OVERLAY_CONFIG.chroma);
      return Object.assign({}, VHS_OVERLAY_CONFIG, { blur, chroma });
    }

    function buildFilmCornerOverlayConfigFromOptions(opt) {
      if (!opt || !opt.filmCornerOverlayEnabled) return null;
      return { cornerRadius: FILM_CORNER_CONFIG.cornerRadius };
    }

    function mergeOverlayConfigs(a, b) {
      if (!a) return b || null;
      if (!b) return a;
      return {
        scanlines: Math.max(a.scanlines || 0, b.scanlines || 0),
        scanlineBlur: Math.max(a.scanlineBlur || 0, b.scanlineBlur || 0),
        chroma: Math.max(a.chroma || 0, b.chroma || 0),
        vignette: Math.max(a.vignette || 0, b.vignette || 0),
        jitter: Math.max(a.jitter || 0, b.jitter || 0),
        blur: Math.max(a.blur || 0, b.blur || 0),
        grain: Math.max(a.grain || 0, b.grain || 0),
        pixelate: Math.max(a.pixelate || 0, b.pixelate || 0),
        cornerRadius: Math.max(a.cornerRadius || 0, b.cornerRadius || 0)
      };
    }

    function buildMediaOverlayConfigFromOptions(opt) {
      const crt = buildCrtOverlayConfigFromOptions(opt);
      const vhs = buildVhsOverlayConfigFromOptions(opt);
      const film = buildFilmCornerOverlayConfigFromOptions(opt);
      return mergeOverlayConfigs(mergeOverlayConfigs(crt, vhs), film);
    }

    function computeContainRect(srcW, srcH, dstW, dstH) {
      if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, w: dstW, h: dstH };
      const srcRatio = srcW / srcH;
      const dstRatio = dstW / dstH;
      let w = dstW;
      let h = dstH;
      if (srcRatio > dstRatio) {
        h = dstW / srcRatio;
      } else {
        w = dstH * srcRatio;
      }
      const x = (dstW - w) * 0.5;
      const y = (dstH - h) * 0.5;
      return { x, y, w, h };
    }

    function computeCoverRect(srcW, srcH, dstW, dstH) {
      if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, w: dstW, h: dstH };
      const srcRatio = srcW / srcH;
      const dstRatio = dstW / dstH;
      let w = dstW;
      let h = dstH;
      if (srcRatio > dstRatio) {
        w = dstH * srcRatio;
      } else {
        h = dstW / srcRatio;
      }
      const x = (dstW - w) * 0.5;
      const y = (dstH - h) * 0.5;
      return { x, y, w, h };
    }

    function roundedRectPath(ctx, x, y, w, h, r) {
      const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    function applyRoundedCornerMask(ctx, rect, radius) {
      if (!radius) return;
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }

    function getMediaFilterForType() {
      return MEDIA_FILTER_STATE.mode || "off";
    }

    function thumbFiltersEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.previewThumbFiltersEnabled);
    }

    function thumbFiltersActive() {
      return thumbFiltersEnabled() && mediaFilterEnabled();
    }

    function buildThumbFilterKey() {
      if (!thumbFiltersActive()) return "off|none";
      const mode = MEDIA_FILTER_STATE.mode || "off";
      const o = MEDIA_OVERLAY_STATE;
      if (!o) return `${mode}|none`;
      const vals = [
        o.scanlines || 0,
        o.scanlineBlur || 0,
        o.chroma || 0,
        o.vignette || 0,
        o.jitter || 0,
        o.blur || 0,
        o.grain || 0,
        o.pixelate || 0,
        o.cornerRadius || 0
      ];
      return `${mode}|${vals.join(",")}`;
    }

    function crtOverlayEnabled() {
      if (MEDIA_OVERLAY_STATE) return true;
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      MEDIA_OVERLAY_STATE = buildMediaOverlayConfigFromOptions(opt);
      return !!MEDIA_OVERLAY_STATE;
    }

    const THUMB_FILTER_CACHE = {
      noiseCanvas: null,
      noiseCtx: null,
      scanCanvas: null,
      scanPattern: null,
      lastNoise: 0
    };

    function ensureThumbNoiseCanvas() {
      if (!THUMB_FILTER_CACHE.noiseCanvas) {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        THUMB_FILTER_CACHE.noiseCanvas = c;
        THUMB_FILTER_CACHE.noiseCtx = c.getContext("2d");
      }
      return THUMB_FILTER_CACHE.noiseCanvas;
    }

    function updateThumbNoiseCanvas() {
      const c = ensureThumbNoiseCanvas();
      const ctx = THUMB_FILTER_CACHE.noiseCtx;
      const imageData = ctx.createImageData(c.width, c.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      THUMB_FILTER_CACHE.lastNoise = Date.now();
    }

    function ensureThumbScanlinePattern(ctx) {
      if (!THUMB_FILTER_CACHE.scanCanvas) {
        const c = document.createElement("canvas");
        c.width = 2;
        c.height = 4;
        const sctx = c.getContext("2d");
        sctx.fillStyle = "rgba(0,0,0,0.5)";
        sctx.fillRect(0, 0, 2, 3);
        sctx.fillStyle = "rgba(0,0,0,0)";
        sctx.fillRect(0, 3, 2, 1);
        THUMB_FILTER_CACHE.scanCanvas = c;
        THUMB_FILTER_CACHE.scanPattern = null;
      }
      if (!THUMB_FILTER_CACHE.scanPattern || THUMB_FILTER_CACHE.scanPattern._ctx !== ctx) {
        const pattern = ctx.createPattern(THUMB_FILTER_CACHE.scanCanvas, "repeat");
        if (pattern) pattern._ctx = ctx;
        THUMB_FILTER_CACHE.scanPattern = pattern;
      }
      return THUMB_FILTER_CACHE.scanPattern;
    }

    function renderFilteredToCanvas(ctx, source, srcW, srcH, dstW, dstH, mode, cover = true) {
      const allowFilters = thumbFiltersActive();
      const baseCfg = (allowFilters && mode && mode !== "off") ? MEDIA_FILTER_CONFIGS[mode] : null;
      const overlayCfg = allowFilters ? MEDIA_OVERLAY_STATE : null;
      const forceMonochrome = !!(allowFilters && baseCfg && baseCfg.forceMonochrome);
      const cfg = (baseCfg || overlayCfg) ? {
        color: baseCfg && baseCfg.color ? baseCfg.color : "none",
        pixelate: Math.max(baseCfg && baseCfg.pixelate ? baseCfg.pixelate : 0, overlayCfg && overlayCfg.pixelate ? overlayCfg.pixelate : 0),
        blur: Math.max(baseCfg && baseCfg.blur ? baseCfg.blur : 0, overlayCfg && overlayCfg.blur ? overlayCfg.blur : 0),
        chroma: Math.max(baseCfg && baseCfg.chroma ? baseCfg.chroma : 0, overlayCfg && overlayCfg.chroma ? overlayCfg.chroma : 0),
        scanlines: Math.max(baseCfg && baseCfg.scanlines ? baseCfg.scanlines : 0, overlayCfg && overlayCfg.scanlines ? overlayCfg.scanlines : 0),
        scanlineBlur: Math.max(baseCfg && baseCfg.scanlineBlur ? baseCfg.scanlineBlur : 0, overlayCfg && overlayCfg.scanlineBlur ? overlayCfg.scanlineBlur : 0),
        grain: Math.max(baseCfg && baseCfg.grain ? baseCfg.grain : 0, overlayCfg && overlayCfg.grain ? overlayCfg.grain : 0),
        vignette: Math.max(baseCfg && baseCfg.vignette ? baseCfg.vignette : 0, overlayCfg && overlayCfg.vignette ? overlayCfg.vignette : 0),
        cornerRadius: Math.max(baseCfg && baseCfg.cornerRadius ? baseCfg.cornerRadius : 0, overlayCfg && overlayCfg.cornerRadius ? overlayCfg.cornerRadius : 0)
      } : null;
      if (!cfg) {
        const rect = cover ? computeCoverRect(srcW, srcH, dstW, dstH) : computeContainRect(srcW, srcH, dstW, dstH);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dstW, dstH);
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
        return;
      }
      const rect = cover ? computeCoverRect(srcW, srcH, dstW, dstH) : computeContainRect(srcW, srcH, dstW, dstH);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, dstW, dstH);
      const colorFilter = cfg.color && cfg.color !== "none" ? cfg.color : "none";

      if (cfg.pixelate) {
        const scale = Math.max(1.5, cfg.pixelate);
        const smallW = Math.max(1, Math.round(rect.w / scale));
        const smallH = Math.max(1, Math.round(rect.h / scale));
        const off = document.createElement("canvas");
        off.width = smallW;
        off.height = smallH;
        const offctx = off.getContext("2d");
        const smallRect = computeCoverRect(srcW, srcH, smallW, smallH);
        offctx.imageSmoothingEnabled = true;
        offctx.filter = cfg.blur ? `${colorFilter} blur(${cfg.blur}px)` : colorFilter;
        offctx.drawImage(source, smallRect.x, smallRect.y, smallRect.w, smallRect.h);
        ctx.imageSmoothingEnabled = false;
        ctx.filter = "none";
        ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.filter = cfg.blur ? `${colorFilter} blur(${cfg.blur}px)` : colorFilter;
        ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
      }

      if (cfg.chroma && !forceMonochrome) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.18;
        ctx.filter = "none";
        ctx.drawImage(source, rect.x + cfg.chroma, rect.y, rect.w, rect.h);
        ctx.drawImage(source, rect.x - cfg.chroma, rect.y, rect.w, rect.h);
        ctx.restore();
      }

      if (cfg.scanlines) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.globalAlpha = cfg.scanlines;
        const pattern = ensureThumbScanlinePattern(ctx);
        if (pattern) {
          ctx.fillStyle = pattern;
          if (cfg.scanlineBlur) ctx.filter = `blur(${cfg.scanlineBlur}px)`;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        ctx.restore();
      }

      if (cfg.grain) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        if (!THUMB_FILTER_CACHE.lastNoise) updateThumbNoiseCanvas();
        const noiseCanvas = ensureThumbNoiseCanvas();
        const pattern = ctx.createPattern(noiseCanvas, "repeat");
        if (pattern) {
          ctx.globalAlpha = cfg.grain;
          ctx.globalCompositeOperation = "overlay";
          ctx.fillStyle = pattern;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        ctx.restore();
      }

      if (cfg.vignette) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        const cx = rect.x + rect.w * 0.5;
        const cy = rect.y + rect.h * 0.5;
        const g = ctx.createRadialGradient(
          cx,
          cy,
          Math.min(rect.w, rect.h) * 0.2,
          cx,
          cy,
          Math.max(rect.w, rect.h) * 0.7
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${cfg.vignette})`);
        ctx.fillStyle = g;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
      }

      if (cfg.cornerRadius) {
        const radius = Math.max(0, Math.min(rect.w, rect.h) * cfg.cornerRadius);
        applyRoundedCornerMask(ctx, rect, radius);
      }
    }

    const MediaFilterEngine = (() => {
      const surfaces = new Map();
      let rafId = null;
      const noise = { canvas: null, ctx: null, size: 128, lastTime: 0 };
      const scanlines = { canvas: null, pattern: null, lastCtx: null };

      function ensureNoiseCanvas() {
        if (!noise.canvas) {
          noise.canvas = document.createElement("canvas");
          noise.canvas.width = noise.size;
          noise.canvas.height = noise.size;
          noise.ctx = noise.canvas.getContext("2d");
        }
        return noise.canvas;
      }

      function updateNoiseCanvas() {
        ensureNoiseCanvas();
        const ctx = noise.ctx;
        const imageData = ctx.createImageData(noise.size, noise.size);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.floor(Math.random() * 255);
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      function ensureScanlinePattern(ctx) {
        if (!scanlines.canvas) {
          scanlines.canvas = document.createElement("canvas");
          scanlines.canvas.width = 2;
          scanlines.canvas.height = 4;
          const sctx = scanlines.canvas.getContext("2d");
          sctx.fillStyle = "rgba(0,0,0,0.5)";
          sctx.fillRect(0, 0, 2, 3);
          sctx.fillStyle = "rgba(0,0,0,0)";
          sctx.fillRect(0, 3, 2, 1);
        }
        if (scanlines.lastCtx !== ctx) {
          scanlines.pattern = ctx.createPattern(scanlines.canvas, "repeat");
          scanlines.lastCtx = ctx;
        }
        return scanlines.pattern;
      }

      function updateEngineState() {
        const appEl = document.getElementById("app");
        if (!appEl) return;
        const anyDrawn = Array.from(surfaces.values()).some(s => s.active && s.hasDrawn);
        if (anyDrawn) appEl.setAttribute("data-media-filter-engine", "on");
        else appEl.removeAttribute("data-media-filter-engine");
      }

      function ensureSurface(name) {
        if (surfaces.has(name)) return surfaces.get(name);
        const surface = {
          name,
          container: null,
          mediaEl: null,
          type: null,
          filterMode: "off",
          canvas: null,
          ctx: null,
          offscreen: null,
          offctx: null,
          active: false,
          bound: false,
          hasDrawn: false,
          videoFrameActive: false
        };
        surfaces.set(name, surface);
        return surface;
      }

      function ensureCanvas(surface) {
        if (!surface.canvas) {
          surface.canvas = document.createElement("canvas");
          surface.canvas.className = "mediaCanvas";
          surface.canvas.style.display = "none";
        }
        if (!surface.ctx) surface.ctx = surface.canvas.getContext("2d");
        if (!surface.offscreen) surface.offscreen = document.createElement("canvas");
        if (!surface.offctx) surface.offctx = surface.offscreen.getContext("2d");
        if (surface.container && !surface.container.contains(surface.canvas)) {
          surface.container.appendChild(surface.canvas);
        }
      }

      function bindMediaEvents(surface, el) {
        if (!el || surface.mediaEl === el) return;
        if (surface.mediaEl && surface.bound) {
          surface.mediaEl.removeEventListener("loadeddata", requestRender);
          surface.mediaEl.removeEventListener("play", requestRender);
          surface.mediaEl.removeEventListener("pause", requestRender);
          surface.mediaEl.removeEventListener("seeked", requestRender);
        }
        surface.mediaEl = el;
        surface.bound = true;
        el.addEventListener("loadeddata", requestRender);
        el.addEventListener("play", requestRender);
        el.addEventListener("pause", requestRender);
        el.addEventListener("seeked", requestRender);
      }

      function attach(name, mediaEl, container, type, filterMode) {
        const surface = ensureSurface(name);
        surface.container = container;
        surface.type = type;
        surface.filterMode = filterMode || "off";
        surface.active = true;
        surface.hasDrawn = false;
        bindMediaEvents(surface, mediaEl);
        ensureCanvas(surface);
        if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
        if (type === "video" && mediaEl && typeof mediaEl.requestVideoFrameCallback === "function") {
          surface.videoFrameActive = true;
          const onFrame = () => {
            if (!surface.active || !surface.videoFrameActive) return;
            requestRender();
            mediaEl.requestVideoFrameCallback(onFrame);
          };
          mediaEl.requestVideoFrameCallback(onFrame);
        } else {
          surface.videoFrameActive = false;
        }
        requestRender();
        let pulseCount = 0;
        const pulse = () => {
          if (!surface.active) return;
          if (surface.hasDrawn) return;
          pulseCount++;
          requestRender();
          if (pulseCount < 20) requestAnimationFrame(pulse);
        };
        requestAnimationFrame(pulse);
      }

      function detach(name) {
        const surface = surfaces.get(name);
        if (!surface) return;
        surface.active = false;
        surface.hasDrawn = false;
        surface.videoFrameActive = false;
        if (surface.canvas) surface.canvas.style.display = "none";
        updateEngineState();
      }

      function reset(name) {
        const surface = surfaces.get(name);
        if (!surface) return;
        surface.active = false;
        surface.hasDrawn = false;
        surface.videoFrameActive = false;
        if (surface.canvas && surface.canvas.parentElement) {
          surface.canvas.parentElement.removeChild(surface.canvas);
        }
        surface.canvas = null;
        surface.ctx = null;
        surface.offscreen = null;
        surface.offctx = null;
        if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
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

      function drawSurface(surface, time) {
        const mode = surface.filterMode || "off";
        const cfg = (mode && mode !== "off") ? MEDIA_FILTER_CONFIGS[mode] : null;
        const overlayCfg = MEDIA_OVERLAY_STATE;
        if (!cfg && !overlayCfg) {
          if (surface.canvas) surface.canvas.style.display = "none";
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
          return false;
        }
        if (!surface.mediaEl || !surface.container || !surface.canvas || !surface.ctx) return false;

        const el = surface.mediaEl;
        const isVideo = surface.type === "video";
        const ready = isVideo ? (el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0) : (el.complete && el.naturalWidth > 0 && el.naturalHeight > 0);
        if (!ready) return false;

        const cw = surface.container.clientWidth || 0;
        const ch = surface.container.clientHeight || 0;
        if (!cw || !ch) return false;

        const dpr = window.devicePixelRatio || 1;
        const pixelW = Math.max(1, Math.round(cw * dpr));
        const pixelH = Math.max(1, Math.round(ch * dpr));
        if (surface.canvas.width !== pixelW || surface.canvas.height !== pixelH) {
          surface.canvas.width = pixelW;
          surface.canvas.height = pixelH;
        }

        const ctx = surface.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, cw, ch);

        const srcW = isVideo ? el.videoWidth : el.naturalWidth;
        const srcH = isVideo ? el.videoHeight : el.naturalHeight;
        const rect = computeContainRect(srcW, srcH, cw, ch);

        const jitterStrength = Math.max((cfg && cfg.jitter) ? cfg.jitter : 0, (overlayCfg && overlayCfg.jitter) ? overlayCfg.jitter : 0);
        const jitter = jitterStrength ? (MEDIA_FILTER_STATE.animated ? Math.sin(time * 0.005) * jitterStrength : 0) : 0;
        const dx = rect.x + jitter;
        const dy = rect.y;

        const colorFilter = (cfg && cfg.color && cfg.color !== "none") ? cfg.color : "none";
        let drew = false;
        try {
          const pixelateBase = (overlayCfg && overlayCfg.pixelate) ? Math.max(2, overlayCfg.pixelate) : (cfg && cfg.pixelate ? Math.max(2, cfg.pixelate) : 0);
          if (pixelateBase) {
            const scale = pixelateBase;
            const smallW = Math.max(1, Math.round(rect.w / scale));
            const smallH = Math.max(1, Math.round(rect.h / scale));
            surface.offscreen.width = smallW;
            surface.offscreen.height = smallH;
            surface.offctx.setTransform(1, 0, 0, 1, 0, 0);
            surface.offctx.imageSmoothingEnabled = true;
            surface.offctx.clearRect(0, 0, smallW, smallH);
            surface.offctx.filter = "none";
            const blur = overlayCfg && overlayCfg.blur ? overlayCfg.blur : (cfg && cfg.blur ? cfg.blur : 0);
            if (blur) surface.offctx.filter = `blur(${blur}px)`;
            surface.offctx.drawImage(el, 0, 0, smallW, smallH);
            ctx.imageSmoothingEnabled = false;
            ctx.filter = colorFilter;
            ctx.drawImage(surface.offscreen, dx, dy, rect.w, rect.h);
          } else {
            ctx.imageSmoothingEnabled = true;
            const blur = overlayCfg && overlayCfg.blur ? overlayCfg.blur : (cfg && cfg.blur ? cfg.blur : 0);
            ctx.filter = blur ? `${colorFilter} blur(${blur}px)` : colorFilter;
            ctx.drawImage(el, dx, dy, rect.w, rect.h);
          }
          drew = true;
        } catch {
          if (surface.canvas) surface.canvas.style.display = "none";
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
          return false;
        }
        if (!drew) return false;

        const chroma = overlayCfg && overlayCfg.chroma ? overlayCfg.chroma : (cfg && cfg.chroma ? cfg.chroma : 0);
        if (chroma) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.globalAlpha = 0.18;
          ctx.filter = "none";
          ctx.drawImage(el, dx + chroma, dy, rect.w, rect.h);
          ctx.drawImage(el, dx - chroma, dy, rect.w, rect.h);
          ctx.restore();
        }

        const scanlines = overlayCfg && overlayCfg.scanlines ? overlayCfg.scanlines : (cfg && cfg.scanlines ? cfg.scanlines : 0);
        if (scanlines) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          ctx.globalAlpha = scanlines;
          const pattern = ensureScanlinePattern(ctx);
          if (pattern) {
            ctx.fillStyle = pattern;
            const slBlur = overlayCfg && overlayCfg.scanlineBlur ? overlayCfg.scanlineBlur : (cfg && cfg.scanlineBlur ? cfg.scanlineBlur : 0);
            if (slBlur) ctx.filter = `blur(${slBlur}px)`;
            if (MEDIA_FILTER_STATE.animated) {
              ctx.translate(0, (time * 0.015) % 4);
            }
            ctx.fillRect(dx, dy, rect.w, rect.h);
          }
          ctx.restore();
        }

        const grain = overlayCfg && overlayCfg.grain ? overlayCfg.grain : (cfg && cfg.grain ? cfg.grain : 0);
        if (grain) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          const noiseCanvas = ensureNoiseCanvas();
          if (MEDIA_FILTER_STATE.animated) {
            if (time - noise.lastTime > 80) {
              updateNoiseCanvas();
              noise.lastTime = time;
            }
          } else if (!noise.lastTime) {
            updateNoiseCanvas();
            noise.lastTime = time;
          }
          const pattern = ctx.createPattern(noiseCanvas, "repeat");
          if (pattern) {
            ctx.globalAlpha = grain;
            ctx.globalCompositeOperation = "overlay";
            ctx.fillStyle = pattern;
            ctx.fillRect(dx, dy, rect.w, rect.h);
          }
          ctx.restore();
        }

        const vignette = overlayCfg && overlayCfg.vignette ? overlayCfg.vignette : (cfg && cfg.vignette ? cfg.vignette : 0);
        if (vignette) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          const cx = dx + rect.w * 0.5;
          const cy = dy + rect.h * 0.5;
          const g = ctx.createRadialGradient(
            cx,
            cy,
            Math.min(rect.w, rect.h) * 0.2,
            cx,
            cy,
            Math.max(rect.w, rect.h) * 0.7
          );
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, `rgba(0,0,0,${vignette})`);
          ctx.fillStyle = g;
          ctx.fillRect(dx, dy, rect.w, rect.h);
          ctx.restore();
        }

        const cornerRadius = overlayCfg && overlayCfg.cornerRadius ? overlayCfg.cornerRadius : (cfg && cfg.cornerRadius ? cfg.cornerRadius : 0);
        if (cornerRadius) {
          const radius = Math.max(0, Math.min(rect.w, rect.h) * cornerRadius);
          applyRoundedCornerMask(ctx, { x: dx, y: dy, w: rect.w, h: rect.h }, radius);
        }

        surface.canvas.style.display = "block";
        surface.canvas.classList.add("ready");
        surface.hasDrawn = true;
        if (surface.mediaEl) surface.mediaEl.classList.add("mediaHidden");

        const needsAnim = MEDIA_FILTER_STATE.animated && ((cfg && (cfg.grain || cfg.scanlines || cfg.jitter || cfg.chroma)) || (overlayCfg && (overlayCfg.grain || overlayCfg.scanlines || overlayCfg.jitter || overlayCfg.chroma)));
        if (isVideo) {
          if (surface.videoFrameActive) {
            return needsAnim;
          }
          if (!el.paused) return true;
          return needsAnim;
        }
        return needsAnim;
      }

      return {
        attach,
        detach,
        reset,
        requestRender,
        hasSurfaceDrawn: (name) => {
          const surface = surfaces.get(name);
          return !!(surface && surface.hasDrawn);
        }
      };
    })();

    function fileDisplayName(name) {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const parts = splitNameExt(name || "");
      const base = displayName(parts.base || "") || "";
      if (!opt || !opt.hideFileExtensions) return base + (parts.ext || "");
      return base;
    }

    function relPathDisplayName(relPath) {
      const parts = String(relPath || "").split("/").filter(Boolean);
      if (!parts.length) return "";
      const out = parts.map((seg, idx) => {
        if (idx !== parts.length - 1) return displayName(seg || "") || "";
        return fileDisplayName(seg || "") || "";
      });
      return out.join("/") || "";
    }

    function folderScoreDisplayMode() {
      const mode = WS.view && typeof WS.view.folderScoreDisplay === "string" ? WS.view.folderScoreDisplay : "hidden";
      if (mode === "show" || mode === "no-arrows" || mode === "hidden") return mode;
      return "hidden";
    }

    function imageThumbWidthForOption() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const m = opt ? String(opt.imageThumbSize || "medium") : "medium";
      if (m === "tiny") return 120;
      if (m === "small") return 220;
      if (m === "high") return 900;
      return 420;
    }

    function videoThumbWidthForOption() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const m = opt ? String(opt.videoThumbSize || "medium") : "medium";
      if (m === "tiny") return 100;
      if (m === "small") return 180;
      if (m === "high") return 520;
      return 240;
    }

    function setOptionsStatus(text) {
      if (!optionsStatusLabel) return;
      optionsStatusLabel.textContent = text || "—";
    }

    function applyDefaultViewFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      if (!opt) return;
      WS.view.filterMode = "all";
      WS.view.randomMode = false;
      WS.view.folderBehavior = String(opt.defaultFolderBehavior || "slide");
      WS.view.folderScoreDisplay = (opt.folderScoreDisplay === "show" || opt.folderScoreDisplay === "no-arrows" || opt.folderScoreDisplay === "hidden") ? opt.folderScoreDisplay : "hidden";
      applyColorSchemeFromOptions();
    }

    function applyColorSchemeFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const scheme = opt ? String(opt.colorScheme || "classic") : "classic";
      const root = document.documentElement;
      if (!root) return;
      if (scheme === "classic") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", scheme);
    }

    function applyRetroModeFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const on = !!(opt && opt.retroMode);
      if (on) root.setAttribute("data-retro", "on");
      else root.removeAttribute("data-retro");
    }

    function applyMediaFilterFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const prevFilterMode = MEDIA_FILTER_STATE.mode || "off";
      MEDIA_OVERLAY_STATE = buildMediaOverlayConfigFromOptions(opt);
      const appEl = document.getElementById("app");
      if (!appEl) return;
      const filter = opt && opt.mediaFilter ? String(opt.mediaFilter) : "off";
      if (filter && filter !== "off") appEl.setAttribute("data-media-filter", filter);
      else appEl.removeAttribute("data-media-filter");
      const root = document.documentElement;
      if (root) {
        root.style.setProperty("--thumb-filter", "none");
      }
      MEDIA_FILTER_STATE.mode = filter || "off";
      MEDIA_FILTER_STATE.animated = !!(opt && opt.animatedMediaFilters);
      if (prevFilterMode !== MEDIA_FILTER_STATE.mode) {
        MediaFilterEngine.detach("preview");
        MediaFilterEngine.detach("viewer");
      }
      const nextThumbKey = buildThumbFilterKey();
      if (nextThumbKey !== THUMB_FILTER_KEY) {
        THUMB_FILTER_KEY = nextThumbKey;
        if (WS.root) {
          invalidateAllThumbs();
          renderPreviewPane(false, true);
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      }
      const filtersActive = mediaFilterEnabled();
      if (!filtersActive) {
        MediaFilterEngine.reset("preview");
        MediaFilterEngine.reset("viewer");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
        if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
        appEl.removeAttribute("data-media-filter-engine");
      } else {
        if (VIEWER_MODE) {
          if (viewerVideoEl && viewerVideoEl.style.display !== "none") {
            syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video");
          } else if (viewerImgEl && viewerImgEl.style.display !== "none") {
            syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image");
          }
        }
        if (ACTIVE_MEDIA_SURFACE === "preview") {
          if (previewVideoEl && previewVideoEl.style.display !== "none") {
            syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video");
          } else if (previewImgEl && previewImgEl.style.display !== "none") {
            syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image");
          }
        }
      }
      MediaFilterEngine.requestRender();
    }

    function applyThumbFitFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const fit = opt ? String(opt.previewThumbFit || "cover") : "cover";
      const useContain = fit === "contain";
      root.style.setProperty("--thumb-fit", useContain ? "contain" : "cover");
      root.style.setProperty("--thumb-bg", "transparent");
    }

    function mediaFilterEnabled() {
      const mode = getMediaFilterForType();
      return (mode && mode !== "off" && !!MEDIA_FILTER_CONFIGS[mode]) || crtOverlayEnabled();
    }

    function onlineFeaturesEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !(opt && opt.onlineFeaturesEnabled === false);
    }

    function isOnlineFolderNode(node) {
      const kind = node?.onlineMeta?.kind;
      return kind === "profile" || kind === "post";
    }

    function filterOnlineDirs(list) {
      if (onlineFeaturesEnabled()) return list;
      return (list || []).filter(d => !isOnlineFolderNode(d));
    }

    function ensureOnlineVisibilityState() {
      if (onlineFeaturesEnabled()) return;
      if (WS.view.tagFolderActiveMode) {
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderOriginPath = "";
      }
      if (WS.nav && WS.nav.dirNode && isOnlineFolderNode(WS.nav.dirNode)) {
        WS.nav.dirNode = WS.nav.dirNode.parent || WS.root;
      }
    }

    function applyOnlineFeatureVisibility() {
      const enabled = onlineFeaturesEnabled();
      if (onlineProfileRow) onlineProfileRow.style.display = enabled ? "" : "none";
      const onlineTabBtn = menuTabs ? menuTabs.querySelector('.menuTabBtn[data-tab="online"]') : null;
      const responsesTabBtn = menuTabs ? menuTabs.querySelector('.menuTabBtn[data-tab="responses"]') : null;
      if (onlineTabBtn) onlineTabBtn.style.display = enabled ? "" : "none";
      if (responsesTabBtn) responsesTabBtn.style.display = enabled ? "" : "none";
      if (menuTabOnline) menuTabOnline.style.display = enabled ? "" : "none";
      if (menuTabResponses) menuTabResponses.style.display = enabled ? "" : "none";
      if (!enabled) {
        if (MENU_ACTIVE_TAB === "online" || MENU_ACTIVE_TAB === "responses") setMenuTab("options");
        if (MENU_LAST_TAB === "online" || MENU_LAST_TAB === "responses") MENU_LAST_TAB = "options";
      }
    }

    function syncMediaFilterSurface(surfaceName, mediaEl, container, type) {
      if (!mediaEl || !container) return;
      if (!mediaFilterEnabled()) {
        mediaEl.classList.remove("mediaHidden");
        MediaFilterEngine.detach(surfaceName);
        return;
      }
      MediaFilterEngine.attach(surfaceName, mediaEl, container, type, getMediaFilterForType());
    }

    function clearMediaFilterSurface(surfaceName, mediaEl) {
      MediaFilterEngine.detach(surfaceName);
      if (mediaEl) mediaEl.classList.remove("mediaHidden");
    }

    function applyDisplaySizesFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const mediaSize = opt ? String(opt.mediaThumbUiSize || "medium") : "medium";
      const folderSize = opt ? String(opt.folderPreviewSize || "medium") : "medium";
      if (mediaSize === "medium") root.removeAttribute("data-media-size");
      else root.setAttribute("data-media-size", mediaSize);
      if (folderSize === "medium") root.removeAttribute("data-folder-size");
      else root.setAttribute("data-folder-size", folderSize);
    }

    function applyOptionsEverywhere(invalidateThumbs = false) {
      if (!WS.root) {
        applyColorSchemeFromOptions();
        applyRetroModeFromOptions();
        applyMediaFilterFromOptions();
        applyThumbFitFromOptions();
        applyDisplaySizesFromOptions();
        applyDescriptionVisibilityFromOptions();
        applyPaneDividerFromOptions();
        applyOnlineFeatureVisibility();
        syncButtons();
        return;
      }

      if (invalidateThumbs) {
        invalidateAllThumbs();
      }

      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      ensureOnlineVisibilityState();
      applyDescriptionVisibilityFromOptions();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      applyPaneDividerFromOptions();
      applyMediaFilterFromOptions();
      applyOnlineFeatureVisibility();
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      else if (ACTIVE_MEDIA_SURFACE === "preview") renderPreviewViewerItem(viewerIndex);
    }

    function applyDescriptionVisibilityFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const hideOptionDescriptions = !!(opt && opt.hideOptionDescriptions);
      const hideKeybindDescriptions = !!(opt && opt.hideKeybindDescriptions);
      const optionsBody = document.getElementById("optionsBody");
      const keybindsBody = document.getElementById("keybindsBody");
      if (optionsBody) optionsBody.classList.toggle("hideHints", hideOptionDescriptions);
      if (keybindsBody) keybindsBody.classList.toggle("hideHints", hideKeybindDescriptions);
    }

    function applyPaneDividerFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const pct = (opt && typeof opt.leftPaneWidthPct === 'number') ? opt.leftPaneWidthPct : (opt && !Number.isNaN(parseFloat(opt.leftPaneWidthPct)) ? parseFloat(opt.leftPaneWidthPct) : 0.28);
      setDividerPositionFromPct(pct);
    }

    function setDividerPositionFromPct(pct) {
      pct = Math.max(0.05, Math.min(0.9, Number(pct) || 0.28));
      const appEl = document.getElementById("app");
      if (!appEl) return;
      appEl.style.gridTemplateColumns = `${(pct * 100).toFixed(2)}% 1fr`;
      const dividerEl = document.getElementById("divider");
      if (dividerEl) {
        const left = Math.round(appEl.clientWidth * pct);
        dividerEl.style.left = left + "px";
      }
    }

    const SAFE_KEY_VALUES = (() => {
      const out = [];
      for (let i = 0; i < 26; i++) out.push(String.fromCharCode(97 + i));
      for (let i = 0; i < 10; i++) out.push(String(i));
      out.push("Space");
      return out;
    })();

    const SAFE_KEY_SET = new Set(SAFE_KEY_VALUES);

    const KEY_LABELS = {
      Escape: "Escape",
      Space: "Space"
    };

    function normalizeKeyValue(key) {
      if (!key) return "";
      if (key === " ") return "Space";
      if (key.length === 1) return key.toLowerCase();
      return key;
    }

    function isSafeKey(key) {
      const norm = normalizeKeyValue(key);
      return SAFE_KEY_SET.has(norm);
    }

    function keyLabel(key) {
      if (!key) return "Unassigned";
      const norm = normalizeKeyValue(key);
      if (KEY_LABELS[norm]) return KEY_LABELS[norm];
      if (norm.length === 1) return norm.toUpperCase();
      return norm;
    }

    const KEYBIND_SECTIONS = [
      { id: "navigation", label: "Navigation" },
      { id: "media", label: "Media" },
      { id: "jump", label: "Jump" },
      { id: "history", label: "History" },
      { id: "global", label: "Global" },
      { id: "extras", label: "Odds & Ends" }
    ];

    const KEYBIND_ACTIONS = [
      { id: "selectUp", label: "Up selection", hint: "Move selection up.", section: "navigation" },
      { id: "selectDown", label: "Down selection", hint: "Move selection down.", section: "navigation" },
      { id: "leaveDir", label: "Up directory", hint: "Go to the parent directory.", section: "navigation" },
      { id: "enterDir", label: "Enter directory", hint: "Enter a folder or open gallery for a file.", section: "navigation" },
      { id: "prevFolder", label: "Previous folder", hint: "Jump to the previous folder's first file.", section: "navigation" },
      { id: "nextFolder", label: "Next folder", hint: "Jump to the next folder's first file.", section: "navigation" },
      { id: "randomJump", label: "Random action", hint: "Run the configured random action behavior.", section: "navigation" },
      { id: "cycleFilter", label: "Cycle filter", hint: "Cycle the content filter.", section: "navigation" },
      { id: "slideshow", label: "Slideshow mode", hint: "Toggle slideshow.", section: "media" },
      { id: "seekBack", label: "Video skip backward", hint: "Seek video backward.", section: "media" },
      { id: "seekForward", label: "Video skip forward", hint: "Seek video forward.", section: "media" },
      { id: "playPause", label: "Pause/Play video", hint: "Toggle video playback.", section: "media" },
      { id: "muteToggle", label: "Mute/Unmute video", hint: "Toggle video mute.", section: "media" },
      { id: "jumpMinus50", label: "-50 items", hint: "Move selection up by 50 items.", section: "jump" },
      { id: "jumpMinus10", label: "-10 items", hint: "Move selection up by 10 items.", section: "jump" },
      { id: "jumpPlus10", label: "+10 items", hint: "Move selection down by 10 items.", section: "jump" },
      { id: "jumpPlus50", label: "+50 items", hint: "Move selection down by 50 items.", section: "jump" },
      { id: "historyBack", label: "History back", hint: "Go to the previous directory in history.", section: "history" },
      { id: "historyForward", label: "History forward", hint: "Go to the next directory in history.", section: "history" },
      { id: "panic", label: "PANIC!", hint: "Toggle the decoy window mode.", section: "global" },
      { id: "back", label: "Back/Close", hint: "Close overlays or back out of special modes.", section: "global" },
      { id: "cycleMediaFilter", label: "Cycle media filter", hint: "Cycle the media filter preset.", section: "extras" },
      { id: "cycleColorScheme", label: "Cycle color scheme", hint: "Cycle the UI color scheme.", section: "extras" },
      { id: "toggleRetroMode", label: "Toggle retro mode", hint: "Toggle the retro UI styling.", section: "extras" },
      { id: "toggleScanlinesOverlay", label: "Toggle scanline overlay", hint: "Toggle CRT scanlines over media.", section: "extras" },
      { id: "togglePixelatedOverlay", label: "Toggle pixelated overlay", hint: "Toggle pixelated media overlay.", section: "extras" },
      { id: "toggleFilmGrainOverlay", label: "Toggle film grain overlay", hint: "Toggle film grain overlay.", section: "extras" },
      { id: "toggleVhsOverlay", label: "Toggle VHS overlay", hint: "Toggle VHS overlay.", section: "extras" },
      { id: "toggleFilmCornersOverlay", label: "Toggle film corners overlay", hint: "Toggle rounded film corners overlay.", section: "extras" },
      { id: "toggleAnimatedFilters", label: "Toggle animated filters", hint: "Toggle animated scanlines/grain/jitter.", section: "extras" },
      { id: "cycleFolderSort", label: "Cycle folder sort", hint: "Cycle folder sort mode.", section: "extras" },
      { id: "cycleFolderBehavior", label: "Cycle folder behavior", hint: "Cycle folder behavior between stop/loop/slide.", section: "extras" },
      { id: "cycleVideoEndBehavior", label: "Cycle video end behavior", hint: "Cycle behavior when videos end.", section: "extras" },
      { id: "toggleShowHiddenFolder", label: "Toggle hidden folder", hint: "Toggle the Hidden folder tag entry.", section: "extras" },
      { id: "toggleShowUntaggedFolder", label: "Toggle untagged folder", hint: "Toggle the Untagged folder tag entry.", section: "extras" },
      { id: "toggleShowPreviewFileName", label: "Toggle preview file names", hint: "Toggle file names under preview thumbnails.", section: "extras" },
      { id: "toggleShowPreviewFileType", label: "Toggle preview file type labels", hint: "Toggle Image/Video labels under thumbnails.", section: "extras" },
      { id: "toggleShowPreviewFolderCounts", label: "Toggle preview folder counts", hint: "Toggle item counts on preview folder cards.", section: "extras" },
      { id: "toggleShowFolderItemCounts", label: "Toggle folder item counts", hint: "Toggle item counts in the directories pane.", section: "extras" },
      { id: "toggleShowDirFileTypeLabel", label: "Toggle directory file type labels", hint: "Toggle Image/Video labels in the directories pane.", section: "extras" },
      { id: "toggleHideFileExtensions", label: "Toggle hide file extensions", hint: "Toggle display of file extensions.", section: "extras" },
      { id: "toggleHideUnderscores", label: "Toggle hide underscores", hint: "Toggle replacing underscores in display names.", section: "extras" },
      { id: "scoreUpSelection", label: "Increase folder score", hint: "Increase score for selected/current folder(s).", section: "extras" },
      { id: "scoreDownSelection", label: "Decrease folder score", hint: "Decrease score for selected/current folder(s).", section: "extras" },
      { id: "tagSelection", label: "Tag folder selection", hint: "Start tag edit for selected/current folder(s).", section: "extras" },
      { id: "favoriteSelection", label: "Favorite folder selection", hint: "Favorite or unfavorite selected/current folder(s).", section: "extras" },
      { id: "renameFolderSelection", label: "Rename selected folder", hint: "Start renaming the selected/current folder.", section: "extras" },
      { id: "renameFileSelection", label: "Rename selected file", hint: "Start renaming the selected/current file.", section: "extras" }
    ];

    const KEYBIND_PRESETS = {
      right: {
        label: "Right-handed (WASD)",
        bindings: {
          selectUp: "w",
          selectDown: "s",
          leaveDir: "a",
          enterDir: "d",
          prevFolder: "b",
          nextFolder: "x",
          randomJump: "r",
          cycleFilter: "f",
          slideshow: "v",
          seekBack: "z",
          seekForward: "c",
          playPause: "Space",
          muteToggle: "m",
          jumpMinus50: "1",
          jumpMinus10: "2",
          jumpPlus10: "3",
          jumpPlus50: "4",
          historyBack: "q",
          historyForward: "e",
          panic: "g",
          back: "Escape"
        }
      },
      left: {
        label: "Left-handed (IJKL)",
        bindings: {
          selectUp: "i",
          selectDown: "k",
          leaveDir: "j",
          enterDir: "l",
          prevFolder: "h",
          nextFolder: "n",
          randomJump: "y",
          cycleFilter: "t",
          slideshow: "b",
          seekBack: "u",
          seekForward: "o",
          playPause: "Space",
          muteToggle: "g",
          jumpMinus50: "7",
          jumpMinus10: "8",
          jumpPlus10: "9",
          jumpPlus50: "0",
          historyBack: "p",
          historyForward: "m",
          panic: "v",
          back: "Escape"
        }
      }
    };

    function defaultKeybinds(presetId) {
      const preset = KEYBIND_PRESETS[presetId] || KEYBIND_PRESETS.right;
      return KEYBIND_ACTIONS.map(def => {
        const key = preset.bindings[def.id] || "";
        return Object.assign({}, def, { key: normalizeKeyValue(key) });
      });
    }

    function enforceUniqueKeybinds(bindings) {
      const used = new Set();
      bindings.forEach((binding) => {
        const key = normalizeKeyValue(binding.key);
        if (!key) { binding.key = ""; return; }
        if (used.has(key)) {
          binding.key = "";
          return;
        }
        used.add(key);
        binding.key = key;
      });
    }

    function normalizeKeybinds(log) {
      const presetId = (log && log.preset && KEYBIND_PRESETS[log.preset]) ? log.preset : "right";
      const bindings = defaultKeybinds(presetId);
      const byId = new Map(bindings.map(b => [b.id, b]));
      if (log && Array.isArray(log.bindings)) {
        for (const entry of log.bindings) {
          if (!entry || !entry.id || !byId.has(entry.id)) continue;
          const key = normalizeKeyValue(entry.key || "");
          if (key && !isSafeKey(key) && !(entry.id === "back" && key === "Escape")) continue;
          byId.get(entry.id).key = key;
        }
      }
      enforceUniqueKeybinds(bindings);
      return { bindings, presetId };
    }

    const KEYBIND_INDEX = new Map();

    function rebuildKeybindIndex() {
      KEYBIND_INDEX.clear();
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds("right");
      for (const binding of bindings) {
        const key = normalizeKeyValue(binding.key);
        if (!key || KEYBIND_INDEX.has(key)) continue;
        KEYBIND_INDEX.set(key, binding.id);
      }
    }

    function keybindActionFor(key) {
      return KEYBIND_INDEX.get(key) || null;
    }

    const WS = {
      root: null,
      fileById: new Map(),   // id -> FileRecord
      dirByPath: new Map(),  // path -> DirNode

      meta: {
        dirScores: new Map(),
        dirTags: new Map(),
        pendingTagsByPath: new Map(),
        dirFingerprints: new Map(),
        dirSortMode: "name",
        storageMode: "local",
        storageKey: "",
        fsRootHandle: null,
        fsSysDirHandle: null,
        fsSiteLogDirHandle: null,
        fsSiteLogProfilesDirHandle: null,
        fsSiteLogIndexHandle: null,
        fsSiteLogRenamesHandle: null,
        fsScoresFileHandle: null,
        fsTagsFileHandle: null,
        fsOptionsFileHandle: null,
        fsLegacyFileHandle: null,
        fsKeybindsFileHandle: null,
        fsTrashIndexFileHandle: null,
        trashOriginsByName: new Map(),
        trashVirtualDirs: [],
        saveTimer: null,
        dirty: false,
        options: normalizeOptions(null),
        keybinds: defaultKeybinds("right"),
        keybindsPreset: "right"
      },

      view: {
        filterMode: "all",
        randomMode: false,
        loopWithinDir: false,
        folderBehavior: "slide",
        folderScoreDisplay: "hidden",
        randomSeed: 0,
        randomCache: new Map(),
        dirLoopRepeats: 3,
        previewLoopRepeats: 3,
        loopMaxRepeats: 200,
        slideshowDurations: [0, 1000, 3000, 5000, 10000],
        slideshowModeIndex: 0,
        slideshowActive: false,
        slideshowTimer: null,
        statusTimeout: null,
        scrollBusyDirs: false,
        scrollBusyPreview: false,
        pendingDirScroll: "",
        bulkSelectMode: false,
        bulkTagSelectedPaths: new Set(),
        bulkTagSelectionsByDir: new Map(),
        bulkFileSelectedIds: new Set(),
        bulkFileSelectionsByDir: new Map(),
        bulkActionMenuOpen: false,
        bulkActionMenuAnchorPath: "",
        dirActionMenuPath: "",
        tagFolderActiveMode: "",
        tagFolderActiveTag: "",
        tagFolderOriginPath: "",
        tagNavStack: [],
        dirSearchPinned: false,
        dirSearchQuery: "",
        dirHistory: [],
        dirHistoryIndex: -1,
        dirSelectAnchorIndex: -1,
        fileActionMenuId: "",
        favoritesMode: false,
        favoritesRootActive: false,
        favoritesAnchorPath: "",
        favoritesReturnState: null,
        hiddenMode: false,
        hiddenRootActive: false,
        hiddenAnchorPath: "",
        hiddenReturnState: null,
        searchRootActive: false,
        searchRootPath: "",
        searchAnchorPath: "",
        searchEntryRootPath: "",
        searchRootIsFavorites: false,
        searchRootFavorites: [],
        searchRootIsHidden: false,
        searchRootHidden: [],
        searchResults: []
      },

      // Directories Pane navigation state
      nav: {
        dirNode: null,       // current directory listed in Directories Pane
        entries: [],         // [{kind:"dir", node},{kind:"file", id}]
        selectedIndex: 0
      },

      // Preview target derived from Directories selection
      preview: {
        kind: null,          // "dir"|"file"|null
        dirNode: null,
        fileId: null
      },

      // video thumbs
      videoThumbQueue: [],
      videoThumbActive: 0,

      // image thumbs
      imageThumbQueue: [],
      imageThumbActive: 0
    };

    /* FileRecord:
       {
         id, file, name, relPath, dirPath, ext, type,
         size, lastModified,
         url, thumbUrl, videoThumbUrl,
         indices
       }
    */

    function revokeAllObjectURLs() {
      for (const it of WS.fileById.values()) {
        try { if (it.url) URL.revokeObjectURL(it.url); } catch {}
        try { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); } catch {}
        try { if (it.videoThumbUrl) URL.revokeObjectURL(it.videoThumbUrl); } catch {}
        it.url = null;
        it.thumbUrl = null;
        it.videoThumbUrl = null;
        it.thumbMode = null;
        it.videoThumbMode = null;
      }
    }

    function resetWorkspace() {
      revokeAllObjectURLs();
      WS.root = null;
      WS.fileById.clear();
      WS.dirByPath.clear();
      DIR_HANDLE_CACHE = new Map();

      WS.meta.dirScores.clear();
      WS.meta.dirTags.clear();
      WS.meta.pendingTagsByPath.clear();
      WS.meta.dirFingerprints.clear();
      WS.meta.dirSortMode = "name";
      WS.meta.storageMode = "local";
      WS.meta.storageKey = "";
      WS.meta.fsRootHandle = null;
      WS.meta.fsSysDirHandle = null;
      WS.meta.fsSiteLogDirHandle = null;
      WS.meta.fsSiteLogProfilesDirHandle = null;
      WS.meta.fsSiteLogIndexHandle = null;
      WS.meta.fsSiteLogRenamesHandle = null;
      WS.meta.fsScoresFileHandle = null;
      WS.meta.fsTagsFileHandle = null;
      WS.meta.fsOptionsFileHandle = null;
      WS.meta.fsLegacyFileHandle = null;
      WS.meta.fsKeybindsFileHandle = null;
      WS.meta.fsTrashIndexFileHandle = null;
      WS.meta.trashOriginsByName = new Map();
      WS.meta.trashVirtualDirs = [];
      WS.meta.dirty = false;
      WS.meta.options = normalizeOptions(null);
      WS.meta.keybinds = defaultKeybinds("right");
      WS.meta.keybindsPreset = "right";
      if (WS.meta.saveTimer) { clearTimeout(WS.meta.saveTimer); WS.meta.saveTimer = null; }

      applyDefaultViewFromOptions();
      rebuildKeybindIndex();
      WS.view.loopWithinDir = false;
      WS.view.randomSeed = 0;
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;
      WS.view.slideshowModeIndex = 0;
      WS.view.slideshowActive = false;
      WS.view.bulkSelectMode = false;
      WS.view.bulkTagSelectedPaths = new Set();
      WS.view.bulkTagSelectionsByDir = new Map();
      WS.view.bulkFileSelectedIds = new Set();
      WS.view.bulkFileSelectionsByDir = new Map();
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      WS.view.tagNavStack = [];
      WS.view.dirSearchPinned = false;
      WS.view.dirSearchQuery = "";
      WS.view.dirHistory = [];
      WS.view.dirHistoryIndex = -1;
      WS.view.dirSelectAnchorIndex = -1;
      WS.view.fileActionMenuId = "";
      WS.view.favoritesMode = false;
      WS.view.favoritesRootActive = false;
      WS.view.favoritesAnchorPath = "";
      WS.view.favoritesReturnState = null;
      WS.view.hiddenMode = false;
      WS.view.hiddenRootActive = false;
      WS.view.hiddenAnchorPath = "";
      WS.view.hiddenReturnState = null;
      WS.view.searchRootActive = false;
      WS.view.searchRootPath = "";
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      WS.view.searchRootIsFavorites = false;
      WS.view.searchRootFavorites = [];
      WS.view.searchRootIsHidden = false;
      WS.view.searchRootHidden = [];
      WS.view.searchResults = [];
      if (WS.view.slideshowTimer) { clearInterval(WS.view.slideshowTimer); WS.view.slideshowTimer = null; }
      if (WS.view.statusTimeout) { clearTimeout(WS.view.statusTimeout); WS.view.statusTimeout = null; }

      WS.nav.dirNode = null;
      WS.nav.entries = [];
      WS.nav.selectedIndex = 0;

      WS.preview.kind = null;
      WS.preview.dirNode = null;
      WS.preview.fileId = null;

      WS.videoThumbQueue = [];
      WS.videoThumbActive = 0;

      WS.imageThumbQueue = [];
      WS.imageThumbActive = 0;
      PRELOAD_CACHE = new Map();
      ONLINE_RENAME_MAP.profiles = {};
      ONLINE_RENAME_MAP.posts = {};
      ONLINE_RENAME_MAP.files = {};
      resetOnlineMaterializedMap(null);
      ONLINE_DOWNLOAD_JOBS.clear();
      ONLINE_PRELOAD_CACHE.clear();
      ONLINE_PROFILE_CACHE.clear();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      syncMetaButtons();
      renderOptionsUi();
    }

    function clearWorkspaceEmptyState() {
      if (directoriesListEl) directoriesListEl.innerHTML = "";
      if (previewBodyEl) previewBodyEl.innerHTML = "";
    }

    /* =========================================================
       UI references
       ========================================================= */

    const $ = (id) => document.getElementById(id);

    // Title Pane
    const optionsBtn = $("optionsBtn");
    const refreshBtn = $("refreshBtn");
    const openWritableBtn = $("openWritableBtn");
    const titleLabel = $("titleLabel");
    const onlineProfileRow = $("onlineProfileRow");
    const onlineProfileInput = $("onlineProfileInput");
    const onlineProfileAddProfileBtn = $("onlineProfileAddProfileBtn");
    const onlineProfileAddPostsBtn = $("onlineProfileAddPostsBtn");
    const onlineProfileStatus = $("onlineProfileStatus");

    // Menu Overlay
    const menuOverlay = $("menuOverlay");
    const menuCard = $("menuCard");
    const menuHeader = $("menuHeader");
    const menuTabs = $("menuTabs");
    const menuCloseBtn = $("menuCloseBtn");
    const menuTabOptions = $("menuTabOptions");
    const menuTabOnline = $("menuTabOnline");
    const menuTabResponses = $("menuTabResponses");
    const menuTabKeybinds = $("menuTabKeybinds");

    const optionsBodyEl = $("optionsBody");
    const onlineBodyEl = $("onlineBody");
    const responsesBodyEl = $("responsesBody");
    const optionsResetBtn = $("optionsResetBtn");
    const optionsDoneBtn = $("optionsDoneBtn");
    const optionsStatusLabel = $("optionsStatusLabel");

    // Keybinds Panel
    const keybindsBodyEl = $("keybindsBody");
    const keybindsResetBtn = $("keybindsResetBtn");
    const keybindsDoneBtn = $("keybindsDoneBtn");
    const keybindsStatusLabel = $("keybindsStatusLabel");

    const overlayWindowStates = {
      menu: { x: null, y: null, width: null, height: null }
    };
    const overlayCards = {
      menu: menuCard
    };
    const overlayCardHeaders = {
      menu: menuHeader
    };
    const overlayWindowNames = Object.keys(overlayWindowStates);
    const overlayResizeObserver = (typeof ResizeObserver === "function") ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const name = entry.target.dataset.overlayName;
        const state = overlayWindowStates[name];
        if (!state) continue;
        const width = entry.contentRect.width || state.width || (entry.target.offsetWidth || 0);
        const height = entry.contentRect.height || state.height || (entry.target.offsetHeight || 0);
        if (!width || !height) continue;
        state.width = width;
        state.height = height;
        clampOverlayWindowPosition(name, state.x, state.y);
      }
    }) : null;

    function clampOverlayWindowPosition(name, desiredX, desiredY) {
      const card = overlayCards[name];
      const state = overlayWindowStates[name];
      if (!card || !state) return;
      const rect = card.getBoundingClientRect();
      const width = rect.width || state.width || card.offsetWidth || 0;
      const height = rect.height || state.height || card.offsetHeight || 0;
      if (!width || !height) return;
      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - height - 8);
      let x = (typeof desiredX === "number") ? desiredX : (typeof state.x === "number" ? state.x : (window.innerWidth - width) / 2);
      let y = (typeof desiredY === "number") ? desiredY : (typeof state.y === "number" ? state.y : (window.innerHeight - height) / 2);
      x = Math.min(maxX, Math.max(8, x));
      y = Math.min(maxY, Math.max(8, y));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      state.x = x;
      state.y = y;
      state.width = width;
      state.height = height;
    }

    function applyOverlayWindowState(name) {
      const card = overlayCards[name];
      const state = overlayWindowStates[name];
      if (!card || !state) return;
      if (state.width) card.style.width = `${state.width}px`;
      else card.style.removeProperty("width");
      if (state.height) card.style.height = `${state.height}px`;
      else card.style.removeProperty("height");
      clampOverlayWindowPosition(name);
    }

    function registerOverlayWindow(name, card, header) {
      if (!card) return;
      card.dataset.overlayName = name;
      if (overlayResizeObserver) overlayResizeObserver.observe(card);

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let activePointerId = null;

      const onPointerMove = (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const rect = card.getBoundingClientRect();
        const nextX = rect.left + (ev.clientX - lastX);
        const nextY = rect.top + (ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
        clampOverlayWindowPosition(name, nextX, nextY);
      };

      const stopDrag = () => {
        if (!dragging) return;
        dragging = false;
        if (header && activePointerId !== null) {
          try { header.releasePointerCapture(activePointerId); } catch (e) {}
        }
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", stopDrag);
        document.removeEventListener("pointercancel", stopDrag);
        card.classList.remove("overlayCardDragging");
        activePointerId = null;
      };

      if (header) {
        header.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          if (ev.target && ev.target.closest && ev.target.closest("button")) return;
          ev.preventDefault();
          dragging = true;
          lastX = ev.clientX;
          lastY = ev.clientY;
          activePointerId = ev.pointerId;
          try { header.setPointerCapture(activePointerId); } catch (e) {}
          document.addEventListener("pointermove", onPointerMove);
          document.addEventListener("pointerup", stopDrag);
          document.addEventListener("pointercancel", stopDrag);
          card.classList.add("overlayCardDragging");
        });
      }
    }

    overlayWindowNames.forEach((name) => {
      registerOverlayWindow(name, overlayCards[name], overlayCardHeaders[name]);
    });

    window.addEventListener("resize", () => {
      overlayWindowNames.forEach((name) => applyOverlayWindowState(name));
    });

    // Directories Pane
    const directoriesListEl = $("directoriesList");
    const directoriesHeader = $("directoriesHeader");
    const favoritesBtn = $("favoritesBtn");
    const hiddenBtn = $("hiddenBtn");
    const directoriesTagsRowEl = $("directoriesTagsRow");
    const directoriesActionRowEl = $("directoriesActionRow");
    const directoriesSelectAllBtn = $("directoriesSelectAllBtn");
    const directoriesActionMenuEl = $("directoriesActionMenu");
    const directoriesBulkRowEl = $("directoriesBulkRow");
    const directoriesSearchInput = $("directoriesSearchInput");
    const directoriesSearchClearBtn = $("directoriesSearchClearBtn");
    const tagActionMenuEl = $("tagActionMenu");
    if (tagActionMenuEl) {
      tagActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
    }
    const dirBackBtn = $("dirBackBtn");
    const dirForwardBtn = $("dirForwardBtn");
    const dirUpBtn = $("dirUpBtn");
    const busyOverlay = $("busyOverlay");
    const busyLabel = $("busyLabel");

    // Preview Pane
    const modePill = $("modePill");
    const itemsPill = $("itemsPill");
    const previewBodyEl = $("previewBody");
    const previewActionMenuEl = $("previewActionMenu");
    if (previewActionMenuEl) {
      previewActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
    }

    /* Gallery Mode (Overlay) */
    const overlay = $("overlay");
    const viewport = $("viewerViewport");
    const closeBtn = $("closeBtn");
    const filenameEl = $("filename");

    const statusMessageEl = document.createElement("div");
    statusMessageEl.id = "statusMessage";
    overlay.appendChild(statusMessageEl);

    const mainStatusMessageEl = document.createElement("div");
    mainStatusMessageEl.id = "mainStatusMessage";
    document.body.appendChild(mainStatusMessageEl);

    const banicOverlayEl = document.createElement("div");
    banicOverlayEl.id = "banicOverlay";
    document.body.appendChild(banicOverlayEl);

    let VIEWER_MODE = false;
    let viewerDirNode = null;
    let viewerItems = []; // { isFolder, dirNode } or { isFolder:false, id }
    let viewerIndex = 0;
    let uiHideTimer = null;
    let globalCursorHideTimer = null;

    let viewerImgEl = null;
    let viewerVideoEl = null;
    let viewerFolderEl = null;

    let DIR_HANDLE_CACHE = new Map();

    let previewViewportBox = null;
    let previewImgEl = null;
    let previewVideoEl = null;
    let previewFolderEl = null;

    // Divider setup: attach drag handlers and initialize position
    (function setupDivider() {
      const appEl = document.getElementById("app");
      const divider = document.getElementById("divider");
      if (!appEl || !divider) return;

      let dragging = false;
      let activePointerId = null;

      function onMoveClientX(clientX) {
        const rect = appEl.getBoundingClientRect();
        const min = Math.max(180, Math.round(rect.width * 0.12));
        const max = Math.max(min + 50, rect.width - 200);
        let left = Math.min(Math.max(clientX - rect.left, min), max);
        const pct = left / rect.width;
        if (!WS.meta.options || typeof WS.meta.options !== "object") WS.meta.options = normalizeOptions(null);
        WS.meta.options.leftPaneWidthPct = pct;
        WS.meta.dirty = true;
        if (typeof metaScheduleSave === "function") metaScheduleSave();
        setDividerPositionFromPct(pct);
      }

      divider.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        dragging = true;
        activePointerId = ev.pointerId;
        try { divider.setPointerCapture(activePointerId); } catch (e) {}
      });

      document.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        onMoveClientX(ev.clientX);
      });

      document.addEventListener('pointerup', (ev) => {
        if (!dragging) return;
        dragging = false;
        try { divider.releasePointerCapture(activePointerId); } catch (e) {}
        activePointerId = null;
        if (typeof metaScheduleSave === 'function') metaScheduleSave();
      });

      window.addEventListener('resize', () => { applyPaneDividerFromOptions(); });

      // initial apply from saved options
      applyPaneDividerFromOptions();
      applyMediaFilterFromOptions();
    })();

    let MAIN_STATUS_TIMEOUT = null;

    let ACTIVE_MEDIA_SURFACE = "none";

    let PREVIEW_VIDEO_PAUSE = { active: false, fileId: null, time: 0, wasPlaying: false };

    let VIDEO_CARRY = { active: false, fileId: null, time: 0, wasPlaying: false };

    let PRELOAD_CACHE = new Map();

    const BLACK_POSTER_URL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='black'/></svg>";

    let TAG_EDIT_PATH = null;
    let TAG_CONTEXT_MENU_STATE = null;
    let PREVIEW_CONTEXT_MENU_STATE = null;
    let TAG_ENTRY_RENAME_STATE = null;
    let BULK_TAG_PLACEHOLDER = null;
    let RENAME_EDIT_PATH = null;
    let RENAME_EDIT_FILE_ID = null;
    let RENAME_BUSY = false;

    let MENU_OPEN = false;
    let MENU_ACTIVE_TAB = "options";
    let MENU_LAST_TAB = "options";
    let MENU_HAS_OPENED = false;
    const MENU_TAB_SCROLL = { options: 0, online: 0, responses: 0, keybinds: 0 };
    let PROPERTIES_OPEN = false;

    let BANIC_ACTIVE = false;
    let BANIC_STATE = { preview: null, viewer: null, slideshowWasActive: false };
    const BANIC_LINKS = [
      "https://www.youtube.com/",
      "https://www.google.com/",
      "https://www.coolmathgames.com/",
      "https://www.wikipedia.org/",
      "https://www.nasa.gov/"
    ];

    /* =========================================================
       Status/progress helpers
       ========================================================= */

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    function showMainStatusMessage(text) {
      mainStatusMessageEl.textContent = text || "";
      mainStatusMessageEl.classList.add("visible");
      if (MAIN_STATUS_TIMEOUT) { clearTimeout(MAIN_STATUS_TIMEOUT); MAIN_STATUS_TIMEOUT = null; }
      MAIN_STATUS_TIMEOUT = setTimeout(() => {
        mainStatusMessageEl.classList.remove("visible");
      }, 1200);
    }

    function showStatusMessage(text) {
      if (VIEWER_MODE) {
        statusMessageEl.textContent = text || "";
        statusMessageEl.classList.add("visible");
        if (WS.view.statusTimeout) {
          clearTimeout(WS.view.statusTimeout);
          WS.view.statusTimeout = null;
        }
        WS.view.statusTimeout = setTimeout(() => {
          statusMessageEl.classList.remove("visible");
        }, 1200);
        return;
      }
      showMainStatusMessage(text);
    }

    function showSlideshowMessage(text) {
      if (VIEWER_MODE) {
        showStatusMessage(text);
        return;
      }
      showMainStatusMessage(text);
    }

    function captureVideoState(vid) {
      if (!vid) return null;
      return {
        muted: !!vid.muted,
        paused: !!vid.paused
      };
    }

    function applyBanicState(active) {
      if (active === BANIC_ACTIVE) return;
      if (active && document.fullscreenElement) {
        if (VIEWER_MODE) hideOverlay();
        else exitFullscreenIfNeeded();
      }
      BANIC_ACTIVE = active;

      if (BANIC_ACTIVE) {
        BANIC_STATE.preview = captureVideoState(previewVideoEl);
        BANIC_STATE.viewer = captureVideoState(viewerVideoEl);
        BANIC_STATE.slideshowWasActive = WS.view.slideshowActive;

        if (WS.view.slideshowActive) stopSlideshow();

        const vids = Array.from(document.querySelectorAll("video"));
        vids.forEach((vid) => {
          try { vid.pause(); } catch {}
          vid.muted = true;
        });
        banicOverlayEl.classList.add("active");
        const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
        const shouldOpenWindow = !opt || opt.banicOpenWindow !== false;
        if (shouldOpenWindow) {
          const link = BANIC_LINKS[Math.floor(Math.random() * BANIC_LINKS.length)];
          try {
            const win = window.open(link, "_blank");
            if (win && win.focus) win.focus();
          } catch {}
        }
        return;
      }

      banicOverlayEl.classList.remove("active");
      const restore = (vid, state) => {
        if (!vid || !state) return;
        vid.muted = !!state.muted;
        if (!state.paused) { try { vid.play(); } catch {} }
      };
      restore(previewVideoEl, BANIC_STATE.preview);
      restore(viewerVideoEl, BANIC_STATE.viewer);
      if (BANIC_STATE.slideshowWasActive) {
        const mode = slideshowBehavior();
        if (mode === "cycle") {
          const ms = WS.view.slideshowDurations[WS.view.slideshowModeIndex] | 0;
          if (ms) startSlideshow(ms);
        } else {
          const seconds = parseInt(mode, 10);
          if (Number.isFinite(seconds) && seconds > 0) startSlideshow(seconds * 1000);
        }
      }
      BANIC_STATE = { preview: null, viewer: null, slideshowWasActive: false };
    }

    function updateModePill() {
      if (!modePill) return;
      const defs = defaultOptions();
      const parts = [];
      const filterMode = WS.view.filterMode;
      const filterLabel = filterMode === "all" ? "All" : (filterMode === "images" ? "Images only" : (filterMode === "videos" ? "Videos only" : "GIFs only"));
      if (filterMode !== "all") {
        parts.push(`Content filter: ${filterLabel}`);
      }

      const behaviorLabel = WS.view.folderBehavior === "loop" ? "Loop" : (WS.view.folderBehavior === "slide" ? "Slide" : "Stop");
      if (WS.view.folderBehavior !== (defs.defaultFolderBehavior || "slide")) {
        parts.push(`Folder behavior: ${behaviorLabel}`);
      }

      const dirSortMode = normalizeDirSortMode(WS.meta.dirSortMode);
      if (dirSortMode !== "name") {
        parts.push(`Dir sort: ${dirSortModeLabel(dirSortMode)}`);
      }

      modePill.textContent = parts.length ? parts.join(" | ") : "Mode: default";
    }

    function getCurrentTitleText() {
      const path = getDirectoriesPathText();
      return path || "—";
    }

    function updateTitleLabel() {
      if (!titleLabel) return;
      titleLabel.textContent = getCurrentTitleText();
    }

    function syncMetaButtons() {
      syncFavoritesUi();
      syncHiddenUi();
    }

    const MENU_TAB_IDS = ["options", "online", "responses", "keybinds"];
    const menuTabButtons = menuTabs ? Array.from(menuTabs.querySelectorAll(".menuTabBtn")) : [];
    const menuTabPanels = {
      options: menuTabOptions,
      online: menuTabOnline,
      responses: menuTabResponses,
      keybinds: menuTabKeybinds
    };
    const menuScrollTargets = {
      options: optionsBodyEl,
      online: onlineBodyEl,
      responses: responsesBodyEl,
      keybinds: keybindsBodyEl
    };

    function saveMenuTabScroll(tab) {
      const target = menuScrollTargets[tab];
      if (!target) return;
      MENU_TAB_SCROLL[tab] = target.scrollTop || 0;
    }

    function restoreMenuTabScroll(tab) {
      const target = menuScrollTargets[tab];
      if (!target) return;
      const top = MENU_TAB_SCROLL[tab] || 0;
      requestAnimationFrame(() => {
        target.scrollTop = top;
      });
    }

    function ensureOptionsUi() {
      renderOptionsUi();
      setOptionsStatus("Saved automatically");
      restoreMenuTabScroll("options");
    }

    function ensureKeybindsUi() {
      renderKeybindsUi();
      setKeybindsStatus("Saved automatically");
      restoreMenuTabScroll("keybinds");
    }

    function renderOnlineUi() {
      if (!onlineBodyEl) return;
      onlineBodyEl.innerHTML = "";

      const title = document.createElement("h1");
      title.textContent = "Online";
      onlineBodyEl.appendChild(title);

      const optRow = document.createElement("div");
      optRow.className = "optRow";
      const optLeft = document.createElement("div");
      optLeft.className = "optLeft";
      const optTitle = document.createElement("div");
      optTitle.className = "optTitle";
      optTitle.textContent = "Media loading";
      const optHint = document.createElement("div");
      optHint.className = "optHint";
      optHint.textContent = "Choose when online media begins loading.";
      optLeft.appendChild(optTitle);
      optLeft.appendChild(optHint);

      const optRight = document.createElement("div");
      const select = document.createElement("select");
      select.className = "optSelect";
      select.id = "onlineLoadModeSelect";
      const optA = document.createElement("option");
      optA.value = "as-needed";
      optA.textContent = "As Needed";
      const optB = document.createElement("option");
      optB.value = "preload";
      optB.textContent = "Preload All";
      select.appendChild(optA);
      select.appendChild(optB);
      const curMode = onlineLoadMode();
      select.value = curMode === "preload" ? "preload" : "as-needed";
      select.addEventListener("change", () => {
        const next = select.value === "preload" ? "preload" : "as-needed";
        WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, { onlineLoadMode: next }));
        WS.meta.dirty = true;
        metaScheduleSave();
        showStatusMessage(`Online loading: ${next === "preload" ? "Preload All" : "As Needed"}`);
      });
      optRight.appendChild(select);

      optRow.appendChild(optLeft);
      optRow.appendChild(optRight);
      onlineBodyEl.appendChild(optRow);

      const orderRow = document.createElement("div");
      orderRow.className = "optRow";
      const orderLeft = document.createElement("div");
      orderLeft.className = "optLeft";
      const orderTitle = document.createElement("div");
      orderTitle.className = "optTitle";
      orderTitle.textContent = "List online folders first";
      const orderHint = document.createElement("div");
      orderHint.className = "optHint";
      orderHint.textContent = "Float online folders above local folders (tags still stay on top).";
      orderLeft.appendChild(orderTitle);
      orderLeft.appendChild(orderHint);

      const orderRight = document.createElement("div");
      const orderInput = document.createElement("input");
      orderInput.type = "checkbox";
      orderInput.checked = listOnlineFoldersFirstEnabled();
      orderInput.addEventListener("change", () => {
        const enabled = !!orderInput.checked;
        WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, { listOnlineFoldersFirst: enabled }));
        WS.meta.dirty = true;
        metaScheduleSave();
        showStatusMessage(`List online folders first: ${enabled ? "On" : "Off"}`);
        applyOptionsEverywhere(false);
      });
      orderRight.appendChild(orderInput);

      orderRow.appendChild(orderLeft);
      orderRow.appendChild(orderRight);
      onlineBodyEl.appendChild(orderRow);

      const listLabel = document.createElement("div");
      listLabel.className = "label";
      listLabel.style.margin = "10px 0 6px";
      listLabel.textContent = "Profiles";
      onlineBodyEl.appendChild(listLabel);

      const keys = Array.from(ONLINE_PROFILE_CACHE.keys()).sort((a, b) => a.localeCompare(b));
      if (!keys.length) {
        const empty = document.createElement("div");
        empty.className = "label";
        empty.textContent = "No profiles loaded.";
        onlineBodyEl.appendChild(empty);
        restoreMenuTabScroll("online");
        return;
      }

      for (const key of keys) {
        const entry = ONLINE_PROFILE_CACHE.get(key);
        if (!entry || !entry.profile) continue;
        const profile = entry.profile;
        const nameOverride = getOnlineProfileRename(key);
        const display = nameOverride || deriveOnlineUserLabel(profile, entry.posts) || key;
        const url = buildOnlineProfileSourceUrl(profile);
        const row = document.createElement("div");
        row.className = "onlineRow";

        const left = document.createElement("div");
        left.className = "onlineLeft";
        const t = document.createElement("div");
        t.className = "onlineTitle";
        t.textContent = display || key;
        const meta = document.createElement("div");
        meta.className = "onlineMeta";
        meta.textContent = url || key;
        left.appendChild(t);
        left.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "onlineActions";
        const replaceBtn = document.createElement("button");
        replaceBtn.type = "button";
        replaceBtn.className = "miniBtn";
        replaceBtn.textContent = "Replace";
        replaceBtn.addEventListener("click", () => replaceOnlineProfile(key));
        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.className = "miniBtn";
        refreshBtn.textContent = "Refresh";
        refreshBtn.addEventListener("click", () => refreshOnlineProfile(key));
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "miniBtn";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          const confirmed = confirm("Delete this profile and all related folders?");
          if (!confirmed) return;
          deleteOnlineProfile(key);
        });
        actions.appendChild(replaceBtn);
        actions.appendChild(refreshBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(left);
        row.appendChild(actions);
        onlineBodyEl.appendChild(row);
      }

      restoreMenuTabScroll("online");
    }

    function ensureOnlineUi() {
      renderOnlineUi();
    }

    function appendOnlineApiResponses(entries) {
      if (!Array.isArray(entries) || !entries.length) return;
      let changed = false;
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const fullText = (typeof raw.responseText === "string") ? raw.responseText : "";
        const responseText = fullText.length > ONLINE_API_RESPONSE_BODY_LIMIT
          ? fullText.slice(0, ONLINE_API_RESPONSE_BODY_LIMIT)
          : fullText;
        ONLINE_API_RESPONSE_LOG.push({
          ts: (typeof raw.ts === "number") ? raw.ts : Date.now(),
          source: raw.source ? String(raw.source) : "unknown",
          url: raw.url ? String(raw.url) : "",
          page: Number.isFinite(raw.page) ? raw.page : 0,
          offset: Number.isFinite(raw.offset) ? raw.offset : 0,
          status: Number.isFinite(raw.status) ? raw.status : 0,
          ok: !!raw.ok,
          error: raw.error ? String(raw.error) : "",
          parseOk: raw.parseOk === true,
          responseText,
          responseBytes: Number.isFinite(raw.responseBytes) ? raw.responseBytes : fullText.length,
          truncated: !!raw.truncated || fullText.length > ONLINE_API_RESPONSE_BODY_LIMIT
        });
        changed = true;
      }
      if (!changed) return;
      while (ONLINE_API_RESPONSE_LOG.length > ONLINE_API_RESPONSE_LOG_LIMIT) ONLINE_API_RESPONSE_LOG.shift();
      if (MENU_OPEN && MENU_ACTIVE_TAB === "responses") renderResponsesUi();
    }

    function formatOnlineResponseMeta(entry) {
      const bits = [];
      bits.push(new Date(entry.ts || Date.now()).toLocaleTimeString());
      bits.push(entry.source || "unknown");
      if (entry.page > 0) bits.push(`page ${entry.page}`);
      bits.push(`offset ${Number.isFinite(entry.offset) ? entry.offset : 0}`);
      if (entry.status > 0) bits.push(`HTTP ${entry.status}`);
      else bits.push("No HTTP status");
      bits.push(entry.parseOk ? "JSON" : "Non-JSON");
      if (entry.error) bits.push(entry.error);
      if (entry.truncated) bits.push(`truncated (${entry.responseBytes} chars)`);
      return bits.join(" • ");
    }

    function renderResponsesUi() {
      if (!responsesBodyEl) return;
      const prevScroll = responsesBodyEl.scrollTop || 0;
      responsesBodyEl.innerHTML = "";

      const title = document.createElement("h1");
      title.textContent = "Responses";
      responsesBodyEl.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "responseActions";
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "miniBtn";
      clearBtn.textContent = "Clear log";
      clearBtn.addEventListener("click", () => {
        ONLINE_API_RESPONSE_LOG.length = 0;
        renderResponsesUi();
      });
      actions.appendChild(clearBtn);
      responsesBodyEl.appendChild(actions);

      if (!ONLINE_API_RESPONSE_LOG.length) {
        const empty = document.createElement("div");
        empty.className = "label";
        empty.textContent = "No API responses captured yet.";
        responsesBodyEl.appendChild(empty);
        restoreMenuTabScroll("responses");
        return;
      }

      const list = document.createElement("div");
      list.className = "responseLog";
      for (let i = ONLINE_API_RESPONSE_LOG.length - 1; i >= 0; i--) {
        const entry = ONLINE_API_RESPONSE_LOG[i];
        const item = document.createElement("div");
        item.className = "responseItem";

        if (entry.url) {
          const link = document.createElement("a");
          link.className = "responseLink";
          link.href = entry.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = entry.url;
          item.appendChild(link);
        } else {
          const label = document.createElement("div");
          label.className = "responseLink";
          label.textContent = "Unknown URL";
          item.appendChild(label);
        }

        const meta = document.createElement("div");
        meta.className = "responseMeta";
        meta.textContent = formatOnlineResponseMeta(entry);
        item.appendChild(meta);

        const pre = document.createElement("pre");
        pre.className = "responsePreview";
        pre.textContent = entry.responseText || "(empty response body)";
        item.appendChild(pre);

        list.appendChild(item);
      }
      responsesBodyEl.appendChild(list);
      requestAnimationFrame(() => {
        responsesBodyEl.scrollTop = prevScroll;
      });
    }

    function ensureResponsesUi() {
      renderResponsesUi();
      restoreMenuTabScroll("responses");
    }

    function setMenuTab(tabId) {
      const nextCandidate = MENU_TAB_IDS.includes(tabId) ? tabId : "options";
      const next = (!onlineFeaturesEnabled() && (nextCandidate === "online" || nextCandidate === "responses")) ? "options" : nextCandidate;
      if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
      MENU_ACTIVE_TAB = next;
      MENU_LAST_TAB = next;

      menuTabButtons.forEach((btn) => {
        const active = btn.dataset.tab === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.setAttribute("tabindex", active ? "0" : "-1");
      });

      Object.entries(menuTabPanels).forEach(([id, panel]) => {
        if (!panel) return;
        const active = id === next;
        panel.classList.toggle("active", active);
        panel.setAttribute("aria-hidden", active ? "false" : "true");
      });

      if (next === "online") {
        ensureOnlineUi();
        return;
      }
      if (next === "responses") {
        ensureResponsesUi();
        return;
      }
      if (next === "keybinds") {
        ensureKeybindsUi();
        return;
      }
      ensureOptionsUi();
    }

    function openMenu(tabId) {
      MENU_OPEN = true;
      if (menuOverlay) menuOverlay.classList.add("active");
      requestAnimationFrame(() => applyOverlayWindowState("menu"));
      const next = MENU_TAB_IDS.includes(tabId)
        ? tabId
        : (MENU_HAS_OPENED ? MENU_LAST_TAB : "options");
      MENU_HAS_OPENED = true;
      setMenuTab(next);
    }

    function closeMenu() {
      if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
      MENU_OPEN = false;
      if (menuOverlay) menuOverlay.classList.remove("active");
    }

    if (menuCloseBtn) menuCloseBtn.addEventListener("click", () => closeMenu());
    if (optionsBtn) optionsBtn.addEventListener("click", () => openMenu());
    menuTabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab || "options";
        setMenuTab(tab);
      });
    });

    /* =========================================================
       Keybinds panel
       ========================================================= */

    function setKeybindsStatus(text) {
      if (!keybindsStatusLabel) return;
      keybindsStatusLabel.textContent = text || "—";
    }

    function applyKeybindPreset(presetId) {
      const preset = KEYBIND_PRESETS[presetId] ? presetId : "right";
      WS.meta.keybindsPreset = preset;
      WS.meta.keybinds = defaultKeybinds(preset);
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      renderKeybindsUi();
      setKeybindsStatus("Preset applied");
    }

    function renderKeybindsUi() {
      if (!keybindsBodyEl) return;
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds("right");
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";

      const bySection = new Map();
      for (const binding of bindings) {
        if (!bySection.has(binding.section)) bySection.set(binding.section, []);
        bySection.get(binding.section).push(binding);
      }

      const makeOptions = (selected, allowEscape = false) => {
        const opts = [];
        opts.push(`<option value="">Unassigned</option>`);
        if (allowEscape || selected === "Escape") {
          const selectedAttr = selected === "Escape" ? " selected" : "";
          opts.push(`<option value="Escape"${selectedAttr}>Escape</option>`);
        }
        for (const key of SAFE_KEY_VALUES) {
          const val = escapeHtml(key);
          const label = escapeHtml(keyLabel(key));
          const isSelected = key === selected ? " selected" : "";
          opts.push(`<option value="${val}"${isSelected}>${label}</option>`);
        }
        return opts.join("");
      };

      let html = `<div class="label" style="margin-bottom:8px;">Keybinds are stored in keyboard-configuration.log.json in the .local-gallery folder. Escape always closes overlays.</div>`;
      html += `
        <div class="optRow">
          <div class="optLeft">
            <div class="optTitle">Preset</div>
            <div class="optHint">Apply a left/right-handed base layout.</div>
          </div>
          <div class="optRight">
            <select id="keybindPresetSelect">
              ${Object.entries(KEYBIND_PRESETS).map(([id, preset]) => {
                const selected = id === presetId ? " selected" : "";
                return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(preset.label)}</option>`;
              }).join("")}
            </select>
          </div>
        </div>
      `;

      for (const section of KEYBIND_SECTIONS) {
        const list = bySection.get(section.id) || [];
        if (!list.length) continue;
        html += `<h1>${escapeHtml(section.label)}</h1>`;
        for (const binding of list) {
          const selected = binding.key || "";
          const allowEscape = binding.id === "back";
          html += `
            <div class="optRow">
              <div class="optLeft">
                <div class="optTitle">${escapeHtml(binding.label)}</div>
                <div class="optHint">${escapeHtml(binding.hint)}</div>
              </div>
              <div class="optRight">
                <select data-bind-id="${escapeHtml(binding.id)}">${makeOptions(selected, allowEscape)}</select>
              </div>
            </div>
          `;
        }
      }

      keybindsBodyEl.innerHTML = html;
      applyDescriptionVisibilityFromOptions();

      const presetSelect = keybindsBodyEl.querySelector("#keybindPresetSelect");
      if (presetSelect) {
        presetSelect.addEventListener("click", (e) => e.stopPropagation());
        presetSelect.addEventListener("keydown", (e) => e.stopPropagation());
        presetSelect.addEventListener("change", () => {
          applyKeybindPreset(presetSelect.value);
        });
      }

      const selects = keybindsBodyEl.querySelectorAll("select[data-bind-id]");
      selects.forEach((sel) => {
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("keydown", (e) => e.stopPropagation());
        sel.addEventListener("change", () => {
          const id = sel.getAttribute("data-bind-id");
          if (!id || !WS.meta || !Array.isArray(WS.meta.keybinds)) return;
          const binding = WS.meta.keybinds.find(b => b.id === id);
          if (!binding) return;

          const nextKey = normalizeKeyValue(sel.value || "");
          if (nextKey && !isSafeKey(nextKey) && !(binding.id === "back" && nextKey === "Escape")) return;

          const prevKey = binding.key || "";
          if (nextKey === prevKey) return;

          const conflict = nextKey
            ? WS.meta.keybinds.find(b => b.id !== binding.id && b.key === nextKey)
            : null;

          binding.key = nextKey;
          if (conflict) conflict.key = prevKey;

          rebuildKeybindIndex();
          WS.meta.dirty = true;
          metaScheduleSave();
          setKeybindsStatus("Saved");

          if (conflict) {
            const otherSelect = keybindsBodyEl.querySelector(`select[data-bind-id="${conflict.id}"]`);
            if (otherSelect) otherSelect.value = conflict.key || "";
          }
        });
      });
    }

    function resetKeybindsToDefaults() {
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";
      WS.meta.keybinds = defaultKeybinds(presetId);
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      renderKeybindsUi();
      setKeybindsStatus("Reset");
    }

    function renderOptionsUi() {
      if (!optionsBodyEl) return;
      const opt = WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);

      const makeSelectRow = (title, hint, id, value, items) => {
        const opts = items.map(it => `<option value="${escapeHtml(it.value)}"${it.value === value ? " selected" : ""}>${escapeHtml(it.label)}</option>`).join("");
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight">
              <select id="${escapeHtml(id)}">${opts}</select>
            </div>
          </div>
        `;
      };

      const makeCheckRow = (title, hint, id, checked) => {
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight">
              <input id="${escapeHtml(id)}" type="checkbox"${checked ? " checked" : ""} />
            </div>
          </div>
        `;
      };

      const makeRangeRow = (title, hint, id, value, min, max, step, displayValue) => {
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight optRange">
              <input id="${escapeHtml(id)}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(String(value))}" />
              <div class="optRangeValue" id="${escapeHtml(id)}_value">${escapeHtml(displayValue)}</div>
            </div>
          </div>
        `;
      };

      const vidModes = [
        { value: "unmuted", label: "Auto-play unmuted" },
        { value: "muted", label: "Auto-play muted" },
        { value: "off", label: "No autoplay" }
      ];

      const folderModes = [
        { value: "stop", label: "Stop" },
        { value: "loop", label: "Loop" },
        { value: "slide", label: "Slide" }
      ];

      const dirSortModes = dirSortModeOptions();

      const skipSteps = [
        { value: "3", label: "3 seconds" },
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
        { value: "30", label: "30 seconds" }
      ];

      const preloadModes = [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
        { value: "ultra", label: "Ultra" }
      ];

      const videoEndModes = [
        { value: "loop", label: "Loop video" },
        { value: "next", label: "Advance to next item" },
        { value: "stop", label: "Stop at end" }
      ];

      const slideshowModes = [
        { value: "cycle", label: "Cycle speeds" },
        { value: "1", label: "Toggle 1s" },
        { value: "3", label: "Toggle 3s" },
        { value: "5", label: "Toggle 5s" },
        { value: "10", label: "Toggle 10s" }
      ];

      const thumbModes = [
        { value: "tiny", label: "Tiny" },
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" }
      ];

      const previewModes = [
        { value: "grid", label: "Grid" },
        { value: "expanded", label: "Expanded" }
      ];

      const thumbFitModes = [
        { value: "cover", label: "Crop to fill" },
        { value: "contain", label: "Fit inside" }
      ];

      const previewSizeModes = [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" }
      ];

      const folderScoreModes = [
        { value: "show", label: "Show score + arrows" },
        { value: "no-arrows", label: "Hide arrows" },
        { value: "hidden", label: "Hide score + arrows" }
      ];

      const randomActionModes = [
        { value: "firstFileJump", label: "First file jump" },
        { value: "randomFileSort", label: "Random file sort" }
      ];

      const colorSchemes = [
        { value: "classic", label: "Classic Dark" },
        { value: "light", label: "Light" },
        { value: "superdark", label: "OLED Dark" },
        { value: "synthwave", label: "Synthwave" },
        { value: "verdant", label: "Verdant" },
        { value: "azure", label: "Azure" },
        { value: "ember", label: "Ember" },
        { value: "amber", label: "Amber" },
        { value: "retro90s", label: "Retro 90s" },
        { value: "retro90s-dark", label: "Retro 90s Dark" }
      ];

      const mediaFilterModes = [
        /* media filters: names */
       { value: "off", label: "Off" },
       { value: "vibrant", label: "Vibrant" },
       { value: "cinematic", label: "Cinematic" },
       { value: "orangeTeal", label: "Orange+Teal" },
       { value: "bw", label: "Black + White" },
       { value: "uv", label: "UV Camera" },
       { value: "infrared", label: "Infrared Camera" }/*
       { value: "cinematic", label: "Cinematic" },
       { value: "soft", label: "Soft" }*/
      ];

      const formatPixelateResolution = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
      };

      const formatGrainAmount = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${Math.round(n * 100)}%`;
      };

      const pixelateResolutionValue = Number.isFinite(opt.crtPixelateResolution) ? opt.crtPixelateResolution : 4;
      const grainAmountValue = Number.isFinite(opt.crtGrainAmount) ? opt.crtGrainAmount : 0.06;
      const vhsBlurValue = Number.isFinite(opt.vhsBlurAmount) ? opt.vhsBlurAmount : 1.2;
      const vhsChromaValue = Number.isFinite(opt.vhsChromaAmount) ? opt.vhsChromaAmount : 1.2;

      const formatVhsBlur = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${n.toFixed(1)}px`;
      };

      const formatVhsChroma = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${n.toFixed(1)}px`;
      };

      optionsBodyEl.innerHTML = `
        <div class="label" style="margin-bottom:8px;">Option preferences are automatically stored in preferences.log.json in the .local-gallery system folder in the root directory.</div>

<h1>General</h1>
${makeSelectRow("Folder sort", "Sort folders by name, score, recursive size, recursive count, or non-recursive count.", "opt_dirSortMode", normalizeDirSortMode(WS.meta.dirSortMode), dirSortModes)}
${makeSelectRow("Folder scores", "Choose how folder scores appear in lists + previews.", "opt_folderScoreDisplay", String(opt.folderScoreDisplay || "hidden"), folderScoreModes)}
${makeCheckRow("Show online features", "Toggles the Online tab, URL bar, and online profile/post folders.", "opt_onlineFeaturesEnabled", opt.onlineFeaturesEnabled !== false)}
${makeCheckRow("Show folder item counts", "Show the number of items on folders in the directories pane.", "opt_showFolderItemCount", opt.showFolderItemCount !== false)}
${makeCheckRow("Show folder size", "Show total folder size on folders in the directories pane.", "opt_showFolderSize", opt.showFolderSize !== false)}
${makeCheckRow("Show file type labels (directories)", "Show Image/Video labels for files in the directories pane.", "opt_showDirFileTypeLabel", opt.showDirFileTypeLabel !== false)}
${makeSelectRow("Folder behavior", "Sets how folders behave when browsing.", "opt_defaultFolderBehavior", String(opt.defaultFolderBehavior || "slide"), folderModes)}
${makeSelectRow("Random action behavior", "Choose what the Random action key does.", "opt_randomActionMode", String(opt.randomActionMode || "firstFileJump"), randomActionModes)}
${makeCheckRow("PANIC! opens decoy window", "When enabled, PANIC! opens a harmless site in a new window.", "opt_banicOpenWindow", opt.banicOpenWindow !== false)}
${makeCheckRow("Show Hidden Folder", "Display a dedicated hidden-folder tag near the top of the directories pane when tag folders are enabled.", "opt_showHiddenFolder", !!opt.showHiddenFolder)}
${makeCheckRow("Show Untagged Folder", "Display a dedicated untagged-folder tag near the top of the root directories pane when tag folders are enabled.", "opt_showUntaggedFolder", !!opt.showUntaggedFolder)}
${makeCheckRow("Show Trash Folder", "Display a dedicated trash-folder entry near the top of the root directories pane when trash has items.", "opt_showTrashFolder", opt.showTrashFolder !== false)}

<h1>Appearance</h1>
${makeSelectRow("Color scheme", "Switch the overall interface palette.", "opt_colorScheme", String(opt.colorScheme || "classic"), colorSchemes)}
${makeCheckRow("Hide option descriptions", "Hide helper text under each option in this tab.", "opt_hideOptionDescriptions", !!opt.hideOptionDescriptions)}
${makeCheckRow("Hide key bind descriptions", "Hide helper text under each keybind action in the keybinds tab.", "opt_hideKeybindDescriptions", !!opt.hideKeybindDescriptions)}
${makeCheckRow("Retro Mode", "Pixelated, low-res UI styling across themes.", "opt_retroMode", !!opt.retroMode)}
${makeSelectRow("Media filter", "Apply a visual filter to media.", "opt_mediaFilter", String(opt.mediaFilter || "off"), mediaFilterModes)}
${makeCheckRow("Scanline overlay", "Add CRT scanlines over media.", "opt_crtScanlinesEnabled", !!opt.crtScanlinesEnabled)}
${makeCheckRow("Pixelated overlay", "Pixelate media before applying filters.", "opt_crtPixelateEnabled", !!opt.crtPixelateEnabled)}
${makeRangeRow("Pixelation resolution", "Higher values mean chunkier pixels.", "opt_crtPixelateResolution", pixelateResolutionValue, 2, 8, 0.5, formatPixelateResolution(pixelateResolutionValue))}
${makeCheckRow("Film grain overlay", "Adds film grain noise overlay.", "opt_crtGrainEnabled", !!opt.crtGrainEnabled)}
${makeRangeRow("Film grain amount", "Strength of the grain overlay.", "opt_crtGrainAmount", grainAmountValue, 0, 0.25, 0.01, formatGrainAmount(grainAmountValue))}
${makeCheckRow("VHS overlay", "Soft, lo-def magnetic tape look.", "opt_vhsOverlayEnabled", !!opt.vhsOverlayEnabled)}
${makeCheckRow("Film corners overlay", "Rounds media corners for an old film look.", "opt_filmCornerOverlayEnabled", !!opt.filmCornerOverlayEnabled)}
${makeRangeRow("VHS blur amount", "Controls the fuzzy tape softness.", "opt_vhsBlurAmount", vhsBlurValue, 0, 3, 0.1, formatVhsBlur(vhsBlurValue))}
${makeRangeRow("VHS chroma amount", "Controls chromatic bleed/aberration.", "opt_vhsChromaAmount", vhsChromaValue, 0, 3, 0.1, formatVhsChroma(vhsChromaValue))}
${makeCheckRow("Animated filters", "When enabled, scanlines/grain/jitter animate.", "opt_animatedMediaFilters", opt.animatedMediaFilters !== false)}

<h1>Playback</h1>
${makeSelectRow("Video audio (preview)", "Controls autoplay + mute in the in-pane preview player.", "opt_videoPreview", String(opt.videoPreview || "muted"), vidModes)}
${makeSelectRow("Video audio (gallery)", "Controls autoplay + mute in fullscreen gallery mode.", "opt_videoGallery", String(opt.videoGallery || "muted"), vidModes)}
${makeSelectRow("Video skip step", "Seek increment for video skip shortcuts.", "opt_videoSkipStep", String(opt.videoSkipStep || "10"), skipSteps)}
${makeSelectRow("Video end behavior", "What happens when a video ends (outside slideshow).", "opt_videoEndBehavior", String(opt.videoEndBehavior || "loop"), videoEndModes)}
${makeSelectRow("Preload next item", "Preload the next item for smoother browsing.", "opt_preloadNextMode", String(opt.preloadNextMode || "off"), preloadModes)}
${makeSelectRow("Slideshow speed", "Controls slideshow timing when toggled.", "opt_slideshowDefault", String(opt.slideshowDefault || "cycle"), slideshowModes)}

<h1>Preview</h1>
${makeCheckRow("Show file type labels (preview)", "Show Image/Video labels under file thumbnails in the preview pane.", "opt_showPreviewFileTypeLabel", opt.showPreviewFileTypeLabel !== false)}
${makeCheckRow("Show file names (preview)", "Show file names under thumbnails in the preview pane.", "opt_showPreviewFileName", opt.showPreviewFileName !== false)}
${makeCheckRow("Show folder item counts (preview)", "Show the number of items on folder cards in the preview pane.", "opt_showPreviewFolderItemCount", opt.showPreviewFolderItemCount !== false)}
${makeCheckRow("Apply filters to thumbnails (preview)", "Apply media filters and overlays to preview thumbnails.", "opt_previewThumbFiltersEnabled", !!opt.previewThumbFiltersEnabled)}
${makeSelectRow("Thumbnail fit (preview)", "Choose whether thumbnails crop to fill their card or fit inside it.", "opt_previewThumbFit", String(opt.previewThumbFit || "cover"), thumbFitModes)}
${makeSelectRow("Image thumbnail size", "Controls generated image thumbnail quality (smaller is faster).", "opt_imageThumbSize", String(opt.imageThumbSize || "medium"), thumbModes)}
${makeSelectRow("Video thumbnail size", "Controls generated video thumbnail quality (smaller is faster).", "opt_videoThumbSize", String(opt.videoThumbSize || "medium"), thumbModes)}
${makeSelectRow("Media thumbnail scale", "Controls how large media cards appear in the preview pane.", "opt_mediaThumbUiSize", String(opt.mediaThumbUiSize || "medium"), previewSizeModes)}
${makeSelectRow("Folder preview scale", "Controls how large folder cards appear in the preview pane.", "opt_folderPreviewSize", String(opt.folderPreviewSize || "medium"), previewSizeModes)}
${makeSelectRow("Preview mode", "Controls how folders are shown in the preview pane.", "opt_previewMode", String(opt.previewMode || "grid"), previewModes)}

<h1>Filenames</h1>
${makeCheckRow("Hide file extensions", "Hide .jpg / .mp4 in file names.", "opt_hideFileExtensions", !!opt.hideFileExtensions)}
${makeCheckRow("Hide underscores from display names", "Replace underscores with spaces.", "opt_hideUnderscoresInNames", !!opt.hideUnderscoresInNames)}
${makeCheckRow("Hide prefix before last ' - ' in file names", "Show only text after the last ' - ' in file names.", "opt_hideBeforeLastDashInFileNames", !!opt.hideBeforeLastDashInFileNames)}
${makeCheckRow("Hide suffix after first underscore in file names", "Show only text before the first underscore in file names.", "opt_hideAfterFirstUnderscoreInFileNames", !!opt.hideAfterFirstUnderscoreInFileNames)}
${makeCheckRow("Force title caps in display names", "Apply Title Case to display names.", "opt_forceTitleCaps", !!opt.forceTitleCaps)}
      `;
      applyDescriptionVisibilityFromOptions();

      const bindSelect = (id, key, invalidateThumbs, onChange, valueParser) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("change", () => {
          const next = {};
          next[key] = valueParser ? valueParser(el.value) : el.value;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(el.value);
          applyOptionsEverywhere(!!invalidateThumbs);
        });
      };

      const bindCheck = (id, key, onChange) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("change", () => {
          const next = {};
          next[key] = !!el.checked;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(!!el.checked);
          applyOptionsEverywhere(false);
        });
      };

      const bindRange = (id, key, onChange, formatter) => {
        const el = $(id);
        if (!el) return;
        const valueEl = $(`${id}_value`);
        const updateValue = () => {
          if (!valueEl) return;
          const nextVal = parseFloat(el.value);
          valueEl.textContent = formatter ? formatter(nextVal) : String(el.value);
        };
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("input", updateValue);
        el.addEventListener("change", () => {
          const next = {};
          const val = parseFloat(el.value);
          next[key] = Number.isFinite(val) ? val : 0;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(next[key]);
          applyOptionsEverywhere(false);
        });
        updateValue();
      };

      bindSelect("opt_videoPreview", "videoPreview", false);
      bindSelect("opt_videoGallery", "videoGallery", false);
      bindSelect("opt_defaultFolderBehavior", "defaultFolderBehavior", false, () => {
        applyDefaultViewFromOptions();
      });
      bindSelect("opt_folderScoreDisplay", "folderScoreDisplay", false, (val) => {
        WS.view.folderScoreDisplay = (val === "show" || val === "no-arrows" || val === "hidden") ? val : "hidden";
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
      });
      bindSelect("opt_videoSkipStep", "videoSkipStep", false);
      bindSelect("opt_preloadNextMode", "preloadNextMode", false, (val) => {
        if (val === "off") PRELOAD_CACHE = new Map();
      });
      bindSelect("opt_videoEndBehavior", "videoEndBehavior", false);
      bindSelect("opt_slideshowDefault", "slideshowDefault", false);
      bindCheck("opt_banicOpenWindow", "banicOpenWindow");
      bindCheck("opt_showHiddenFolder", "showHiddenFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "hidden") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showUntaggedFolder", "showUntaggedFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "untagged") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showTrashFolder", "showTrashFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "trash") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showFolderItemCount", "showFolderItemCount", () => {
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showFolderSize", "showFolderSize", () => {
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showDirFileTypeLabel", "showDirFileTypeLabel", () => {
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showPreviewFileTypeLabel", "showPreviewFileTypeLabel", () => {
        renderPreviewPane(true, true);
      });
      bindCheck("opt_showPreviewFileName", "showPreviewFileName", () => {
        renderPreviewPane(true, true);
      });
      bindCheck("opt_showPreviewFolderItemCount", "showPreviewFolderItemCount", () => {
        renderPreviewPane(true, true);
      });
      bindCheck("opt_onlineFeaturesEnabled", "onlineFeaturesEnabled");
      bindCheck("opt_hideOptionDescriptions", "hideOptionDescriptions", () => {
        applyDescriptionVisibilityFromOptions();
      });
      bindCheck("opt_hideKeybindDescriptions", "hideKeybindDescriptions", () => {
        applyDescriptionVisibilityFromOptions();
      });
      bindCheck("opt_previewThumbFiltersEnabled", "previewThumbFiltersEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindSelect("opt_previewThumbFit", "previewThumbFit", false);
      bindSelect("opt_imageThumbSize", "imageThumbSize", true);
      bindSelect("opt_videoThumbSize", "videoThumbSize", true);
      bindSelect("opt_mediaThumbUiSize", "mediaThumbUiSize", false);
      bindSelect("opt_folderPreviewSize", "folderPreviewSize", false);
      bindSelect("opt_colorScheme", "colorScheme", false, () => {
        applyColorSchemeFromOptions();
      });
      bindSelect("opt_previewMode", "previewMode", false, () => {
        renderPreviewPane(true);
      });
      bindCheck("opt_retroMode", "retroMode", () => {
        applyRetroModeFromOptions();
      });
      bindSelect("opt_mediaFilter", "mediaFilter", true, (val) => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_crtScanlinesEnabled", "crtScanlinesEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_crtPixelateEnabled", "crtPixelateEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_crtPixelateResolution", "crtPixelateResolution", () => {
        applyMediaFilterFromOptions();
      }, formatPixelateResolution);
      bindCheck("opt_crtGrainEnabled", "crtGrainEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_crtGrainAmount", "crtGrainAmount", () => {
        applyMediaFilterFromOptions();
      }, formatGrainAmount);
      bindCheck("opt_vhsOverlayEnabled", "vhsOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_filmCornerOverlayEnabled", "filmCornerOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_vhsBlurAmount", "vhsBlurAmount", () => {
        applyMediaFilterFromOptions();
      }, formatVhsBlur);
      bindRange("opt_vhsChromaAmount", "vhsChromaAmount", () => {
        applyMediaFilterFromOptions();
      }, formatVhsChroma);
      bindCheck("opt_animatedMediaFilters", "animatedMediaFilters", () => {
        applyMediaFilterFromOptions();
      });
      bindSelect("opt_randomActionMode", "randomActionMode", false, (val) => {
        if (val === "randomFileSort") return;
        if (!WS.view.randomMode) return;
        WS.view.randomMode = false;
        WS.view.randomCache = new Map();
        applyRandomSortModeEverywhere(true);
      });
      bindCheck("opt_hideFileExtensions", "hideFileExtensions");
      bindCheck("opt_hideUnderscoresInNames", "hideUnderscoresInNames");
      bindCheck("opt_hideBeforeLastDashInFileNames", "hideBeforeLastDashInFileNames");
      bindCheck("opt_hideAfterFirstUnderscoreInFileNames", "hideAfterFirstUnderscoreInFileNames");
      bindCheck("opt_forceTitleCaps", "forceTitleCaps");

      const dirSortSelect = $("opt_dirSortMode");
      if (dirSortSelect) {
        dirSortSelect.addEventListener("click", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("keydown", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("change", () => {
          WS.meta.dirSortMode = normalizeDirSortMode(dirSortSelect.value);
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          applyViewModesEverywhere(true);
        });
      }
    }

    function resetOptionsToDefaults() {
      WS.meta.options = normalizeOptions(defaultOptions());
      WS.meta.dirty = true;
      metaScheduleSave();
      setOptionsStatus("Reset");
      renderOptionsUi();
      applyOptionsEverywhere(true);
    }

    if (keybindsDoneBtn) keybindsDoneBtn.addEventListener("click", () => closeMenu());
    if (keybindsResetBtn) keybindsResetBtn.addEventListener("click", () => resetKeybindsToDefaults());

    if (optionsDoneBtn) optionsDoneBtn.addEventListener("click", () => closeMenu());
    if (optionsResetBtn) optionsResetBtn.addEventListener("click", () => resetOptionsToDefaults());

    /* =========================================================
       Workspace loading (read-only input)
       ========================================================= */
    function getBulkSelectionKey() {
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      const dn = WS.nav.dirNode;
      return dn ? String(dn.path || "") : "";
    }

    function clearBulkTagSelection() {
      clearBulkTagPlaceholder();
      closeActionMenus();
      if (WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.clear) WS.view.bulkTagSelectedPaths.clear();
      if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
    }

    function finalizeBulkSelectionAction() {
      if (!WS.view.bulkSelectMode &&
          !(WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.size) &&
          !(WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.size)) {
        return;
      }
      WS.view.bulkSelectMode = false;
      clearBulkTagSelection();
    }

    function syncBulkSelectionForCurrentDir() {
      const p = getBulkSelectionKey();
      if (!WS.view.bulkTagSelectionsByDir) WS.view.bulkTagSelectionsByDir = new Map();
      if (!WS.view.bulkTagSelectionsByDir.has(p)) WS.view.bulkTagSelectionsByDir.set(p, new Set());
      WS.view.bulkTagSelectedPaths = WS.view.bulkTagSelectionsByDir.get(p);
      if (!WS.view.bulkFileSelectionsByDir) WS.view.bulkFileSelectionsByDir = new Map();
      if (!WS.view.bulkFileSelectionsByDir.has(p)) WS.view.bulkFileSelectionsByDir.set(p, new Set());
      WS.view.bulkFileSelectedIds = WS.view.bulkFileSelectionsByDir.get(p);
    }

    function applyVideoCarryToElement(vid, fileId) {
      if (!vid) return;
      if (!VIDEO_CARRY.active) return;
      if ((VIDEO_CARRY.fileId || "") !== (fileId || "")) return;

      const t = VIDEO_CARRY.time || 0;
      const wp = !!VIDEO_CARRY.wasPlaying;

      const doApply = () => {
        try { if (isFinite(t)) vid.currentTime = t; } catch {}
        if (wp) { try { vid.play(); } catch {} }
        else { try { vid.pause(); } catch {} }
        VIDEO_CARRY.active = false;
        VIDEO_CARRY.fileId = null;
        VIDEO_CARRY.time = 0;
        VIDEO_CARRY.wasPlaying = false;
      };

      if (vid.readyState >= 1) {
        setTimeout(doApply, 0);
        return;
      }

      const once = () => {
        try { vid.removeEventListener("loadedmetadata", once); } catch {}
        doApply();
      };
      try { vid.addEventListener("loadedmetadata", once); } catch {}
    }

    function normalizeVideoPlaybackRate(vid) {
      if (!vid) return;
      try {
        vid.defaultPlaybackRate = 1;
        vid.playbackRate = 1;
      } catch {}
    }

    function ensureDirPath(path) {
      const norm = path || "";
      if (WS.dirByPath.has(norm)) return WS.dirByPath.get(norm);

      const segments = norm.split("/").filter(Boolean);
      let cur = WS.root;
      let accum = "";
      for (const seg of segments) {
        accum = accum ? (accum + "/" + seg) : seg;
        let node = WS.dirByPath.get(accum);
        if (!node) {
          node = makeDirNode(seg, cur);
          node.path = accum;
          WS.dirByPath.set(accum, node);
          cur.childrenDirs.push(node);
        }
        cur = node;
      }
      return cur;
    }

    function normalizeRootIfSingleDir() {
      const rootDirs = WS.root.childrenDirs;
      const rootFiles = WS.root.childrenFiles;
      if (rootDirs.length === 1 && rootFiles.length === 0) {
        const actual = rootDirs[0];
        actual.parent = null;
        actual.path = "";
        WS.root = actual;

        WS.dirByPath.clear();
        WS.dirByPath.set("", WS.root);
        (function reindex(node, basePath) {
          node.path = basePath;
          for (const d of node.childrenDirs) {
            const p = basePath ? (basePath + "/" + d.name) : d.name;
            WS.dirByPath.set(p, d);
            reindex(d, p);
          }
        })(WS.root, "");
      }
    }

    function hash32(str) {
      let h = 2166136261 >>> 0;
      const s = String(str || "");
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function makeRng(seed) {
      let x = (seed >>> 0) || 1;
      return () => {
        x = (Math.imul(1664525, x) + 1013904223) >>> 0;
        return x / 4294967296;
      };
    }

    function shuffleWithSeed(arr, seed) {
      const rnd = makeRng(seed);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    function computeWorkspaceSeed() {
      const keys = Array.from(WS.fileById.keys()).slice().sort();
      let h = 2166136261 >>> 0;
      for (let i = 0; i < keys.length; i++) {
        h ^= hash32(keys[i]);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function metaGetScore(path) {
      const p = String(path || "");
      const v = WS.meta.dirScores.get(p);
      return Number.isFinite(v) ? v : 0;
    }

    function metaSetScore(path, score) {
      const p = String(path || "");
      const v = Number(score || 0) | 0;
      WS.meta.dirScores.set(p, v);
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      if (WS.meta.dirSortMode === "score") {
        applyViewModesEverywhere(true);
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function metaBumpScore(path, delta) {
      const p = String(path || "");
      const cur = metaGetScore(p);
      metaSetScore(p, (cur + (delta | 0)) | 0);
    }

    function metaBumpScoreBulk(paths, delta) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const d = delta | 0;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const cur = metaGetScore(p);
        WS.meta.dirScores.set(p, (cur + d) | 0);
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      if (WS.meta.dirSortMode === "score") {
        applyViewModesEverywhere(true);
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function normalizeTag(t) {
      const s = String(t || "").trim().toLowerCase();
      return s;
    }

    function normalizeTagList(list) {
      const out = [];
      const seen = new Set();
      const arr = Array.isArray(list) ? list : [];
      for (let i = 0; i < arr.length; i++) {
        const t = normalizeTag(arr[i]);
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }

    function normalizeTagsFromText(text) {
      const raw = String(text || "");
      if (!raw.trim()) return [];
      const parts = raw.split(",").map(s => normalizeTag(s));
      return normalizeTagList(parts);
    }

    function arraysEqual(a, b) {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    function metaWriteUserTags(path, userTags) {
      if (!WS.meta || !WS.meta.dirTags) return false;
      const p = String(path || "");
      const existing = metaGetTags(p);
      const fav = existing.includes(FAVORITE_TAG);
      const hidden = existing.includes(HIDDEN_TAG);
      const normalized = normalizeTagList(userTags).filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
      const merged = [];
      if (fav) merged.push(FAVORITE_TAG);
      if (hidden) merged.push(HIDDEN_TAG);
      for (const tag of normalized) {
        if (!tag) continue;
        if (merged.includes(tag)) continue;
        merged.push(tag);
      }
      const prev = WS.meta.dirTags.get(p);
      if (arraysEqual(prev || [], merged)) return false;
      WS.meta.dirTags.set(p, merged);
      WS.meta.dirty = true;
      return true;
    }

    function metaGetTags(path) {
      const p = String(path || "");
      const v = WS.meta.dirTags.get(p);
      return Array.isArray(v) ? v.slice() : [];
    }

    function metaGetUserTags(path) {
      const tags = metaGetTags(path);
      return tags.filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
    }

    function metaHasFavorite(path) {
      const tags = metaGetTags(path);
      return tags.includes(FAVORITE_TAG);
    }

    function metaHasHidden(path) {
      const tags = metaGetTags(path);
      return tags.includes(HIDDEN_TAG);
    }

    function metaSetUserTags(path, userTags) {
      const changed = metaWriteUserTags(path, userTags);
      if (!changed) return;
      metaScheduleSave();
      TAG_EDIT_PATH = null;
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function refreshAfterTagMetadataChange() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function clearBulkTagPlaceholder() {
      if (!BULK_TAG_PLACEHOLDER) return false;
      BULK_TAG_PLACEHOLDER = null;
      TAG_ENTRY_RENAME_STATE = null;
      return true;
    }

    function canUseBulkTagPlaceholderUi() {
      if (!treatTagsAsFoldersEnabled()) return false;
      if (!WS.root) return false;
      return true;
    }

    function startBulkTagging(paths) {
      if (canUseBulkTagPlaceholderUi() && setBulkTagPlaceholder(paths, "New tag folder")) return;
    }

    function setBulkTagPlaceholder(paths, label = "New tag folder") {
      clearBulkTagPlaceholder();
      const unique = Array.from(new Set((paths || []).map(p => String(p || "")))).filter(p => p);
      if (!unique.length) return false;
      BULK_TAG_PLACEHOLDER = {
        paths: unique,
        label: label,
        count: unique.length
      };
      TAG_ENTRY_RENAME_STATE = {
        tag: "",
        label,
        paths: unique.slice(),
        placeholder: true
      };
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      renderDirectoriesPane(true);
      setTimeout(() => {
        focusTagEntryRenameInput();
      }, 0);
      return true;
    }

    function focusTagEntryRenameInput() {
      if (!directoriesListEl) return;
      const input = directoriesListEl.querySelector(".tagEntryRenameInput");
      if (!input) return;
      try { input.focus(); input.select(); } catch {}
    }

    function cancelTagEntryRename() {
      const state = TAG_ENTRY_RENAME_STATE;
      if (!state) return;
      if (state.placeholder) {
        clearBulkTagPlaceholder();
        renderDirectoriesPane(true);
        return;
      }
      TAG_ENTRY_RENAME_STATE = null;
      renderDirectoriesPane(true);
    }

    function commitTagEntryRename(inputEl) {
      if (!TAG_ENTRY_RENAME_STATE || !inputEl) return;
      const state = TAG_ENTRY_RENAME_STATE;
      const desired = normalizeTag(inputEl.value || "");
      if (!desired) {
        showStatusMessage("Tag name cannot be empty.");
        renderDirectoriesPane(true);
        return;
      }
      const isPlaceholder = !!state.placeholder;
      TAG_ENTRY_RENAME_STATE = null;
      if (!isPlaceholder && desired === state.tag) {
        showStatusMessage("Tag name unchanged.");
        renderDirectoriesPane(true);
        return;
      }
      if (isPlaceholder) {
        clearBulkTagPlaceholder();
        metaAddUserTagsBulk(state.paths, [desired]);
        finalizeBulkSelectionAction();
        return;
      }
      const changed = renameTagForPaths(state.tag, desired, state.paths);
      if (!changed) {
        showStatusMessage("No folders updated.");
        renderDirectoriesPane(true);
        return;
      }
      metaScheduleSave();
      refreshAfterTagMetadataChange();
    }

    function metaToggleFavorite(path) {
      const p = String(path || "");
      const tags = metaGetTags(p);
      const has = tags.includes(FAVORITE_TAG);
      const next = has ? tags.filter(t => t !== FAVORITE_TAG) : [FAVORITE_TAG].concat(tags.filter(t => t !== FAVORITE_TAG));
      WS.meta.dirTags.set(p, normalizeTagList(next));
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaToggleHidden(path) {
      const p = String(path || "");
      const tags = metaGetTags(p);
      const has = tags.includes(HIDDEN_TAG);
      const next = has ? tags.filter(t => t !== HIDDEN_TAG) : [HIDDEN_TAG].concat(tags.filter(t => t !== HIDDEN_TAG));
      WS.meta.dirTags.set(p, normalizeTagList(next));
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      syncHiddenUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaAddUserTagsBulk(paths, tagsToAdd) {
      const add = normalizeTagList(tagsToAdd).filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
      if (!add.length) return;

      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;

      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const fav = metaHasFavorite(p);
        const hidden = metaHasHidden(p);
        const curUser = metaGetUserTags(p);
        const mergedUser = normalizeTagList(curUser.concat(add));
        const merged = [];
        if (fav) merged.push(FAVORITE_TAG);
        if (hidden) merged.push(HIDDEN_TAG);
        merged.push(...mergedUser);
        WS.meta.dirTags.set(p, normalizeTagList(merged));
      }

      WS.meta.dirty = true;
      metaScheduleSave();
      TAG_EDIT_PATH = null;
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaSetFavoriteBulk(paths, enable) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const target = !!enable;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const tags = metaGetTags(p);
        const has = tags.includes(FAVORITE_TAG);
        if (target === has) continue;
        const next = target ? [FAVORITE_TAG].concat(tags.filter(t => t !== FAVORITE_TAG)) : tags.filter(t => t !== FAVORITE_TAG);
        WS.meta.dirTags.set(p, normalizeTagList(next));
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaSetHiddenBulk(paths, enable) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const target = !!enable;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const tags = metaGetTags(p);
        const has = tags.includes(HIDDEN_TAG);
        if (target === has) continue;
        const next = target ? [HIDDEN_TAG].concat(tags.filter(t => t !== HIDDEN_TAG)) : tags.filter(t => t !== HIDDEN_TAG);
        WS.meta.dirTags.set(p, normalizeTagList(next));
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      syncHiddenUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaComputeFingerprints() {
      WS.meta.dirFingerprints.clear();
      if (!WS.root) return;

      (function walk(node) {
        for (const d of node.childrenDirs) walk(d);

        const fileIds = node.childrenFiles.slice().sort();
        const childFps = node.childrenDirs.slice().map(d => {
          const fp = WS.meta.dirFingerprints.get(d.path || "");
          return Number.isFinite(fp) ? fp : 0;
        }).sort((a,b) => a - b);

        let s = "F:";
        for (let i = 0; i < fileIds.length; i++) s += fileIds[i] + "|";
        s += "D:";
        for (let i = 0; i < childFps.length; i++) s += childFps[i] + "|";

        const fp = hash32(s);
        WS.meta.dirFingerprints.set(node.path || "", fp);
      })(WS.root);
    }

    function metaMakeScoresLogObject() {
      const folders = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        folders[path] = { score: metaGetScore(path), fp: fp >>> 0 };
      }
      return {
        schema: 1,
        updatedAt: Date.now(),
        sortMode: normalizeDirSortMode(WS.meta.dirSortMode),
        folders
      };
    }

    function metaMakeTagsLogObject() {
      const folders = {};
      const tagByFp = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tags = metaGetTags(path);
        folders[path] = { fp: fp >>> 0, tags: tags };
        if (tags && tags.length) {
          const k = String(fp >>> 0);
          if (!tagByFp[k]) tagByFp[k] = tags.slice();
        }
      }
      const pending = WS.meta && WS.meta.pendingTagsByPath ? WS.meta.pendingTagsByPath : null;
      if (pending && pending.size) {
        for (const [path, tags] of pending.entries()) {
          const p = String(path || "");
          if (!p || folders[p]) continue;
          const tg = normalizeTagList(tags);
          if (!tg.length) continue;
          folders[p] = { fp: 0, tags: tg };
        }
      }
      return {
        schema: 1,
        updatedAt: Date.now(),
        folders,
        tagByFp
      };
    }

    function metaMakeOptionsLogObject() {
      return {
        schema: 1,
        updatedAt: Date.now(),
      options: normalizeOptions(WS.meta.options || null)
    };
  }

    function metaMakeKeybindsLogObject() {
      const bindings = Array.isArray(WS.meta.keybinds) ? WS.meta.keybinds : defaultKeybinds("right");
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";
      return {
        schema: 1,
        updatedAt: Date.now(),
        preset: presetId,
        bindings: bindings.map(b => ({ id: b.id, key: b.key || "" }))
      };
    }

    function metaMakeLogObject() {
      const folders = {};
      const tagByFp = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tags = metaGetTags(path);
        folders[path] = { score: metaGetScore(path), fp: fp >>> 0, tags: tags };
        if (tags && tags.length) {
          const k = String(fp >>> 0);
          if (!tagByFp[k]) tagByFp[k] = tags.slice();
        }
      }
      return {
        schema: 2,
        updatedAt: Date.now(),
        sortMode: normalizeDirSortMode(WS.meta.dirSortMode),
        folders,
        tagByFp,
        options: normalizeOptions(WS.meta.options || null)
      };
    }

    function metaApplyScoresLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = normalizeDirSortMode(log.sortMode);
      WS.meta.dirSortMode = sortMode;

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldByPath = new Map();
      const oldByFp = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const sc = (it && Number.isFinite(it.score)) ? (it.score | 0) : 0;
        const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
        oldByPath.set(p, { score: sc, fp });
        if (!oldByFp.has(fp)) oldByFp.set(fp, []);
        oldByFp.get(fp).push({ path: p, score: sc });
      }

      const claimed = new Set();
      WS.meta.dirScores.clear();

      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        if (oldByPath.has(path)) {
          WS.meta.dirScores.set(path, oldByPath.get(path).score | 0);
          claimed.add(path);
          continue;
        }
        const list = oldByFp.get(fp >>> 0) || null;
        if (list && list.length) {
          let picked = null;
          for (let i = 0; i < list.length; i++) {
            const cand = list[i];
            if (!claimed.has(cand.path)) { picked = cand; break; }
          }
          if (picked) {
            WS.meta.dirScores.set(path, picked.score | 0);
            claimed.add(picked.path);
            continue;
          }
        }
        WS.meta.dirScores.set(path, 0);
      }
    }

    function stashPendingTagsFromLog(oldTagsByPath) {
      if (!WS.meta) return;
      WS.meta.pendingTagsByPath = new Map();
      for (const [path, tags] of oldTagsByPath.entries()) {
        if (!tags || !tags.length) continue;
        WS.meta.pendingTagsByPath.set(String(path || ""), normalizeTagList(tags));
      }
    }

    function applyPendingTagsToWorkspace() {
      const pending = WS.meta && WS.meta.pendingTagsByPath;
      if (!pending || !pending.size) return false;
      let applied = false;
      for (const [path, tags] of pending.entries()) {
        if (!WS.dirByPath.has(path)) continue;
        WS.meta.dirTags.set(path, normalizeTagList(tags));
        pending.delete(path);
        applied = true;
      }
      return applied;
    }

    function metaApplyTagsLog(log) {
      if (!log || typeof log !== "object") return;

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldTagsByPath = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
        if (tg.length) oldTagsByPath.set(p, tg);
      }

      const oldTagByFp = new Map();
      if (log.tagByFp && typeof log.tagByFp === "object") {
        for (const k of Object.keys(log.tagByFp)) {
          const fp = (Number(k) >>> 0) || 0;
          const tg = normalizeTagList(log.tagByFp[k]);
          if (tg.length) oldTagByFp.set(fp >>> 0, tg);
        }
      }
      if (!oldTagByFp.size) {
        for (const [p, tg] of oldTagsByPath.entries()) {
          const it = folders[p];
          const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
          if (!fp) continue;
          if (!oldTagByFp.has(fp)) oldTagByFp.set(fp, tg.slice());
        }
      }

      stashPendingTagsFromLog(oldTagsByPath);

      WS.meta.dirTags.clear();
      for (const [path, node] of WS.dirByPath.entries()) {
        if (oldTagsByPath.has(path)) {
          WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
          if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
          continue;
        }
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tg = oldTagByFp.get(fp >>> 0) || [];
        WS.meta.dirTags.set(path, tg.slice());
      }
    }

    function metaApplyOptionsLog(log) {
      if (!log || typeof log !== "object") return;
      WS.meta.options = normalizeOptions(log.options || null);
      applyDefaultViewFromOptions();
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
      applyOnlineFeatureVisibility();
    }

    function metaApplyKeybindsLog(log) {
      if (!log || typeof log !== "object") return;
      const normalized = normalizeKeybinds(log);
      WS.meta.keybinds = normalized.bindings;
      WS.meta.keybindsPreset = normalized.presetId;
      rebuildKeybindIndex();
    }

    function metaApplyFromLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = normalizeDirSortMode(log.sortMode);
      WS.meta.dirSortMode = sortMode;

      WS.meta.options = normalizeOptions(log.options || null);
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
      applyOnlineFeatureVisibility();

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldByPath = new Map();
      const oldByFp = new Map();

      const oldTagsByPath = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const sc = (it && Number.isFinite(it.score)) ? (it.score | 0) : 0;
        const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
        oldByPath.set(p, { score: sc, fp });
        if (!oldByFp.has(fp)) oldByFp.set(fp, []);
        oldByFp.get(fp).push({ path: p, score: sc });

        const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
        if (tg.length) oldTagsByPath.set(p, tg);
      }

      const oldTagByFp = new Map();
      if (log.tagByFp && typeof log.tagByFp === "object") {
        for (const k of Object.keys(log.tagByFp)) {
          const fp = (Number(k) >>> 0) || 0;
          const tg = normalizeTagList(log.tagByFp[k]);
          if (tg.length) oldTagByFp.set(fp >>> 0, tg);
        }
      }
      if (!oldTagByFp.size) {
        for (const [p, tg] of oldTagsByPath.entries()) {
          const it = folders[p];
          const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
          if (!fp) continue;
          if (!oldTagByFp.has(fp)) oldTagByFp.set(fp, tg.slice());
        }
      }

      stashPendingTagsFromLog(oldTagsByPath);

      const claimed = new Set();
      WS.meta.dirScores.clear();

      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        if (oldByPath.has(path)) {
          WS.meta.dirScores.set(path, oldByPath.get(path).score | 0);
          claimed.add(path);
          continue;
        }
        const list = oldByFp.get(fp >>> 0) || null;
        if (list && list.length) {
          let picked = null;
          for (let i = 0; i < list.length; i++) {
            const cand = list[i];
            if (!claimed.has(cand.path)) { picked = cand; break; }
          }
          if (picked) {
            WS.meta.dirScores.set(path, picked.score | 0);
            claimed.add(picked.path);
            continue;
          }
        }
        WS.meta.dirScores.set(path, 0);
      }

      WS.meta.dirTags.clear();
      for (const [path, node] of WS.dirByPath.entries()) {
        if (oldTagsByPath.has(path)) {
          WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
          if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
          continue;
        }
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tg = oldTagByFp.get(fp >>> 0) || [];
        WS.meta.dirTags.set(path, tg.slice());
      }

      applyDefaultViewFromOptions();
      syncMetaButtons();
      renderOptionsUi();
    }

    function metaParseText(text) {
      const t = String(text || "").trim();
      if (!t) return null;
      try { return JSON.parse(t); } catch { return null; }
    }

    function metaLocalKeys() {
      const k = String(WS.meta.storageKey || "");
      if (!k) return null;
      return {
        scores: `LocalGalleryScores::${k}`,
        tags: `LocalGalleryTags::${k}`,
        options: `LocalGalleryPreferences::${k}`,
        keybinds: `LocalGalleryKeyboard::${k}`,
        legacy: `LocalGalleryVotes::${k}`
      };
    }

    function metaLoadLocalDoc(key) {
      if (!key) return null;
      try {
        const txt = localStorage.getItem(key);
        return metaParseText(txt);
      } catch { return null; }
    }

    function metaSaveLocalDoc(key, obj) {
      if (!key) return;
      try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
    }

    function metaSaveLocalNow() {
      const keys = metaLocalKeys();
      if (!keys) return;
      metaSaveLocalDoc(keys.scores, metaMakeScoresLogObject());
      metaSaveLocalDoc(keys.tags, metaMakeTagsLogObject());
      metaSaveLocalDoc(keys.options, metaMakeOptionsLogObject());
      metaSaveLocalDoc(keys.keybinds, metaMakeKeybindsLogObject());
      WS.meta.dirty = false;
    }

    function normalizeWorkspaceRelPath(path) {
      const raw = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!raw) return "";
      const parts = raw.split("/").filter(Boolean);
      if (!parts.length) return "";
      if (parts.includes(".local-gallery")) return "";
      return parts.join("/");
    }

    function makeTrashIndexLogObject() {
      const folders = {};
      for (const [name, rec] of (WS.meta.trashOriginsByName || new Map()).entries()) {
        const folderName = String(name || "").trim();
        const originalPath = normalizeWorkspaceRelPath(rec && rec.originalPath);
        if (!folderName || !isValidFolderName(folderName) || !originalPath) continue;
        const itemCount = Math.max(0, Number(rec && rec.itemCount) || 0) | 0;
        const trashedAt = Math.max(0, Number(rec && rec.trashedAt) || 0) | 0;
        folders[folderName] = { originalPath, itemCount, trashedAt };
      }
      return { version: 1, folders };
    }

    function applyTrashIndexLog(doc) {
      const out = new Map();
      const src = doc && doc.folders && typeof doc.folders === "object" ? doc.folders : {};
      for (const key of Object.keys(src)) {
        const folderName = String(key || "").trim();
        if (!folderName || !isValidFolderName(folderName)) continue;
        const rec = src[key];
        const originalPath = normalizeWorkspaceRelPath(rec && rec.originalPath);
        if (!originalPath) continue;
        const itemCount = Math.max(0, Number(rec && rec.itemCount) || 0) | 0;
        const trashedAt = Math.max(0, Number(rec && rec.trashedAt) || 0) | 0;
        out.set(folderName, { originalPath, itemCount, trashedAt });
      }
      WS.meta.trashOriginsByName = out;
    }

    function isTrashVirtualDirNode(node) {
      return !!(node && node.trashVirtual);
    }

    function makeTrashVirtualDirNode(name, rec) {
      const folderName = String(name || "");
      if (!folderName) return null;
      const originalPath = normalizeWorkspaceRelPath(rec && rec.originalPath);
      const itemCount = Math.max(0, Number(rec && rec.itemCount) || 0) | 0;
      const trashedAt = Math.max(0, Number(rec && rec.trashedAt) || 0) | 0;
      return {
        type: "dir",
        name: folderName,
        parent: WS.root || null,
        childrenDirs: [],
        childrenFiles: [],
        path: `@trash/${folderName}`,
        trashVirtual: true,
        trashName: folderName,
        trashOriginalPath: originalPath,
        trashItemCount: itemCount,
        trashTrashedAt: trashedAt
      };
    }

    async function saveTrashIndexToFs() {
      if (!WS.meta.fsTrashIndexFileHandle) return;
      await metaSaveFsDoc(WS.meta.fsTrashIndexFileHandle, makeTrashIndexLogObject());
    }

    async function loadTrashStateFromFs() {
      WS.meta.trashVirtualDirs = [];
      if (!WS.meta.fsRootHandle || !WS.meta.fsTrashIndexFileHandle) {
        WS.meta.trashOriginsByName = new Map();
        return;
      }

      const doc = await metaLoadFsDoc(WS.meta.fsTrashIndexFileHandle);
      applyTrashIndexLog(doc);

      const trashHandle = await ensureTrashDirectoryHandle(WS.meta.fsRootHandle);
      if (!trashHandle) return;

      const names = [];
      for await (const [name, handle] of trashHandle.entries()) {
        if (!name || handle.kind !== "directory") continue;
        names.push(String(name));
      }
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

      const validNames = new Set(names);
      let changed = false;
      for (const key of Array.from(WS.meta.trashOriginsByName.keys())) {
        if (validNames.has(key)) continue;
        WS.meta.trashOriginsByName.delete(key);
        changed = true;
      }

      const nodes = [];
      for (const name of names) {
        const rec = WS.meta.trashOriginsByName.get(name) || null;
        const node = makeTrashVirtualDirNode(name, rec);
        if (node) nodes.push(node);
      }
      nodes.sort((a, b) => {
        const ta = Math.max(0, Number(a?.trashTrashedAt) || 0);
        const tb = Math.max(0, Number(b?.trashTrashedAt) || 0);
        if (ta !== tb) return tb - ta;
        const ap = String(a?.trashOriginalPath || "");
        const bp = String(b?.trashOriginalPath || "");
        const c = ap.localeCompare(bp, undefined, { numeric: true, sensitivity: "base" });
        if (c) return c;
        return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" });
      });
      WS.meta.trashVirtualDirs = nodes;

      if (changed) {
        await saveTrashIndexToFs();
      }
    }

    function getTrashVirtualDirs() {
      return Array.isArray(WS.meta.trashVirtualDirs) ? WS.meta.trashVirtualDirs.slice() : [];
    }

    async function metaEnsureFsHandles(rootHandle) {
      if (!rootHandle) return false;
      try {
        const sys = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
        const scoresFile = await sys.getFileHandle("folder-scores.log.json", { create: true });
        const tagsFile = await sys.getFileHandle("folder-tags.log.json", { create: true });
        const optionsFile = await sys.getFileHandle("preferences.log.json", { create: true });
        const keybindsFile = await sys.getFileHandle("keyboard-configuration.log.json", { create: true });
        const legacyFile = await sys.getFileHandle("folder-votes.log.json", { create: true });
        const trashIndexFile = await sys.getFileHandle("trash-index.log.json", { create: true });
        WS.meta.fsRootHandle = rootHandle;
        WS.meta.fsSysDirHandle = sys;
        WS.meta.fsScoresFileHandle = scoresFile;
        WS.meta.fsTagsFileHandle = tagsFile;
        WS.meta.fsOptionsFileHandle = optionsFile;
        WS.meta.fsKeybindsFileHandle = keybindsFile;
        WS.meta.fsLegacyFileHandle = legacyFile;
        WS.meta.fsTrashIndexFileHandle = trashIndexFile;
        WS.meta.storageMode = "fs";
        await ensureSiteLogHandles();
        return true;
      } catch {
        return false;
      }
    }

    async function metaLoadFsDoc(fh) {
      if (!fh) return null;
      try {
        const f = await fh.getFile();
        const txt = await f.text();
        return metaParseText(txt);
      } catch {
        return null;
      }
    }

    async function metaSaveFsDoc(fh, obj) {
      if (!fh) return;
      const txt = JSON.stringify(obj);
      try {
        const writable = await fh.createWritable();
        await writable.write(txt);
        await writable.close();
      } catch {}
    }

    async function metaSaveFsNow() {
      const scores = WS.meta.fsScoresFileHandle;
      const tags = WS.meta.fsTagsFileHandle;
      const options = WS.meta.fsOptionsFileHandle;
      const keybinds = WS.meta.fsKeybindsFileHandle;
      await metaSaveFsDoc(scores, metaMakeScoresLogObject());
      await metaSaveFsDoc(tags, metaMakeTagsLogObject());
      await metaSaveFsDoc(options, metaMakeOptionsLogObject());
      await metaSaveFsDoc(keybinds, metaMakeKeybindsLogObject());
      WS.meta.dirty = false;
    }

    function metaScheduleSave() {
      if (WS.meta.saveTimer) return;
      WS.meta.saveTimer = setTimeout(async () => {
        WS.meta.saveTimer = null;
        if (!WS.meta.dirty) return;
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      }, 500);
    }

    function showBusyOverlay(text) {
      if (busyLabel) busyLabel.textContent = text || "Working...";
      if (busyOverlay) busyOverlay.classList.add("active");
    }

    function hideBusyOverlay() {
      if (busyOverlay) busyOverlay.classList.remove("active");
    }

    let onlineProfileLoading = false;
    let ONLINE_PROFILE_STATUS_TIMER = null;

    function setOnlineProfileStatus(text, type, autoHide = true) {
      if (!onlineProfileStatus) return;
      onlineProfileStatus.textContent = text || "—";
      if (type === "error") onlineProfileStatus.style.color = "#b00020";
      else if (type === "success") onlineProfileStatus.style.color = "#0a7d2b";
      else onlineProfileStatus.style.color = "";
      if (ONLINE_PROFILE_STATUS_TIMER) {
        clearTimeout(ONLINE_PROFILE_STATUS_TIMER);
        ONLINE_PROFILE_STATUS_TIMER = null;
      }
      if (autoHide && text && text !== "—" && text !== "Loading...") {
        ONLINE_PROFILE_STATUS_TIMER = setTimeout(() => {
          onlineProfileStatus.textContent = "—";
          onlineProfileStatus.style.color = "";
          ONLINE_PROFILE_STATUS_TIMER = null;
        }, 2500);
      }
    }

    async function handleAddOnlineProfile(mode) {
      if (onlineProfileLoading) return;
      if (!onlineProfileInput || !onlineProfileAddProfileBtn || !onlineProfileAddPostsBtn) return;
      const api = (typeof window !== "undefined") ? window.LGOnline : null;
      if (!api || typeof api.parseOnlineProfileUrl !== "function") {
        setOnlineProfileStatus("Online adapter unavailable.", "error");
        return;
      }
      const raw = onlineProfileInput.value || "";
      const parsed = api.parseOnlineProfileUrl(raw);
      if (!parsed || !parsed.ok) {
        setOnlineProfileStatus("Invalid URL.", "error");
        return;
      }
      parsed.sourceUrl = raw;
      const existing = ONLINE_PROFILE_CACHE.get(parsed.profileKey);
      const basePath = normalizeOnlineBasePath(WS.nav?.dirNode?.path || "");
      const addMode = mode === "posts" ? "posts" : "profile";
      const placementKey = makeOnlinePlacementId(parsed.profileKey, addMode, basePath);
      if (existing && existing.injectedPlacements && existing.injectedPlacements.has(placementKey)) {
        setOnlineProfileStatus("Profile already added here.", "error");
        return;
      }

      onlineProfileLoading = true;
      onlineProfileInput.disabled = true;
      onlineProfileAddProfileBtn.disabled = true;
      onlineProfileAddPostsBtn.disabled = true;
      setOnlineProfileStatus("Loading...", "", false);
      showBusyOverlay("Loading profile...");
      try {
        const progressCb = (page, count) => {
          if (busyLabel) busyLabel.textContent = `Loading page ${page} (${count} posts)...`;
          if (onlineProfileStatus) onlineProfileStatus.textContent = `Loading page ${page}...`;
        };
        const result = await api.fetchOnlineProfilePosts(parsed.service, parsed.userId, parsed.origin, { progressCb });
        appendOnlineApiResponses(result && Array.isArray(result.responses) ? result.responses : []);
        const posts = result && Array.isArray(result.posts) ? result.posts : [];
        if (!posts || !posts.length) {
          if (result && result.error) {
            setOnlineProfileStatus(getOnlineApiErrorMessage(result.error), "error");
          } else {
            setOnlineProfileStatus("No posts found.", "error");
          }
          return;
        }
        const normalized = api.normalizeOnlinePosts(posts, { origin: parsed.origin, dataRoot: parsed.dataRoot });
        const saveResult = await saveOnlineProfileVersion(parsed, normalized, raw);
        const placementResult = await siteLogUpsertPlacement(parsed.profileKey, raw, {
          id: placementKey,
          mode: addMode,
          basePath
        });
        const resolvedPlacementKey = placementResult && placementResult.placementId ? placementResult.placementId : placementKey;
        clearOnlineMaterializedPlacement(parsed.profileKey, resolvedPlacementKey);
        await siteLogSaveRenames();
        ONLINE_PROFILE_CACHE.set(parsed.profileKey, {
          profile: parsed,
          posts: normalized,
          fetchedAt: Date.now(),
          injected: false,
          injectedPlacements: existing && existing.injectedPlacements ? existing.injectedPlacements : new Set()
        });
        const injected = injectOnlineProfileIntoWorkspace(parsed.profileKey, {
          mode: addMode,
          basePath,
          placementId: resolvedPlacementKey
        });
        if (injected.ok) {
          const savedNote = saveResult && saveResult.saved ? "Saved log." : "Not saved.";
          setOnlineProfileStatus(`Added ${injected.files} files. ${savedNote}`, injected && injected.ok && saveResult && saveResult.saved ? "success" : "");
          onlineProfileInput.value = "";
        } else if (injected.error === "already-added") {
          setOnlineProfileStatus("Profile already added.", "error");
        } else if (injected.error === "no-files") {
          setOnlineProfileStatus("No media files found.", "error");
        } else {
          const savedNote = saveResult && saveResult.saved ? "Saved log." : "Not saved.";
          setOnlineProfileStatus(`Loaded ${normalized.length} posts. ${savedNote}`, saveResult && saveResult.saved ? "success" : "");
        }
        renderOnlineUi();
      } catch {
        setOnlineProfileStatus("Failed to load profile.", "error");
      } finally {
        onlineProfileLoading = false;
        if (onlineProfileInput) onlineProfileInput.disabled = false;
        if (onlineProfileAddProfileBtn) onlineProfileAddProfileBtn.disabled = false;
        if (onlineProfileAddPostsBtn) onlineProfileAddPostsBtn.disabled = false;
        hideBusyOverlay();
      }
    }

    function metaInitForCurrentWorkspace() {
      metaComputeFingerprints();

      if (WS.meta.storageMode === "local") {
        const keys = metaLocalKeys();
        const scoresLog = keys ? metaLoadLocalDoc(keys.scores) : null;
        const tagsLog = keys ? metaLoadLocalDoc(keys.tags) : null;
        const optionsLog = keys ? metaLoadLocalDoc(keys.options) : null;
        const keybindsLog = keys ? metaLoadLocalDoc(keys.keybinds) : null;

        if (scoresLog) metaApplyScoresLog(scoresLog);
        if (tagsLog) metaApplyTagsLog(tagsLog);
        if (optionsLog) metaApplyOptionsLog(optionsLog);
        if (keybindsLog) metaApplyKeybindsLog(keybindsLog);

        if (!scoresLog && !tagsLog && !optionsLog && !keybindsLog && keys) {
          /* LEGACY MIGRATION (remove later): read combined log and split it. */
          const legacyLog = metaLoadLocalDoc(keys.legacy);
          if (legacyLog) {
            metaApplyFromLog(legacyLog);
          }
        }
      }

      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      renderOptionsUi();
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
    }

    async function metaInitForCurrentWorkspaceFs() {
      metaComputeFingerprints();
      const scoresLog = await metaLoadFsDoc(WS.meta.fsScoresFileHandle);
      const tagsLog = await metaLoadFsDoc(WS.meta.fsTagsFileHandle);
      const optionsLog = await metaLoadFsDoc(WS.meta.fsOptionsFileHandle);
      const keybindsLog = await metaLoadFsDoc(WS.meta.fsKeybindsFileHandle);

      if (scoresLog) metaApplyScoresLog(scoresLog);
      if (tagsLog) metaApplyTagsLog(tagsLog);
      if (optionsLog) metaApplyOptionsLog(optionsLog);
      if (keybindsLog) metaApplyKeybindsLog(keybindsLog);

      if (!scoresLog && !tagsLog && !optionsLog && !keybindsLog) {
        /* LEGACY MIGRATION (remove later): read combined log and split it. */
        const legacyLog = await metaLoadFsDoc(WS.meta.fsLegacyFileHandle);
        if (legacyLog) {
          metaApplyFromLog(legacyLog);
        }
      }
      await siteLogLoadRenames();
      await loadTrashStateFromFs();
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      renderOptionsUi();
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
    }

    async function metaReapplyFsScoresAndTags() {
      metaComputeFingerprints();
      const scoresLog = await metaLoadFsDoc(WS.meta.fsScoresFileHandle);
      const tagsLog = await metaLoadFsDoc(WS.meta.fsTagsFileHandle);
      if (scoresLog) metaApplyScoresLog(scoresLog);
      if (tagsLog) metaApplyTagsLog(tagsLog);
    }

    function buildWorkspaceFromFiles(fileList) {
      resetWorkspace();
      clearWorkspaceEmptyState();

      WS.root = makeDirNode("root", null);
      WS.root.path = "";
      WS.dirByPath.set("", WS.root);
      applyMediaFilterFromOptions();

      const files = Array.from(fileList || []);

      for (const f of files) {
        if (!f || !f.name) continue;
        if (f.name[0] === ".") continue;

        const relPath = f.webkitRelativePath || f.name;
        if (relPath.split("/").includes(".local-gallery")) continue;

        const parts = relPath.split("/").filter(Boolean);
        if (!parts.length) continue;

        const filename = parts[parts.length - 1];
        const dirPath = parts.slice(0, -1).join("/");
        const isImg = isImageName(filename);
        const isVid = isVideoName(filename);
        if (!isImg && !isVid) continue;

        const id = fileKey(f, relPath);
        if (WS.fileById.has(id)) continue;

        const extDot = filename.lastIndexOf(".");
        const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";

        const rec = {
          id,
          file: f,
          name: filename,
          relPath,
          dirPath,
          ext,
          type: isVid ? "video" : "image",
          size: f.size,
          lastModified: f.lastModified,
          url: null,
          thumbUrl: null,
          videoThumbUrl: null,
          indices: null,
          thumbMode: null,
          videoThumbMode: null
        };

        WS.fileById.set(id, rec);
        const dirNode = ensureDirPath(dirPath);
        dirNode.childrenFiles.push(id);
      }

      normalizeRootIfSingleDir();

      WS.view.randomSeed = computeWorkspaceSeed();
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      WS.meta.storageMode = "local";
      WS.meta.storageKey = String(WS.view.randomSeed >>> 0);

      metaInitForCurrentWorkspace();

      // Initialize Directories Pane at root listing
      WS.nav.dirNode = WS.root;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      syncMetaButtons();
      initDirHistory();
    }

    async function collectFilesFromDirHandle(dirHandle, basePath, out) {
      for await (const [name, handle] of dirHandle.entries()) {
        if (name === ".local-gallery") continue;
        if (handle.kind === "file") {
          const f = await handle.getFile();
          if (!f || !f.name) continue;
          if (f.name[0] === ".") continue;
          const relPath = basePath ? (basePath + "/" + name) : name;
          out.push({ file: f, relPath });
        } else if (handle.kind === "directory") {
          const nextBase = basePath ? (basePath + "/" + name) : name;
          await collectFilesFromDirHandle(handle, nextBase, out);
        }
      }
    }

    async function buildWorkspaceFromDirectoryHandle(rootHandle) {
      resetWorkspace();
      clearWorkspaceEmptyState();

      WS.root = makeDirNode("root", null);
      WS.root.path = "";
      WS.dirByPath.set("", WS.root);
      applyMediaFilterFromOptions();

      const all = [];
      await collectFilesFromDirHandle(rootHandle, "", all);

      for (const it of all) {
        const f = it.file;
        const relPath = it.relPath || f.name;
        if (relPath.split("/").includes(".local-gallery")) continue;

        const parts = relPath.split("/").filter(Boolean);
        if (!parts.length) continue;

        const filename = parts[parts.length - 1];
        const dirPath = parts.slice(0, -1).join("/");
        const isImg = isImageName(filename);
        const isVid = isVideoName(filename);
        if (!isImg && !isVid) continue;

        const id = fileKey(f, relPath);
        if (WS.fileById.has(id)) continue;

        const extDot = filename.lastIndexOf(".");
        const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";

        const rec = {
          id,
          file: f,
          name: filename,
          relPath,
          dirPath,
          ext,
          type: isVid ? "video" : "image",
          size: f.size,
          lastModified: f.lastModified,
          url: null,
          thumbUrl: null,
          videoThumbUrl: null,
          indices: null,
          thumbMode: null,
          videoThumbMode: null
        };

        WS.fileById.set(id, rec);
        const dirNode = ensureDirPath(dirPath);
        dirNode.childrenFiles.push(id);
      }

      normalizeRootIfSingleDir();

      WS.view.randomSeed = computeWorkspaceSeed();
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      const ok = await metaEnsureFsHandles(rootHandle);
      if (!ok) {
        WS.meta.storageMode = "local";
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        metaInitForCurrentWorkspace();
      } else {
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        await metaInitForCurrentWorkspaceFs();
        if (WS.meta.saveTimer) {
          clearTimeout(WS.meta.saveTimer);
          WS.meta.saveTimer = null;
        }
        const injected = await loadOnlineProfilesFromSiteLog({ render: false });
        if (injected) {
          WS.view.randomSeed = computeWorkspaceSeed();
          WS.view.randomCache = new Map();
          WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
          await metaReapplyFsScoresAndTags();
        }
        WS.meta.dirty = true;
        metaScheduleSave();
      }

      WS.nav.dirNode = WS.root;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      syncMetaButtons();
      initDirHistory();
    }

    function snapshotRefreshState() {
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      let entryKey = null;
      if (entry && entry.kind === "dir") {
        entryKey = { kind: "dir", path: String(entry.node?.path || "") };
      } else if (entry && entry.kind === "file") {
        const rec = WS.fileById.get(entry.id);
        entryKey = { kind: "file", relPath: String(rec?.relPath || "") };
      }

      return {
        dirPath: String(WS.nav.dirNode?.path || ""),
        entryKey,
        view: {
          filterMode: WS.view.filterMode,
          randomMode: !!WS.view.randomMode,
          loopWithinDir: WS.view.loopWithinDir,
          folderBehavior: WS.view.folderBehavior,
          folderScoreDisplay: WS.view.folderScoreDisplay,
          tagFolderActiveMode: WS.view.tagFolderActiveMode,
          tagFolderActiveTag: WS.view.tagFolderActiveTag,
          tagFolderOriginPath: WS.view.tagFolderOriginPath,
          favoritesMode: WS.view.favoritesMode,
          hiddenMode: WS.view.hiddenMode,
          dirSearchPinned: WS.view.dirSearchPinned,
          dirSearchQuery: WS.view.dirSearchQuery,
          searchRootActive: WS.view.searchRootActive,
          searchRootPath: WS.view.searchRootPath,
          searchAnchorPath: WS.view.searchAnchorPath,
          searchEntryRootPath: WS.view.searchEntryRootPath,
          searchRootIsFavorites: WS.view.searchRootIsFavorites,
          searchRootIsHidden: WS.view.searchRootIsHidden
        }
      };
    }

    function restoreRefreshViewState(viewState) {
      if (!viewState) return;
      WS.view.filterMode = viewState.filterMode;
      WS.view.randomMode = !!viewState.randomMode;
      WS.view.loopWithinDir = viewState.loopWithinDir;
      WS.view.folderBehavior = viewState.folderBehavior;
      WS.view.folderScoreDisplay = viewState.folderScoreDisplay;
      WS.view.tagFolderActiveMode = String(viewState.tagFolderActiveMode || "");
      WS.view.tagFolderActiveTag = String(viewState.tagFolderActiveTag || "");
      WS.view.tagFolderOriginPath = String(viewState.tagFolderOriginPath || "");
      WS.view.favoritesMode = !!viewState.favoritesMode;
      WS.view.hiddenMode = !!viewState.hiddenMode;
      WS.view.dirSearchPinned = !!viewState.dirSearchPinned;
      WS.view.dirSearchQuery = String(viewState.dirSearchQuery || "");
      WS.view.searchRootActive = !!viewState.searchRootActive;
      WS.view.searchRootPath = String(viewState.searchRootPath || "");
      WS.view.searchAnchorPath = String(viewState.searchAnchorPath || "");
      WS.view.searchEntryRootPath = String(viewState.searchEntryRootPath || "");
      WS.view.searchRootIsFavorites = !!viewState.searchRootIsFavorites;
      WS.view.searchRootIsHidden = !!viewState.searchRootIsHidden;
      WS.view.searchRootFavorites = WS.view.searchRootIsFavorites ? getAllFavoriteDirs() : [];
      WS.view.searchRootHidden = WS.view.searchRootIsHidden ? getAllHiddenDirs() : [];
    }

    function restoreRefreshSelection(entryKey) {
      if (!entryKey) return 0;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry) continue;
        if (entryKey.kind === "dir" && entry.kind === "dir") {
          if (String(entry.node?.path || "") === String(entryKey.path || "")) return i;
        } else if (entryKey.kind === "file" && entry.kind === "file") {
          const rec = WS.fileById.get(entry.id);
          if (String(rec?.relPath || "") === String(entryKey.relPath || "")) return i;
        }
      }
      return 0;
    }

    async function refreshWorkspaceFromRootHandle() {
      const rootHandle = WS.meta.fsRootHandle;
      if (!rootHandle) return;
      const state = snapshotRefreshState();

      await buildWorkspaceFromDirectoryHandle(rootHandle);

      restoreRefreshViewState(state?.view);
      const targetDir = WS.dirByPath.get(state?.dirPath || "") || WS.root;
      if (targetDir) WS.nav.dirNode = targetDir;

      if (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim()) {
        computeDirectorySearchResults();
      }

      rebuildDirectoriesEntries();
      const idx = restoreRefreshSelection(state?.entryKey);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    async function getDirectoryHandleForPath(rootHandle, path) {
      const norm = String(path || "").replace(/^\/+|\/+$/g, "");
      if (!norm) {
        DIR_HANDLE_CACHE.set("", rootHandle);
        return rootHandle;
      }
      if (DIR_HANDLE_CACHE.has(norm)) return DIR_HANDLE_CACHE.get(norm);
      let cur = rootHandle;
      let acc = "";
      const parts = norm.split("/").filter(Boolean);
      for (const part of parts) {
        acc = acc ? (acc + "/" + part) : part;
        if (DIR_HANDLE_CACHE.has(acc)) {
          cur = DIR_HANDLE_CACHE.get(acc);
          continue;
        }
        cur = await cur.getDirectoryHandle(part);
        DIR_HANDLE_CACHE.set(acc, cur);
      }
      return cur;
    }

    async function ensureDirectoryHandleForPath(rootHandle, path) {
      const norm = String(path || "").replace(/^\/+|\/+$/g, "");
      if (!norm) {
        DIR_HANDLE_CACHE.set("", rootHandle);
        return rootHandle;
      }
      if (DIR_HANDLE_CACHE.has(norm)) return DIR_HANDLE_CACHE.get(norm);
      let cur = rootHandle;
      let acc = "";
      const parts = norm.split("/").filter(Boolean);
      for (const part of parts) {
        acc = acc ? (acc + "/" + part) : part;
        if (DIR_HANDLE_CACHE.has(acc)) {
          cur = DIR_HANDLE_CACHE.get(acc);
          continue;
        }
        cur = await cur.getDirectoryHandle(part, { create: true });
        DIR_HANDLE_CACHE.set(acc, cur);
      }
      return cur;
    }

    function invalidateDirHandleCache(prefix) {
      const p = String(prefix || "");
      if (!p) {
        DIR_HANDLE_CACHE = new Map();
        return;
      }
      for (const key of Array.from(DIR_HANDLE_CACHE.keys())) {
        if (key === p || key.startsWith(p + "/")) DIR_HANDLE_CACHE.delete(key);
      }
    }

    async function copyDirectoryHandle(srcHandle, dstHandle) {
      for await (const [name, handle] of srcHandle.entries()) {
        if (name === ".local-gallery") continue;
        if (handle.kind === "file") {
          const file = await handle.getFile();
          const dstFile = await dstHandle.getFileHandle(name, { create: true });
          const writable = await dstFile.createWritable();
          await writable.write(file);
          await writable.close();
        } else if (handle.kind === "directory") {
          const childDst = await dstHandle.getDirectoryHandle(name, { create: true });
          await copyDirectoryHandle(handle, childDst);
        }
      }
    }

    async function renameDirectoryOnDisk(oldPath, newName) {
      const rootHandle = WS.meta.fsRootHandle;
      if (!rootHandle) throw new Error("No writable folder loaded.");

      const parts = String(oldPath || "").split("/").filter(Boolean);
      const oldName = parts.pop() || "";
      const parentPath = parts.join("/");

      const parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);

      let existing = null;
      try { existing = await parentHandle.getDirectoryHandle(newName); } catch {}
      if (existing) throw new Error("Target folder exists.");

      const srcHandle = await parentHandle.getDirectoryHandle(oldName);

      if (typeof srcHandle.move === "function") {
        try {
          await srcHandle.move(parentHandle, newName);
          return;
        } catch {}
      }

      const dstHandle = await parentHandle.getDirectoryHandle(newName, { create: true });
      await copyDirectoryHandle(srcHandle, dstHandle);
      await parentHandle.removeEntry(oldName, { recursive: true });
    }

    async function renameFileOnDisk(dirHandle, fileHandle, oldName, newName) {
      if (!dirHandle || !fileHandle) return false;
      if (typeof fileHandle.move === "function") {
        try {
          await fileHandle.move(dirHandle, newName);
          return true;
        } catch {}
      }
      try {
        const file = await fileHandle.getFile();
        const dstFile = await dirHandle.getFileHandle(newName, { create: true });
        const writable = await dstFile.createWritable();
        await writable.write(file);
        await writable.close();
        await dirHandle.removeEntry(oldName);
        return true;
      } catch {}
      return false;
    }

    function updateViewStatePathsForRename(oldPrefix, newPrefix) {
      WS.view.dirActionMenuPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.dirActionMenuPath);
      WS.view.searchRootPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchRootPath);
      WS.view.searchAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchAnchorPath);
      WS.view.searchEntryRootPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchEntryRootPath);
      WS.view.favoritesAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesAnchorPath);
      WS.view.hiddenAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenAnchorPath);

      if (WS.view.favoritesReturnState) {
        WS.view.favoritesReturnState.dirPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesReturnState.dirPath);
        if (WS.view.favoritesReturnState.sel && WS.view.favoritesReturnState.sel.kind === "dir") {
          WS.view.favoritesReturnState.sel.path = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesReturnState.sel.path);
        }
      }

      if (WS.view.hiddenReturnState) {
        WS.view.hiddenReturnState.dirPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenReturnState.dirPath);
        if (WS.view.hiddenReturnState.sel && WS.view.hiddenReturnState.sel.kind === "dir") {
          WS.view.hiddenReturnState.sel.path = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenReturnState.sel.path);
        }
      }

      WS.view.bulkTagSelectionsByDir = remapPathMapKeys(WS.view.bulkTagSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkFileSelectionsByDir = remapPathMapKeys(WS.view.bulkFileSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkTagSelectedPaths = remapPathSet(WS.view.bulkTagSelectedPaths, oldPrefix, newPrefix);
    }

    function updateMetaPathsForRename(oldPrefix, newPrefix) {
      WS.meta.dirScores = remapPathMapKeys(WS.meta.dirScores, oldPrefix, newPrefix);
      WS.meta.dirTags = remapPathMapKeys(WS.meta.dirTags, oldPrefix, newPrefix);
      WS.meta.pendingTagsByPath = remapPathMapKeys(WS.meta.pendingTagsByPath, oldPrefix, newPrefix);
      WS.meta.dirFingerprints = remapPathMapKeys(WS.meta.dirFingerprints, oldPrefix, newPrefix);
    }

    function applyRenameInMemory(dirNode, newName) {
      const oldPath = String(dirNode?.path || "");
      const parentPath = String(dirNode?.parent?.path || "");
      const newPath = parentPath ? (parentPath + "/" + newName) : newName;

      dirNode.name = newName;

      (function walk(node) {
        node.path = remapPathPrefix(oldPath, newPath, node.path || "");
        for (const d of node.childrenDirs) walk(d);
      })(dirNode);

      WS.dirByPath = remapPathMapKeys(WS.dirByPath, oldPath, newPath);
      updateMetaPathsForRename(oldPath, newPath);
      updateViewStatePathsForRename(oldPath, newPath);
      invalidateDirHandleCache(oldPath);
      return { oldPath, newPath };
    }

    function remapFileSelectionIds(idMap) {
      const next = new Set();
      for (const id of WS.view.bulkFileSelectedIds || []) {
        next.add(idMap.get(id) || id);
      }
      WS.view.bulkFileSelectedIds = next;
    }

    function remapFileIdsInDirTree(idMap) {
      for (const node of WS.dirByPath.values()) {
        if (!node || !node.childrenFiles) continue;
        for (let i = 0; i < node.childrenFiles.length; i++) {
          const oldId = String(node.childrenFiles[i] || "");
          if (idMap.has(oldId)) node.childrenFiles[i] = idMap.get(oldId);
        }
      }
    }

    function updateFileRecordsForRename(oldPrefix, newPrefix) {
      const idMap = new Map();
      const nextFileById = new Map();
      for (const [id, rec] of WS.fileById.entries()) {
        const oldDirPath = String(rec.dirPath || "");
        const oldRelPath = String(rec.relPath || "");
        const nextDirPath = remapPathPrefix(oldPrefix, newPrefix, oldDirPath);
        const nextRelPath = remapPathPrefix(oldPrefix, newPrefix, oldRelPath);
        const nextId = (nextRelPath !== oldRelPath) ? fileKey(rec.file, nextRelPath) : id;
        rec.dirPath = nextDirPath;
        rec.relPath = nextRelPath;
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }
      WS.fileById = nextFileById;
      if (idMap.size) {
        remapFileIdsInDirTree(idMap);
        remapFileSelectionIds(idMap);
        if (WS.preview.kind === "file" && WS.preview.fileId && idMap.has(WS.preview.fileId)) {
          WS.preview.fileId = idMap.get(WS.preview.fileId);
        }
        for (const entry of WS.nav.entries || []) {
          if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
            entry.id = idMap.get(String(entry.id || ""));
          }
        }
        for (const it of viewerItems || []) {
          if (it && !it.isFolder && idMap.has(String(it.id || ""))) it.id = idMap.get(String(it.id || ""));
        }
      }
      WS.view.randomCache = remapPathMapKeys(WS.view.randomCache, oldPrefix, newPrefix);
    }

    function updateFileRecordsForFileRenames(dirNode, renameMap) {
      if (!dirNode || !renameMap || !renameMap.size) return;
      const dirPath = String(dirNode.path || "");
      const idMap = new Map();
      const nextFileById = new Map();

      for (const [id, rec] of WS.fileById.entries()) {
        if (String(rec.dirPath || "") !== dirPath) {
          nextFileById.set(id, rec);
          continue;
        }
        const oldName = String(rec.name || "");
        if (!renameMap.has(oldName)) {
          nextFileById.set(id, rec);
          continue;
        }
        const newName = renameMap.get(oldName);
        const extDot = newName.lastIndexOf(".");
        const ext = extDot >= 0 ? newName.slice(extDot).toLowerCase() : "";
        const relPath = dirPath ? (dirPath + "/" + newName) : newName;
        rec.name = newName;
        rec.ext = ext;
        rec.relPath = relPath;
        const nextId = fileKey(rec.file, relPath);
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }

      WS.fileById = nextFileById;

      if (idMap.size) {
        remapFileIdsInDirTree(idMap);
        remapFileSelectionIds(idMap);
        if (WS.preview.kind === "file" && WS.preview.fileId && idMap.has(WS.preview.fileId)) {
          WS.preview.fileId = idMap.get(WS.preview.fileId);
        }
        for (const entry of WS.nav.entries || []) {
          if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
            entry.id = idMap.get(String(entry.id || ""));
          }
        }
        for (const it of viewerItems || []) {
          if (it && !it.isFolder && idMap.has(String(it.id || ""))) it.id = idMap.get(String(it.id || ""));
        }
      }

      WS.view.randomCache.delete(dirPath);
    }

    async function performBatchIndexForDir(dirNode, opts = {}) {
      if (!dirNode || !WS.meta.fsRootHandle) return { renamed: false, files: 0 };

      const dirPath = String(dirNode.path || "");
      const base = String(dirNode.name || "folder");
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);

      const files = [];
      const handleByName = new Map();
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind !== "file") continue;
        files.push({ name, handle });
        handleByName.set(name, handle);
      }

      const orderedNames = [];
      if (dirNode.preserveOrder) {
        const seen = new Set();
        for (const id of dirNode.childrenFiles || []) {
          const rec = WS.fileById.get(id);
          const name = rec?.name;
          if (!name || !handleByName.has(name) || seen.has(name)) continue;
          orderedNames.push(name);
          seen.add(name);
        }
        const remaining = files.map(f => f.name).sort((a, b) => compareIndexedNames(a, b));
        for (const name of remaining) {
          if (!seen.has(name)) orderedNames.push(name);
        }
      } else {
        orderedNames.push(...files.map(f => f.name).sort((a, b) => compareIndexedNames(a, b)));
      }

      const count = orderedNames.length;
      if (!count) return { renamed: false, files: 0 };
      const width = String(count).length + 1;

      const renamePlan = [];
      const existingNames = new Set(files.map(f => f.name));
      for (let i = 0; i < count; i++) {
        const idx = String(i + 1).padStart(width, "0");
        const oldName = orderedNames[i];
        const handle = handleByName.get(oldName);
        if (!handle) continue;
        const dot = oldName.lastIndexOf(".");
        const ext = dot >= 0 ? oldName.slice(dot + 1) : "";
        const newName = `${base}_${idx}${ext ? "." + ext : ""}`;
        if (newName === oldName) continue;
        renamePlan.push({ oldName, newName, handle, ext: ext ? "." + ext : "" });
      }

      if (!renamePlan.length) return { renamed: false, files: 0 };

      const renameMap = new Map();
      const labelBase = opts.label || "Batch Index";
      const hasConflicts = renamePlan.some(entry => existingNames.has(entry.newName));

      if (!hasConflicts) {
        for (let i = 0; i < renamePlan.length; i++) {
          const entry = renamePlan[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (${i + 1}/${renamePlan.length})`);
          else showBusyOverlay(`${labelBase}... ${i + 1}/${renamePlan.length}`);
          const ok = await renameFileOnDisk(dirHandle, entry.handle, entry.oldName, entry.newName);
          if (ok) renameMap.set(entry.oldName, entry.newName);
        }
      } else {
        const usedNames = new Set(existingNames);
        const tempPrefix = "__pg_tmp";
        const tempWidth = String(renamePlan.length).length + 1;
        const tempPlan = renamePlan.map((entry, idx) => {
          let tempName = "";
          do {
            const tempIdx = String(idx + 1).padStart(tempWidth, "0");
            const rand = Math.random().toString(36).slice(2, 10);
            tempName = `${tempPrefix}_${tempIdx}_${rand}${entry.ext}`;
          } while (usedNames.has(tempName));
          usedNames.add(tempName);
          return { ...entry, tempName };
        });

        const tempRenamed = [];
        for (let i = 0; i < tempPlan.length; i++) {
          const entry = tempPlan[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (1/2 ${i + 1}/${tempPlan.length})`);
          else showBusyOverlay(`${labelBase}... (1/2 ${i + 1}/${tempPlan.length})`);
          const ok = await renameFileOnDisk(dirHandle, entry.handle, entry.oldName, entry.tempName);
          if (ok) tempRenamed.push(entry);
        }

        for (let i = 0; i < tempRenamed.length; i++) {
          const entry = tempRenamed[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (2/2 ${i + 1}/${tempRenamed.length})`);
          else showBusyOverlay(`${labelBase}... (2/2 ${i + 1}/${tempRenamed.length})`);
          let tempHandle = null;
          try {
            tempHandle = await dirHandle.getFileHandle(entry.tempName);
          } catch {}
          if (!tempHandle) continue;
          const ok = await renameFileOnDisk(dirHandle, tempHandle, entry.tempName, entry.newName);
          if (ok) renameMap.set(entry.oldName, entry.newName);
        }
      }

      if (renameMap.size) {
        updateFileRecordsForFileRenames(dirNode, renameMap);
        return { renamed: true, files: renameMap.size };
      }
      return { renamed: false, files: 0 };
    }

    async function batchIndexFolderFiles(dirNode) {
      if (RENAME_BUSY) return false;
      if (!dirNode) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      RENAME_BUSY = true;
      showBusyOverlay("Batch Index I...");
      try {
        const res = await performBatchIndexForDir(dirNode, { label: "Batch Index I" });
        if (res.renamed) {
          resetDirFileOrder(dirNode, { silent: true });
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Batch Index I complete.");
          return true;
        }
        showStatusMessage("No files renamed.");
        return false;
      } finally {
        RENAME_BUSY = false;
        hideBusyOverlay();
      }
    }

    async function batchIndexChildFolderFiles(dirNode) {
      if (RENAME_BUSY) return false;
      if (!dirNode) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      const children = (dirNode.childrenDirs || []).slice();
      children.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      if (!children.length) {
        showStatusMessage("No subfolders found.");
        return false;
      }

      RENAME_BUSY = true;
      showBusyOverlay("Batch Index II...");
      let renamedAny = false;
      try {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!child) continue;
          const progress = `${i + 1}/${children.length}`;
          const res = await performBatchIndexForDir(child, { label: "Batch Index II", progress });
          if (res.renamed) {
            resetDirFileOrder(child, { silent: true });
            renamedAny = true;
          }
        }

        if (renamedAny) {
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Batch Index II complete.");
          return true;
        }
        showStatusMessage("No files renamed.");
        return false;
      } finally {
        RENAME_BUSY = false;
        hideBusyOverlay();
      }
    }

    async function renameFolderDirNode(dirNode, nextName) {
      if (!dirNode) return false;
      if (!dirNode.parent) {
        showStatusMessage("Root folder cannot be renamed.");
        return false;
      }
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Rename requires a writable folder.");
        return false;
      }

      const clean = normalizeFolderNameInput(nextName);
      if (!isValidFolderName(clean)) {
        showStatusMessage("Invalid folder name.");
        return false;
      }
      if (clean === String(dirNode.name || "")) return true;

      const lower = clean.toLowerCase();
      for (const d of dirNode.parent.childrenDirs || []) {
        if (d !== dirNode && String(d.name || "").toLowerCase() === lower) {
          showStatusMessage("A folder with that name already exists.");
          return false;
        }
      }

      const oldPath = String(dirNode.path || "");
      const state = snapshotRefreshState();
      showBusyOverlay("Renaming folder...");
      try {
        await renameDirectoryOnDisk(oldPath, clean);
        const { oldPath: prevPath, newPath } = applyRenameInMemory(dirNode, clean);
        updateFileRecordsForRename(prevPath, newPath);
        metaComputeFingerprints();
        WS.meta.dirty = true;

        try {
          if (WS.meta.storageMode === "fs") await metaSaveFsNow();
          else metaSaveLocalNow();
        } catch {}

        const entryKey = state?.entryKey || null;
        if (entryKey && entryKey.kind === "dir") {
          entryKey.path = remapPathPrefix(prevPath, newPath, entryKey.path);
        } else if (entryKey && entryKey.kind === "file") {
          entryKey.relPath = remapPathPrefix(prevPath, newPath, entryKey.relPath);
        }

        rebuildDirectoriesEntries();
        const idx = restoreRefreshSelection(entryKey);
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();

        showStatusMessage("Rename complete.");
        return true;
      } catch {
        showStatusMessage("Rename failed.");
        return false;
      } finally {
        hideBusyOverlay();
      }
    }

    if (refreshBtn) refreshBtn.addEventListener("click", async () => {
      try {
        await refreshWorkspaceFromRootHandle();
      } catch {}
    });

    openWritableBtn.addEventListener("click", async () => {
      if (!window.showDirectoryPicker) return;
      try {
        const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        if (!rootHandle) return;
        await buildWorkspaceFromDirectoryHandle(rootHandle);
      } catch {}
    });

    if (onlineProfileInput) {
      onlineProfileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAddOnlineProfile("profile");
        }
      });
      onlineProfileInput.addEventListener("input", () => {
        if (!onlineProfileLoading) setOnlineProfileStatus("—");
      });
    }

    if (onlineProfileAddProfileBtn) {
      onlineProfileAddProfileBtn.addEventListener("click", () => {
        handleAddOnlineProfile("profile");
      });
    }

    if (onlineProfileAddPostsBtn) {
      onlineProfileAddPostsBtn.addEventListener("click", () => {
        handleAddOnlineProfile("posts");
      });
    }

    /* =========================================================
       Sorting helpers
       ========================================================= */

    function byName(a, b) {
      return compareIndexedNames(a?.name || "", b?.name || "");
    }

    function dirSortModeOptions() {
      return [
        { value: "name", label: "Name" },
        { value: "score", label: "Score" },
        { value: "size-desc", label: "Size" },
        { value: "count-recursive", label: "Item count recursive" },
        { value: "count-non-recursive", label: "Item count non-recursive" }
      ];
    }

    function normalizeDirSortMode(mode) {
      const raw = String(mode || "");
      const allowed = dirSortModeOptions().map(opt => opt.value);
      if (allowed.includes(raw)) return raw;
      return "name";
    }

    function dirSortModeLabel(mode) {
      const normalized = normalizeDirSortMode(mode);
      const found = dirSortModeOptions().find(opt => opt.value === normalized);
      return found ? found.label : "Name";
    }

    function cycleDirSortMode(mode) {
      const values = dirSortModeOptions().map(opt => opt.value);
      const current = normalizeDirSortMode(mode);
      const idx = values.indexOf(current);
      return values[(idx >= 0 ? idx + 1 : 0) % values.length];
    }

    function buildDirSortMetrics() {
      const sizeByPath = new Map();
      const recursiveCountByPath = new Map();
      const nonRecursiveCountByPath = new Map();

      if (!WS.root) {
        return { sizeByPath, recursiveCountByPath, nonRecursiveCountByPath };
      }

      (function walk(node) {
        if (!node) return;
        const files = Array.isArray(node.childrenFiles) ? node.childrenFiles : [];
        const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
        const ownCount = files.length + dirs.length;

        let size = 0;
        for (let i = 0; i < files.length; i++) {
          const rec = WS.fileById.get(files[i]);
          const fileSize = Number(rec && rec.size);
          if (Number.isFinite(fileSize) && fileSize > 0) size += fileSize;
        }

        let recursiveCount = ownCount;
        for (let i = 0; i < dirs.length; i++) {
          const child = dirs[i];
          walk(child);
          const childPath = String(child?.path || "");
          size += sizeByPath.get(childPath) || 0;
          recursiveCount += recursiveCountByPath.get(childPath) || 0;
        }

        const path = String(node.path || "");
        sizeByPath.set(path, size);
        recursiveCountByPath.set(path, recursiveCount);
        nonRecursiveCountByPath.set(path, ownCount);
      })(WS.root);

      return { sizeByPath, recursiveCountByPath, nonRecursiveCountByPath };
    }

    function sortOnlineFoldersFirstForList(dirs) {
      const out = Array.isArray(dirs) ? dirs.slice() : [];
      if (!listOnlineFoldersFirstEnabled() || out.length < 2) return out;
      const online = [];
      const local = [];
      for (const node of out) {
        const kind = node?.onlineMeta?.kind;
        if (kind === "profile" || kind === "post") online.push(node);
        else local.push(node);
      }
      return online.concat(local);
    }

    function randomActionMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const mode = opt ? String(opt.randomActionMode || "firstFileJump") : "firstFileJump";
      if (mode === "firstFileJump" || mode === "randomFileSort") return mode;
      return "firstFileJump";
    }

    function randomSortAffectsFiles() {
      return !!WS.view.randomMode;
    }

    function reseedRandomSortMode() {
      const workspaceSeed = computeWorkspaceSeed();
      const timeSeed = (Date.now() >>> 0);
      const randSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
      WS.view.randomSeed = (workspaceSeed ^ timeSeed ^ randSeed) >>> 0;
      if (!WS.view.randomSeed) WS.view.randomSeed = (workspaceSeed || 1) >>> 0;
      WS.view.randomCache = new Map();
    }

    function sortDirsForDisplay(dirs) {
      const out = Array.isArray(dirs) ? dirs.slice() : [];
      const sortMode = normalizeDirSortMode(WS.meta.dirSortMode);
      if (sortMode === "score") {
        out.sort((a, b) => {
          const sa = metaGetScore(a?.path || "");
          const sb = metaGetScore(b?.path || "");
          if (sa !== sb) return sb - sa;
          return byName(a, b);
        });
        return sortOnlineFoldersFirstForList(out);
      }

      if (sortMode === "size-desc" || sortMode === "count-recursive" || sortMode === "count-non-recursive") {
        const metrics = buildDirSortMetrics();
        out.sort((a, b) => {
          const pathA = String(a?.path || "");
          const pathB = String(b?.path || "");

          let va = 0;
          let vb = 0;
          if (sortMode === "size-desc") {
            va = metrics.sizeByPath.get(pathA) || 0;
            vb = metrics.sizeByPath.get(pathB) || 0;
          } else if (sortMode === "count-recursive") {
            va = metrics.recursiveCountByPath.get(pathA) || 0;
            vb = metrics.recursiveCountByPath.get(pathB) || 0;
          } else {
            va = metrics.nonRecursiveCountByPath.get(pathA) || 0;
            vb = metrics.nonRecursiveCountByPath.get(pathB) || 0;
          }

          if (va !== vb) return vb - va;
          return byName(a, b);
        });
        return sortOnlineFoldersFirstForList(out);
      }

      out.sort(byName);
      return sortOnlineFoldersFirstForList(out);
    }

    function passesFilter(rec) {
      if (!rec) return false;
      const m = WS.view.filterMode;
      if (m === "images") return rec.type === "image";
      if (m === "videos") return rec.type === "video";
      if (m === "gifs") return rec.ext === ".gif";
      return true;
    }

    function dirItemCount(node) {
      if (isTrashVirtualDirNode(node)) {
        return Math.max(0, Number(node.trashItemCount) || 0) | 0;
      }
      let c = 0;
      for (const id of node.childrenFiles) {
        const rec = WS.fileById.get(id);
        if (passesFilter(rec)) c++;
      }
      for (const d of node.childrenDirs) c += dirItemCount(d);
      return c;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
      }[c]));
    }

    function getRandomOrderForDir(dirNode) {
      if (!dirNode) return [];
      const p = dirNode.path || "";
      if (WS.view.randomCache.has(p)) return WS.view.randomCache.get(p).slice();
      const ids = dirNode.childrenFiles.slice();
      ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      const seed = (WS.view.randomSeed ^ hash32(p)) >>> 0;
      const out = shuffleWithSeed(ids.slice(), seed);
      WS.view.randomCache.set(p, out.slice());
      return out.slice();
    }

    function getOrderedFileIdsForDir(dirNode, includeChildren = false) {
      if (!dirNode) return [];
      let ids = [];

      if (randomSortAffectsFiles()) {
        ids = getRandomOrderForDir(dirNode);
      } else if (dirNode.preserveOrder) {
        ids = dirNode.childrenFiles.slice();
      } else {
        ids = dirNode.childrenFiles.slice();
        ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      }

      ids = ids.filter(id => passesFilter(WS.fileById.get(id)));

      if (!includeChildren) return ids;

      for (const child of getChildDirsForNode(dirNode)) {
        const childIds = getOrderedFileIdsForDir(child, false);
        for (const id of childIds) ids.push(id);
      }

      return ids;
    }

    const DIR_FILE_DRAG = { id: null, dirPath: null };

    function canReorderFilesInDir(dirNode) {
      if (!WS.root || !dirNode) return false;
      if (WS.view.folderBehavior === "loop") return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
      return true;
    }

    function canReorderFilesInCurrentDir() {
      return canReorderFilesInDir(WS.nav.dirNode);
    }

    function findFileEntryIndexById(fileId) {
      const id = String(fileId || "");
      if (!id) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) return i;
      }
      return -1;
    }

    function syncAfterDirOrderChange(selectId, opts = {}) {
      const preserveSelection = !!opts.preserveSelection;
      const prevEntry = preserveSelection ? (WS.nav.entries[WS.nav.selectedIndex] || null) : null;
      rebuildDirectoriesEntries();
      if (selectId) {
        const idx = findFileEntryIndexById(selectId);
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      } else if (preserveSelection && prevEntry) {
        let idx = -1;
        if (prevEntry.kind === "file") {
          idx = findFileEntryIndexById(prevEntry.id);
        } else if (prevEntry.kind === "dir") {
          idx = findDirEntryIndexByPath(prevEntry.node?.path || "");
        } else if (prevEntry.kind === "tag") {
          const tag = String(prevEntry.tag || "");
          const label = String(prevEntry.label || prevEntry.tag || "");
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const entry = WS.nav.entries[i];
            if (entry && entry.kind === "tag" && String(entry.tag || "") === tag && String(entry.label || entry.tag || "") === label) {
              idx = i;
              break;
            }
          }
        }
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      } else {
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      }
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function isDirWithin(rootNode, childNode) {
      if (!rootNode || !childNode) return false;
      const rootPath = String(rootNode.path || "");
      let cur = childNode;
      while (cur) {
        if (cur === rootNode) return true;
        if (rootPath && String(cur.path || "") === rootPath) return true;
        cur = cur.parent;
      }
      return false;
    }

    function resetDirFileOrder(dirNode, opts = {}) {
      if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
      dirNode.preserveOrder = false;
      dirNode.childrenFiles.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      WS.view.randomCache.delete(dirNode.path || "");
      if (!opts.silent) {
        syncAfterDirOrderChange(opts.selectId || null);
      } else {
        const previewTarget = getPreviewTargetDir();
        const refreshPreview = !!(previewTarget && (isDirWithin(previewTarget, dirNode) || isDirWithin(dirNode, previewTarget)));
        if (refreshPreview) {
          renderPreviewPane(true, true);
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      }
      return true;
    }

    function reorderFilesInDir(dirNode, draggedId, targetId, placeAfter, opts = {}) {
      if (!dirNode || !draggedId || !targetId) return false;
      const list = dirNode.childrenFiles;
      if (!Array.isArray(list) || list.length < 2) return false;
      const dragId = String(draggedId);
      const target = String(targetId);
      if (dragId === target) return false;

      const visible = Array.isArray(opts.visibleIds) ? opts.visibleIds.map(id => String(id || "")) : null;
      if (visible && visible.length) {
        const visibleSet = new Set(visible);
        if (!visibleSet.has(dragId) || !visibleSet.has(target)) return false;
        const reorderedVisible = visible.filter(id => id !== dragId);
        const targetIdx = reorderedVisible.indexOf(target);
        if (targetIdx < 0) return false;
        const insertIdx = Math.max(0, Math.min(reorderedVisible.length, placeAfter ? targetIdx + 1 : targetIdx));
        reorderedVisible.splice(insertIdx, 0, dragId);

        const result = new Array(list.length);
        const slots = [];
        for (let i = 0; i < list.length; i++) {
          const id = String(list[i] || "");
          if (visibleSet.has(id)) slots.push(i);
          else result[i] = id;
        }
        if (slots.length !== reorderedVisible.length) return false;
        for (let i = 0; i < slots.length; i++) {
          result[slots[i]] = reorderedVisible[i];
        }
        list.length = 0;
        list.push(...result);
        dirNode.preserveOrder = true;
        WS.view.randomCache.delete(dirNode.path || "");
        return true;
      }

      const fromIdx = list.indexOf(dragId);
      if (fromIdx < 0) return false;
      list.splice(fromIdx, 1);
      let toIdx = list.indexOf(target);
      if (toIdx < 0) return false;
      if (placeAfter) toIdx += 1;
      toIdx = Math.max(0, Math.min(list.length, toIdx));
      list.splice(toIdx, 0, dragId);
      dirNode.preserveOrder = true;
      WS.view.randomCache.delete(dirNode.path || "");
      return true;
    }

    function reverseFilesInDir(dirNode, opts = {}) {
      if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
      const list = dirNode.childrenFiles;
      if (list.length < 2) return false;

      const visible = Array.isArray(opts.visibleIds) ? opts.visibleIds.map(id => String(id || "")) : null;
      if (visible && visible.length) {
        const visibleSet = new Set(visible);
        const reversedVisible = visible.slice().reverse();
        const result = new Array(list.length);
        const slots = [];
        for (let i = 0; i < list.length; i++) {
          const id = String(list[i] || "");
          if (visibleSet.has(id)) slots.push(i);
          else result[i] = id;
        }
        if (slots.length !== reversedVisible.length) return false;
        for (let i = 0; i < slots.length; i++) {
          result[slots[i]] = reversedVisible[i];
        }
        list.length = 0;
        list.push(...result);
      } else {
        list.reverse();
      }

      dirNode.preserveOrder = true;
      WS.view.randomCache.delete(dirNode.path || "");
      return true;
    }

    function invalidateAllThumbs() {
      for (const it of WS.fileById.values()) {
        if (!it) continue;
        if (it.thumbUrl && it.thumbMode && it.thumbMode !== "high") {
          try { URL.revokeObjectURL(it.thumbUrl); } catch {}
          it.thumbUrl = null;
        }
        it.thumbMode = null;

        if (it.videoThumbUrl) {
          try { URL.revokeObjectURL(it.videoThumbUrl); } catch {}
          it.videoThumbUrl = null;
        }
        it.videoThumbMode = null;
      }
      WS.videoThumbQueue = [];
      WS.imageThumbQueue = [];
    }

    /* =========================================================
       Directories Pane
       - lists folders + files for WS.nav.dirNode
       - selection drives Preview Pane
       ========================================================= */

    function isDirHidden(dirNode) {
      if (!dirNode) return false;
      return metaHasHidden(dirNode.path || "");
    }

    function isDirOrAncestorHidden(dirNode) {
      let cur = dirNode;
      while (cur) {
        if (metaHasHidden(cur.path || "")) return true;
        cur = cur.parent;
      }
      return false;
    }

    async function renameSingleFile(rec, nextName) {
      if (!rec) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      const clean = String(nextName || "").trim();
      if (!isValidFileName(clean)) {
        showStatusMessage("Invalid file name.");
        return false;
      }
      if (clean === String(rec.name || "")) return true;

      const dirPath = String(rec.dirPath || "");
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);
      let existing = false;
      try {
        await dirHandle.getFileHandle(clean);
        existing = true;
      } catch {}
      if (existing) {
        showStatusMessage("A file with that name already exists.");
        return false;
      }

      const fileHandle = await dirHandle.getFileHandle(String(rec.name || ""));
      const ok = await renameFileOnDisk(dirHandle, fileHandle, String(rec.name || ""), clean);
      if (!ok) {
        showStatusMessage("Rename failed.");
        return false;
      }

      const dirNode = WS.dirByPath.get(dirPath) || null;
      if (dirNode) {
        const renameMap = new Map([[String(rec.name || ""), clean]]);
        updateFileRecordsForFileRenames(dirNode, renameMap);
      }

      metaComputeFingerprints();
      WS.meta.dirty = true;
      try {
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      } catch {}

      showStatusMessage("Rename complete.");
      return true;
    }

    function getChildDirsForNodeBase(dirNode) {
      if (!dirNode) return [];
      const base = sortDirsForDisplay(dirNode.childrenDirs).filter(d => dirItemCount(d) > 0);
      const showHidden = WS.view.hiddenMode || (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
      const visibleBase = showHidden ? base : base.filter(d => !isDirOrAncestorHidden(d));
      return filterOnlineDirs(visibleBase);
    }

    function treatTagsAsFoldersEnabled() {
      return true;
    }

    function showHiddenFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showHiddenFolder);
    }

    function showUntaggedFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showUntaggedFolder);
    }

    function showTrashFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showTrashFolder);
    }

    function getUntaggedDirsForNode(dirNode) {
      if (!dirNode) return [];
      const children = getChildDirsForNodeBase(dirNode);
      if (!children.length) return [];
      return children.filter(d => (metaGetUserTags(d.path || "").length === 0));
    }

    function isViewingTagFolder() {
      return !!WS.view.tagFolderActiveMode;
    }

    function gatherTagGroupsForDir(dirNode) {
      const groups = new Map();
      if (!dirNode) return groups;
      const children = getChildDirsForNodeBase(dirNode);
      for (const child of children) {
        const tags = metaGetUserTags(child.path || "");
        const seen = new Set();
        for (const tag of tags) {
          const key = String(tag || "");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const list = groups.get(key) || [];
          list.push(child);
          groups.set(key, list);
        }
      }
      return groups;
    }

    function getTagFolderEntries() {
      if (!treatTagsAsFoldersEnabled()) return [];
      if (!WS.root || !WS.nav.dirNode) return [];
      if (WS.view.dirSearchPinned || WS.view.favoritesMode || WS.view.hiddenMode) return [];

      const entries = [];
      if (BULK_TAG_PLACEHOLDER) {
        entries.push({
          kind: "tag",
          label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
          tag: "",
          count: BULK_TAG_PLACEHOLDER.count || 0,
          placeholder: true
        });
      }

      const dirNode = WS.nav.dirNode;
      const allChildren = sortDirsForDisplay(dirNode.childrenDirs).filter(d => dirItemCount(d) > 0);
      const children = getChildDirsForNodeBase(dirNode);

      const favs = allChildren.filter(d => metaHasFavorite(d.path || ""));
      if (favs.length) {
        entries.push({ kind: "tag", label: "Favorites", special: "favorites", count: favs.length });
      }
      if (showUntaggedFolderEnabled() && dirNode === WS.root) {
        const untagged = getUntaggedDirsForNode(dirNode);
        if (untagged.length) {
          entries.push({ kind: "tag", label: "Untagged", special: "untagged", count: untagged.length });
        }
      }
      if (showHiddenFolderEnabled()) {
        const hidden = allChildren.filter(d => metaHasHidden(d.path || ""));
        if (hidden.length) {
          entries.push({ kind: "tag", label: "Hidden", special: "hidden", count: hidden.length });
        }
      }
      if (showTrashFolderEnabled() && dirNode === WS.root) {
        const trashDirs = getTrashVirtualDirs();
        if (trashDirs.length) {
          entries.push({ kind: "tag", label: "Trash", special: "trash", count: trashDirs.length });
        }
      }

      const tagGroups = gatherTagGroupsForDir(dirNode);
      if (tagGroups.size) {
        const sorted = Array.from(tagGroups.keys()).sort((a, b) => String(a).localeCompare(String(b)));
        for (const tag of sorted) {
          const nodes = tagGroups.get(tag) || [];
          if (!nodes.length) continue;
          entries.push({ kind: "tag", tag, label: tag, count: nodes.length });
        }
      }

      return entries;
    }

    function getTagFolderBaseNode() {
      const basePath = String(WS.view.tagFolderOriginPath || "");
      if (basePath) {
        const node = WS.dirByPath.get(basePath);
        if (node) return node;
      }
      return WS.nav.dirNode || WS.root;
    }

    function getDirsForTagFolderView() {
      if (!isViewingTagFolder()) return [];
      const baseNode = getTagFolderBaseNode();
      if (!baseNode) return [];
      const children = getChildDirsForNodeBase(baseNode);
      if (WS.view.tagFolderActiveMode === "favorites") {
        return children.filter(d => metaHasFavorite(d.path || ""));
      }
      if (WS.view.tagFolderActiveMode === "untagged") {
        return children.filter(d => metaGetUserTags(d.path || "").length === 0);
      }
      if (WS.view.tagFolderActiveMode === "hidden") {
        return children.filter(d => metaHasHidden(d.path || ""));
      }
      if (WS.view.tagFolderActiveMode === "trash") {
        return getTrashVirtualDirs();
      }
      const tag = String(WS.view.tagFolderActiveTag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function getDirsForTagViewFrame(frame) {
      if (!frame) return [];
      const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
      if (!baseNode) return [];
      const children = getChildDirsForNodeBase(baseNode);
      if (frame.mode === "favorites") return children.filter(d => metaHasFavorite(d.path || ""));
      if (frame.mode === "untagged") return children.filter(d => metaGetUserTags(d.path || "").length === 0);
      if (frame.mode === "hidden") return children.filter(d => metaHasHidden(d.path || ""));
      if (frame.mode === "trash") return getTrashVirtualDirs();
      const tag = String(frame.tag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function getDirsForTagEntry(entry) {
      if (!entry || entry.kind !== "tag") return [];
      const dirNode = WS.nav.dirNode;
      if (!dirNode) return [];
      if (entry.special === "trash") {
        return getTrashVirtualDirs();
      }
      const children = getChildDirsForNodeBase(dirNode);
      if (!children.length) return [];
      if (entry.special) {
        if (entry.special === "favorites") {
          return children.filter(d => metaHasFavorite(d.path || ""));
        }
        if (entry.special === "untagged") {
          return children.filter(d => metaGetUserTags(d.path || "").length === 0);
        }
        if (entry.special === "hidden") {
          return children.filter(d => metaHasHidden(d.path || ""));
        }
        return [];
      }
      const tag = String(entry.tag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function makeTagPreviewNode(entry) {
      const baseNode = WS.nav.dirNode;
      if (!entry || !baseNode) return null;
      const dirs = getDirsForTagEntry(entry);
      const label = String(entry.label || entry.tag || entry.special || "Tag");
      const pathSuffix = entry.special ? entry.special : entry.tag || "tag";
      const safeSuffix = String(pathSuffix || "tag").replace(/[\/\\]/g, "_");
      const virtualPath = `${String(baseNode.path || "")}/@tag-${safeSuffix}`;
      return {
        type: "dir",
        name: label,
        parent: baseNode,
        childrenDirs: dirs,
        childrenFiles: [],
        path: virtualPath,
        _skipTagFilters: true
      };
    }

    function findTagEntryIndex(mode, tag) {
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        if (mode && entry.special && entry.special === mode) return i;
        if (mode === "tag" && entry.tag && entry.tag === tag) return i;
      }
      return -1;
    }

    function restoreTagFolderEntrySelection(ctx) {
      if (!ctx) return false;
      const baseNode = WS.dirByPath.get(String(ctx.originPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(ctx.mode, ctx.tag);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return true;
    }

    function setTagFolderViewState(mode, tag, originPath) {
      WS.view.tagFolderActiveMode = mode;
      WS.view.tagFolderActiveTag = tag;
      WS.view.tagFolderOriginPath = String(originPath || "");
      closeActionMenus();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function getDirectoriesScrollTop() {
      if (!directoriesListEl) return 0;
      return directoriesListEl.scrollTop || 0;
    }

    function setDirectoriesScrollTop(value) {
      if (!directoriesListEl || typeof value !== "number") return;
      directoriesListEl.scrollTop = value;
    }

    function ensureTagNavStack() {
      if (!Array.isArray(WS.view.tagNavStack)) WS.view.tagNavStack = [];
      return WS.view.tagNavStack;
    }

    function pushTagNavFrame(frame) {
      if (!frame) return;
      ensureTagNavStack().push(frame);
    }

    function pushTagEntryContext(mode, tag) {
      pushTagNavFrame({
        type: "tag-entry",
        dirPath: String(WS.nav.dirNode?.path || ""),
        entryMode: mode || "",
        entryTag: tag || "",
        selectedIndex: WS.nav.selectedIndex,
        scrollTop: getDirectoriesScrollTop()
      });
    }

    function pushTagViewContext(selectedDirPath) {
      const orderedPaths = getDirsForTagFolderView().map(d => String(d?.path || "")).filter(Boolean);
      pushTagNavFrame({
        type: "tag-view",
        mode: WS.view.tagFolderActiveMode,
        tag: WS.view.tagFolderActiveTag,
        originPath: String(WS.view.tagFolderOriginPath || ""),
        selectedDirPath: String(selectedDirPath || ""),
        scrollTop: getDirectoriesScrollTop(),
        orderedPaths
      });
    }

    function restoreTagViewFromFrame(frame) {
      if (!frame) return false;
      const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      setTagFolderViewState(frame.mode || "", frame.tag || "", frame.originPath);
      const idx = frame.selectedDirPath ? findDirEntryIndexByPath(frame.selectedDirPath) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      setDirectoriesScrollTop(frame.scrollTop);
      return true;
    }

    function restoreDirectoriesFromTagEntryFrame(frame) {
      if (!frame) return false;
      const baseNode = WS.dirByPath.get(String(frame.dirPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(frame.entryMode, frame.entryTag);
      const targetIndex = idx >= 0 ? idx : (typeof frame.selectedIndex === "number" ? frame.selectedIndex : 0);
      WS.nav.selectedIndex = findNearestSelectableIndex(targetIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      setDirectoriesScrollTop(frame.scrollTop);
      return true;
    }

    function tryRestoreTagDirectoryContext() {
      const stack = WS.view.tagNavStack;
      if (!Array.isArray(stack) || !stack.length) return false;
      const frame = stack[stack.length - 1];
      if (frame.type !== "tag-view") return false;
      const curPath = String(WS.nav.dirNode?.path || "");
      const targetPath = String(frame.selectedDirPath || "");
      if (targetPath && curPath && curPath !== targetPath) return false;
      stack.pop();
      return restoreTagViewFromFrame(frame);
    }

    function tryRestoreTagEntryContext() {
      const stack = WS.view.tagNavStack;
      if (!Array.isArray(stack) || !stack.length) return false;
      const frame = stack[stack.length - 1];
      if (frame.type !== "tag-entry") return false;
      stack.pop();
      return restoreDirectoriesFromTagEntryFrame(frame);
    }

    function exitTagFolderView() {
      if (!isViewingTagFolder()) return;
      if (tryRestoreTagEntryContext()) return;
      const ctx = {
        mode: WS.view.tagFolderActiveMode,
        tag: WS.view.tagFolderActiveTag,
        originPath: WS.view.tagFolderOriginPath
      };
      if (!restoreTagFolderEntrySelection(ctx)) {
        setTagFolderViewState("", "", "");
      }
    }

    function openTagFolderEntry(entry) {
      if (!entry) return;
      const mode = entry.special ? entry.special : "tag";
      const tag = entry.special ? "" : (entry.tag || "");
      pushTagEntryContext(mode, tag);
      const originPath = String(WS.nav.dirNode?.path || "");
      setTagFolderViewState(mode, tag, originPath);
    }

    function getChildDirsForNode(dirNode) {
      return getChildDirsForNodeBase(dirNode);
    }

    function getVisibleSiblingDirsForSlide(dirNode) {
      const dp = String(dirNode?.path || "");
      const stack = WS.view.tagNavStack;
      if (Array.isArray(stack) && stack.length) {
        const frame = stack[stack.length - 1];
        if (frame && frame.type === "tag-view") {
          if (Array.isArray(frame.orderedPaths) && frame.orderedPaths.length) {
            const nodes = frame.orderedPaths
              .map(p => WS.dirByPath.get(String(p || "")))
              .filter(Boolean);
            if (nodes.length) {
              const match = nodes.some(d => String(d?.path || "") === dp);
              if (match) return nodes;
            }
          }
          const tagDirs = getDirsForTagViewFrame(frame);
          if (tagDirs.length) {
            const match = tagDirs.some(d => String(d?.path || "") === dp);
            if (match) return tagDirs;
          }
        }
      }

      if (WS.view.dirSearchPinned && !WS.view.searchRootActive && dp && dp === String(WS.view.searchAnchorPath || "")) {
        return (WS.view.searchResults || []).slice();
      }

      if (WS.view.favoritesMode && !WS.view.favoritesRootActive && dp && dp === String(WS.view.favoritesAnchorPath || "")) {
        return getAllFavoriteDirs();
      }

      if (WS.view.hiddenMode && !WS.view.hiddenRootActive && dp && dp === String(WS.view.hiddenAnchorPath || "")) {
        return getAllHiddenDirs();
      }

      const p = dirNode?.parent;
      if (!p) return [];
      return getChildDirsForNodeBase(p);
    }

    function getNextSiblingDirWithFiles(dirNode) {
      if (!dirNode) return null;
      const sibs = getVisibleSiblingDirsForSlide(dirNode);
      const idx = sibs.indexOf(dirNode);
      if (idx < 0) return null;
      for (let i = idx + 1; i < sibs.length; i++) {
        const d = sibs[i];
        if (getOrderedFileIdsForDir(d).length) return d;
      }
      return null;
    }

    function getPrevSiblingDirWithFiles(dirNode) {
      if (!dirNode) return null;
      const sibs = getVisibleSiblingDirsForSlide(dirNode);
      const idx = sibs.indexOf(dirNode);
      if (idx < 0) return null;
      for (let i = idx - 1; i >= 0; i--) {
        const d = sibs[i];
        if (getOrderedFileIdsForDir(d).length) return d;
      }
      return null;
    }

    function getAllFavoriteDirs() {
      const out = [];
      if (!WS.root) return out;
      for (const [path, node] of WS.dirByPath.entries()) {
        const p = String(path || "");
        if (!p) continue;
        if (!node || node.type !== "dir") continue;
        if (metaHasFavorite(p) && !metaHasHidden(p)) out.push(node);
      }
      out.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });
      return filterOnlineDirs(sortOnlineFoldersFirstForList(out));
    }

    function getAllHiddenDirs() {
      const out = [];
      if (!WS.root) return out;
      for (const [path, node] of WS.dirByPath.entries()) {
        const p = String(path || "");
        if (!p) continue;
        if (!node || node.type !== "dir") continue;
        if (metaHasHidden(p)) out.push(node);
      }
      out.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });
      return filterOnlineDirs(sortOnlineFoldersFirstForList(out));
    }

    function cancelDirectorySearch() {
      WS.view.dirSearchPinned = false;
      WS.view.dirSearchQuery = "";
      WS.view.searchRootActive = false;
      WS.view.searchRootPath = "";
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      WS.view.searchRootIsFavorites = false;
      WS.view.searchRootFavorites = [];
      WS.view.searchRootIsHidden = false;
      WS.view.searchRootHidden = [];
      WS.view.searchResults = [];
    }

    function computeDirectorySearchResults() {
      const q = String(WS.view.dirSearchQuery || "").trim().toLowerCase();
      WS.view.searchResults = [];
      if (!WS.root || !q) return;

      const countMemo = new Map();
      const getCount = (node) => {
        if (!node) return 0;
        const p = String(node.path || "");
        if (countMemo.has(p)) return countMemo.get(p);
        const c = dirItemCount(node) | 0;
        countMemo.set(p, c);
        return c;
      };

      const addSet = new Set();
      const results = [];
      const skipHidden = !WS.view.hiddenMode;
      const consider = (node, includeSelf) => {
        if (!node) return;
        if (skipHidden && isDirOrAncestorHidden(node)) return;
        if (getCount(node) <= 0) return;

        const name = dirDisplayName(node || null).toLowerCase();
        if (includeSelf && name.includes(q)) {
          const p = String(node.path || "");
          if (p && !addSet.has(p)) {
            addSet.add(p);
            results.push(node);
          }
        }

        for (const d of node.childrenDirs) consider(d, true);
      };

      if (WS.view.searchRootIsFavorites) {
        const roots = Array.isArray(WS.view.searchRootFavorites) ? WS.view.searchRootFavorites : [];
        for (let i = 0; i < roots.length; i++) consider(roots[i], true);
      } else if (WS.view.searchRootIsHidden) {
        const roots = Array.isArray(WS.view.searchRootHidden) ? WS.view.searchRootHidden : [];
        for (let i = 0; i < roots.length; i++) consider(roots[i], true);
      } else {
        const rp = String(WS.view.searchRootPath || "");
        const rootNode = WS.dirByPath.get(rp) || WS.root;
        consider(rootNode, false);
      }

      results.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });

      WS.view.searchResults = sortOnlineFoldersFirstForList(results);
    }

    function syncFavoritesUi() {
      if (favoritesBtn) {
        const n = WS.root ? getAllFavoriteDirs().length : 0;
        favoritesBtn.textContent = `Favorites${n ? ` (${n})` : ""}`;
        favoritesBtn.classList.toggle("active", !!WS.view.favoritesMode);
        favoritesBtn.disabled = !WS.root;
      }
    }

    function syncHiddenUi() {
      if (hiddenBtn) {
        const n = WS.root ? getAllHiddenDirs().length : 0;
        hiddenBtn.textContent = `Hidden${n ? ` (${n})` : ""}`;
        hiddenBtn.classList.toggle("active", !!WS.view.hiddenMode);
        hiddenBtn.disabled = !WS.root;
      }
    }

    function syncTagUiForCurrentDir() {
      if (!WS.root || !WS.nav.dirNode) return;
    }

    function rebuildDirectoriesEntries() {
      WS.nav.entries = [];

      if (!WS.root) return;

      if (isViewingTagFolder()) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const nodes = getDirsForTagFolderView();
        for (const d of nodes) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = filterOnlineDirs((WS.view.searchResults || []).slice());
        for (let i = 0; i < dirs.length; i++) WS.nav.entries.push({ kind: "dir", node: dirs[i] });
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = getAllFavoriteDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = getAllHiddenDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      const dirNode = WS.nav.dirNode;
      if (!dirNode) return;

      const tagEntries = getTagFolderEntries();
      if (tagEntries.length) {
        for (const entry of tagEntries) WS.nav.entries.push(entry);
      }

      const dirs = getChildDirsForNode(dirNode);
      for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });

      const baseFiles = getOrderedFileIdsForDir(dirNode);

      if (WS.view.folderBehavior === "loop") {
        const reps = Math.max(1, WS.view.dirLoopRepeats | 0);
        for (let r = 0; r < reps; r++) {
          for (const id of baseFiles) WS.nav.entries.push({ kind: "file", id });
        }
      } else {
        for (const id of baseFiles) WS.nav.entries.push({ kind: "file", id });
      }
    }

    function isSelectableEntry(entry) {
      return entry && (entry.kind === "dir" || entry.kind === "file" || entry.kind === "tag");
    }

    function findNearestSelectableIndex(idx, direction) {
      if (!WS.nav.entries.length) return 0;
      let i = Math.max(0, Math.min(WS.nav.entries.length - 1, idx));
      if (isSelectableEntry(WS.nav.entries[i])) return i;
      const step = direction >= 0 ? 1 : -1;
      let j = i;
      while (j >= 0 && j < WS.nav.entries.length) {
        if (isSelectableEntry(WS.nav.entries[j])) return j;
        j += step;
      }
      j = i - step;
      while (j >= 0 && j < WS.nav.entries.length) {
        if (isSelectableEntry(WS.nav.entries[j])) return j;
        j -= step;
      }
      return i;
    }

    function findDirEntryIndexByPath(path) {
      const p = String(path || "");
      if (!p) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "dir" && String(entry.node?.path || "") === p) return i;
      }
      return -1;
    }

    function setDirectoriesSelection(idx) {
      if (!WS.nav.entries.length) {
        WS.nav.selectedIndex = 0;
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        return;
      }
      closeActionMenus();
      const i = findNearestSelectableIndex(idx, idx >= WS.nav.selectedIndex ? 1 : -1);
      WS.nav.selectedIndex = i;
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(false);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function returnToSearchResults() {
      const target = String(WS.view.searchEntryRootPath || WS.view.searchAnchorPath || "");
      WS.view.searchRootActive = true;
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      rebuildDirectoriesEntries();
      const idx = target ? findDirEntryIndexByPath(target) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
    }

    function syncPreviewToSelection() {
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry || !isSelectableEntry(entry)) {
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
        return;
      }
      if (entry.kind === "dir") {
        WS.preview.kind = "dir";
        WS.preview.dirNode = entry.node;
        WS.preview.fileId = null;
      } else if (entry.kind === "file") {
        WS.preview.kind = "file";
        WS.preview.fileId = entry.id;
        WS.preview.dirNode = null;
      } else if (entry.kind === "tag") {
        const node = makeTagPreviewNode(entry);
        if (node) {
          WS.preview.kind = "dir";
          WS.preview.dirNode = node;
          WS.preview.fileId = null;
        } else {
          WS.preview.kind = null;
          WS.preview.dirNode = null;
          WS.preview.fileId = null;
        }
      } else {
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
      }
    }

    function altGalleryModeEnabled() {
      return true;
    }

    function enterSelectedDirectory() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;
      if (entry.kind === "tag") {
        openTagFolderEntry(entry);
        return;
      }

      if (entry.kind === "dir" && isTrashVirtualDirNode(entry.node)) {
        showStatusMessage("Use folder menu to restore this trash folder.");
        return;
      }

      if (isViewingTagFolder()) {
        pushTagViewContext(entry.node?.path || "");
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderOriginPath = "";
      }
      if (entry.kind !== "dir" || !entry.node) {
        if (altGalleryModeEnabled() && entry.kind === "file") {
          openGalleryFromDirectoriesSelection(true);
        }
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        WS.view.searchRootActive = false;
        WS.view.searchAnchorPath = entry.node.path || "";
        WS.view.searchEntryRootPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      WS.nav.dirNode = entry.node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
    }

    function leaveDirectory() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      if (tryRestoreTagDirectoryContext()) return;

      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;

      if (WS.view.dirSearchPinned && !WS.view.searchRootActive) {
        returnToSearchResults();
        return;
      }

      if (WS.view.favoritesMode && !WS.view.favoritesRootActive) {
        const cur = String(WS.nav.dirNode?.path || "");
        if (cur && cur === String(WS.view.favoritesAnchorPath || "")) {
          WS.view.favoritesRootActive = true;
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
          syncPreviewToSelection();
          renderDirectoriesPane();
          renderPreviewPane(true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      if (WS.view.hiddenMode && !WS.view.hiddenRootActive) {
        const cur = String(WS.nav.dirNode?.path || "");
        if (cur && cur === String(WS.view.hiddenAnchorPath || "")) {
          WS.view.hiddenRootActive = true;
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
          syncPreviewToSelection();
          renderDirectoriesPane();
          renderPreviewPane(true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      const child = WS.nav.dirNode;
      WS.nav.dirNode = WS.nav.dirNode.parent;

      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      let idx = 0;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const e = WS.nav.entries[i];
        if (e.kind === "dir" && (e.node === child || (child.path && e.node?.path === child.path))) { idx = i; break; }
      }
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();

      WS.view.pendingDirScroll = "center-selected";
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();

      recordDirHistory();
    }

    function goDirHistory(delta) {
      if (!WS.view.dirHistory.length) return;
      const next = WS.view.dirHistoryIndex + delta;
      if (next < 0 || next >= WS.view.dirHistory.length) return;
      WS.view.dirHistoryIndex = next;
      restoreDirHistoryEntry(WS.view.dirHistory[next]);
    }

    function goDirUp() {
      if (tryRestoreTagDirectoryContext()) return;
      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }
      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      leaveDirectory();
    }

    function getDirectoriesPathText() {
      if (!WS.root) return "—";
      if (isViewingTagFolder()) {
        const basePath = String(WS.view.tagFolderOriginPath || "");
        const baseLabel = basePath ? displayPath(basePath) : "root";
        if (WS.view.tagFolderActiveMode === "favorites") return `${baseLabel} · Favorites`;
        if (WS.view.tagFolderActiveMode === "untagged") return `${baseLabel} · Untagged`;
        if (WS.view.tagFolderActiveMode === "hidden") return `${baseLabel} · Hidden`;
        if (WS.view.tagFolderActiveMode === "trash") return `${baseLabel} · Trash`;
        const tagLabel = String(WS.view.tagFolderActiveTag || "").trim();
        return tagLabel ? `${baseLabel} · ${tagLabel}` : baseLabel;
      }
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      if (!WS.nav.dirNode) return "—";
      if (WS.nav.dirNode === WS.root) return "root";
      const p = WS.nav.dirNode.path ? displayPath(WS.nav.dirNode.path) : "root";
      return p || "root";
    }

    function toggleFavoritesMode() {
      if (!WS.root) return;

      if (!WS.view.favoritesMode) {
        const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
        WS.view.favoritesReturnState = {
          dirPath: String(WS.nav.dirNode?.path || ""),
          sel: entry ? (entry.kind === "dir" ? { kind: "dir", path: String(entry.node?.path || "") } : { kind: "file", id: String(entry.id || "") }) : null
        };
        WS.view.favoritesMode = true;
        WS.view.favoritesRootActive = true;
        WS.view.favoritesAnchorPath = "";
      } else {
        WS.view.favoritesMode = false;
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = "";

        const st = WS.view.favoritesReturnState;
        WS.view.favoritesReturnState = null;

        if (st && WS.root) {
          const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
          WS.nav.dirNode = dn;
          syncBulkSelectionForCurrentDir();
          syncFavoritesUi();
          syncTagUiForCurrentDir();
          rebuildDirectoriesEntries();

          let idx = 0;
          if (st.sel && st.sel.kind === "dir") {
            const p = String(st.sel.path || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) { idx = i; break; }
            }
          } else if (st.sel && st.sel.kind === "file") {
            const id = String(st.sel.id || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "file" && String(e2.id || "") === id) { idx = i; break; }
            }
          }
          WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function toggleHiddenMode() {
      if (!WS.root) return;

      if (!WS.view.hiddenMode) {
        const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
        WS.view.hiddenReturnState = {
          dirPath: String(WS.nav.dirNode?.path || ""),
          sel: entry ? (entry.kind === "dir" ? { kind: "dir", path: String(entry.node?.path || "") } : { kind: "file", id: String(entry.id || "") }) : null
        };
        WS.view.hiddenMode = true;
        WS.view.hiddenRootActive = true;
        WS.view.hiddenAnchorPath = "";
      } else {
        WS.view.hiddenMode = false;
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = "";

        const st = WS.view.hiddenReturnState;
        WS.view.hiddenReturnState = null;

        if (st && WS.root) {
          const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
          WS.nav.dirNode = dn;
          syncBulkSelectionForCurrentDir();
          syncFavoritesUi();
          syncHiddenUi();
          syncTagUiForCurrentDir();
          rebuildDirectoriesEntries();

          let idx = 0;
          if (st.sel && st.sel.kind === "dir") {
            const p = String(st.sel.path || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) { idx = i; break; }
            }
          } else if (st.sel && st.sel.kind === "file") {
            const id = String(st.sel.id || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "file" && String(e2.id || "") === id) { idx = i; break; }
            }
          }
          WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function canUseBulkSelection() {
      if (!WS.root) return false;
      if (WS.nav.dirNode) return true;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return true;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return true;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return true;
      return false;
    }

    function getVisibleDirPathsInEntries() {
      const set = new Set();
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "dir") continue;
        const p = String(entry.node?.path || "");
        if (p) set.add(p);
      }
      return set;
    }

    function getVisibleFileIdsInEntries() {
      const set = new Set();
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "file") continue;
        const id = String(entry.id || "");
        if (id) set.add(id);
      }
      return set;
    }

    function getSelectedPathsInCurrentDir() {
      const baseSet = getVisibleDirPathsInEntries();
      return Array.from(WS.view.bulkTagSelectedPaths || []).filter(p => baseSet.has(String(p || "")));
    }

    function getSelectedFileIdsInCurrentView() {
      const baseSet = getVisibleFileIdsInEntries();
      return Array.from(WS.view.bulkFileSelectedIds || []).filter(id => baseSet.has(String(id || "")));
    }

    function getSelectedFileRecordsInCurrentView() {
      const ids = getSelectedFileIdsInCurrentView();
      const recs = [];
      for (const id of ids) {
        const rec = WS.fileById.get(String(id || ""));
        if (rec) recs.push(rec);
      }
      return recs;
    }

    function getLocalMediaRecordsForDirPath(dirPath) {
      const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
      const prefix = target ? (target + "/") : "";
      const out = [];
      for (const rec of WS.fileById.values()) {
        if (!rec || rec.online || !rec.file) continue;
        const rel = String(rec.relPath || "").replace(/\\/g, "/");
        if (target && !rel.startsWith(prefix)) continue;
        out.push(rec);
      }
      return out;
    }

    function joinNativePath(basePath, relPath) {
      const base = String(basePath || "");
      const rel = String(relPath || "").replace(/^\/+|\/+$/g, "");
      if (!rel) return base.replace(/[\/\\]+$/g, "");
      const sep = base.includes("\\") ? "\\" : "/";
      const cleanBase = base.replace(/[\/\\]+$/g, "");
      return cleanBase ? (cleanBase + sep + rel.split("/").filter(Boolean).join(sep)) : rel;
    }

    function resolveAbsoluteDirectoryPath(dirPath) {
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.getPathForFile === "function")
        ? window.electronAPI
        : null;
      if (!electronApi) return "";

      const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
      const preferred = getLocalMediaRecordsForDirPath(target)
        .sort((a, b) => String(a?.relPath || "").length - String(b?.relPath || "").length);
      const fallback = Array.from(WS.fileById.values())
        .filter(rec => !!(rec && !rec.online && rec.file && rec.relPath))
        .sort((a, b) => String(a?.relPath || "").length - String(b?.relPath || "").length);
      const records = [];
      const seen = new Set();
      for (const rec of preferred.concat(fallback)) {
        const key = `${String(rec?.id || "")}::${String(rec?.relPath || "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(rec);
      }
      if (!records.length) return "";

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const absFile = String(electronApi.getPathForFile(rec.file) || "");
        const relPath = String(rec.relPath || "").replace(/\\/g, "/");
        if (!absFile || !relPath) continue;

        const absNorm = absFile.replace(/\\/g, "/");
        if (!absNorm.toLowerCase().endsWith(relPath.toLowerCase())) continue;

        const relNative = relPath.split("/").join(absFile.includes("\\") ? "\\" : "/");
        if (!relNative || absFile.length < relNative.length) continue;
        const rootAbs = absFile.slice(0, absFile.length - relNative.length).replace(/[\/\\]+$/g, "");
        const targetAbs = target ? joinNativePath(rootAbs, target) : rootAbs;
        if (targetAbs) return targetAbs;
      }
      return "";
    }

    function notifyScrubMissingTools(missingTools) {
      const list = Array.from(new Set((missingTools || []).map(v => String(v || "").trim()).filter(Boolean)));
      if (!list.length) return;
      const msg = `Scrub completed, but these tools are missing:\n\n${list.map(t => `- ${t}`).join("\n")}`;
      showStatusMessage(`Scrub missing tools: ${list.join(", ")}`);
      try {
        if (typeof window !== "undefined" && typeof window.alert === "function") {
          window.alert(msg);
        }
      } catch {}
    }

    async function scrubFoldersByPaths(paths, opts = {}) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Scrub requires a writable folder.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }
      const list = Array.from(new Set((paths || []).map(p => String(p || "")).filter(Boolean)));
      if (!list.length) {
        showStatusMessage("No folders selected.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.scrubFolder === "function")
        ? window.electronAPI
        : null;
      if (!electronApi) {
        showStatusMessage("Scrub is unavailable.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }

      const missingSet = new Set();
      const failed = [];
      const skipped = [];

      showBusyOverlay(list.length > 1 ? "Scrubbing folders..." : "Scrubbing folder...");
      try {
        for (let i = 0; i < list.length; i++) {
          const relPath = list[i];
          const labelPath = displayPath(relPath || "");
          showBusyOverlay(`Scrubbing ${i + 1}/${list.length}: ${labelPath || relPath || "folder"}`);
          const absPath = resolveAbsoluteDirectoryPath(relPath);
          if (!absPath) {
            skipped.push(relPath);
            continue;
          }
          let result = null;
          try {
            result = await electronApi.scrubFolder({ path: absPath });
          } catch (err) {
            result = { ok: false, error: err && err.message ? String(err.message) : "scrub_failed", missingTools: [] };
          }
          const missing = (result && Array.isArray(result.missingTools)) ? result.missingTools : [];
          for (const tool of missing) {
            const t = String(tool || "").trim();
            if (!t) continue;
            missingSet.add(t);
          }
          if (!result || !result.ok) {
            failed.push({ path: relPath, error: String(result?.error || `exit_${result?.code ?? "unknown"}`) });
          }
        }
      } finally {
        hideBusyOverlay();
      }

      if (opts.refresh !== false && WS.meta.fsRootHandle) {
        await refreshWorkspaceFromRootHandle();
      }

      const okCount = list.length - failed.length - skipped.length;
      if (failed.length) {
        showStatusMessage(`Scrub finished with ${failed.length} error${failed.length === 1 ? "" : "s"}.`);
      } else if (okCount > 0) {
        showStatusMessage(`Scrub complete for ${okCount} folder${okCount === 1 ? "" : "s"}.`);
      } else {
        showStatusMessage("Scrub skipped.");
      }

      notifyScrubMissingTools(Array.from(missingSet));
      return { ok: failed.length === 0, missingTools: Array.from(missingSet), failed, skipped };
    }

    function chooseLooseSetFolderNameFromRecords(records) {
      const names = [];
      for (const rec of records || []) {
        const name = String(rec?.name || "").trim();
        if (name) names.push(name);
      }
      if (!names.length) return "New Folder";
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      let first = names[0] || "New Folder";
      let base = first;
      if (first.includes(".") && !first.startsWith(".")) {
        base = first.slice(0, first.lastIndexOf("."));
      }
      base = normalizeFolderNameInput(base);
      return base || "New Folder";
    }

    async function entryExistsInDir(dirHandle, name) {
      if (!dirHandle || !name) return false;
      try { await dirHandle.getFileHandle(name); return true; } catch {}
      try { await dirHandle.getDirectoryHandle(name); return true; } catch {}
      return false;
    }

    function splitNameExtension(name) {
      const raw = String(name || "");
      if (raw.includes(".") && !raw.startsWith(".")) {
        const idx = raw.lastIndexOf(".");
        if (idx > 0) return { base: raw.slice(0, idx), ext: raw.slice(idx) };
      }
      return { base: raw, ext: "" };
    }

    async function uniqueDestNameInDir(dirHandle, name) {
      const { base, ext } = splitNameExtension(name);
      let candidate = `${base}${ext}`;
      let n = 2;
      while (await entryExistsInDir(dirHandle, candidate)) {
        candidate = `${base} (${n})${ext}`;
        n += 1;
      }
      return candidate;
    }

    async function uniqueDirNameInParent(parentHandle, name) {
      let candidate = String(name || "") || "Merged Items";
      let n = 2;
      while (await entryExistsInDir(parentHandle, candidate)) {
        candidate = `${name} (${n})`;
        n += 1;
      }
      return candidate;
    }

    function normalizeSetMergeFolderBase(name) {
      let base = String(name || "");
      const extIdx = base.lastIndexOf(".");
      if (extIdx > 0 && !base.startsWith(".")) base = base.slice(0, extIdx);
      base = base.replace(/_[0-9]+$/g, "");
      base = normalizeFolderNameInput(base);
      return base || "Merged Items";
    }

    async function chooseSetMergeOutputName(dirHandles) {
      const names = [];
      for (const handle of dirHandles || []) {
        if (!handle) continue;
        for await (const [name] of handle.entries()) {
          if (!name) continue;
          if (name === ".local-gallery") continue;
          names.push(name);
        }
      }
      if (!names.length) return "Merged Items";
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      const first = names[0] || "Merged Items";
      return normalizeSetMergeFolderBase(first);
    }

    async function moveEntryWithCollisionRename(srcDirHandle, entryHandle, entryName, destDirHandle, outInfo) {
      if (!srcDirHandle || !entryHandle || !destDirHandle) return false;
      const desiredName = await uniqueDestNameInDir(destDirHandle, entryName);
      if (typeof entryHandle.move === "function") {
        try {
          await entryHandle.move(destDirHandle, desiredName);
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
      }
      if (entryHandle.kind === "file") {
        try {
          const file = await entryHandle.getFile();
          const dstFile = await destDirHandle.getFileHandle(desiredName, { create: true });
          const writable = await dstFile.createWritable();
          await writable.write(file);
          await writable.close();
          await srcDirHandle.removeEntry(entryName);
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
        return false;
      }
      if (entryHandle.kind === "directory") {
        try {
          const dstDir = await destDirHandle.getDirectoryHandle(desiredName, { create: true });
          await copyDirectoryHandle(entryHandle, dstDir);
          await srcDirHandle.removeEntry(entryName, { recursive: true });
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
        return false;
      }
      return false;
    }

    async function ensureTrashDirectoryHandle(rootHandle) {
      if (!rootHandle) return null;
      try {
        const sysDir = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
        DIR_HANDLE_CACHE.set(".local-gallery", sysDir);
        const trashDir = await sysDir.getDirectoryHandle("trash", { create: true });
        DIR_HANDLE_CACHE.set(".local-gallery/trash", trashDir);
        return trashDir;
      } catch {}
      return null;
    }

    async function moveFolderPathsToTrash(paths) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Delete requires a writable folder.");
        return false;
      }

      const uniquePaths = Array.from(new Set((paths || []).map(p => String(p || "").trim()).filter(Boolean)));
      if (!uniquePaths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }

      uniquePaths.sort((a, b) => {
        const depthA = a.split("/").filter(Boolean).length;
        const depthB = b.split("/").filter(Boolean).length;
        if (depthA !== depthB) return depthB - depthA;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      });

      const rootHandle = WS.meta.fsRootHandle;
      const targets = [];
      for (const path of uniquePaths) {
        const normalizedPath = normalizeWorkspaceRelPath(path);
        if (!normalizedPath) continue;
        const parts = normalizedPath.split("/").filter(Boolean);
        const folderName = parts.pop() || "";
        const parentPath = parts.join("/");
        if (!folderName) continue;
        if (folderName === ".local-gallery" || parts.includes(".local-gallery")) continue;

        let parentHandle = null;
        try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
        if (!parentHandle) continue;

        let entryHandle = null;
        try { entryHandle = await parentHandle.getDirectoryHandle(folderName); } catch {}
        if (!entryHandle) continue;

        const sourceNode = WS.dirByPath.get(normalizedPath) || null;
        const itemCount = sourceNode ? (dirItemCount(sourceNode) | 0) : 0;
        targets.push({ path: normalizedPath, parentPath, folderName, parentHandle, entryHandle, itemCount });
      }

      if (!targets.length) {
        showStatusMessage("No folders available.");
        return false;
      }

      const trashHandle = await ensureTrashDirectoryHandle(rootHandle);
      if (!trashHandle) {
        showStatusMessage("Trash folder unavailable.");
        return false;
      }

      const label = targets.length === 1
        ? "Moving folder to trash..."
        : `Moving ${targets.length} folders to trash...`;
      showBusyOverlay(label);
      const nextIndex = new Map(WS.meta.trashOriginsByName || []);
      let moved = 0;
      let failed = 0;
      try {
        for (const t of targets) {
          const moveInfo = {};
          const ok = await moveEntryWithCollisionRename(t.parentHandle, t.entryHandle, t.folderName, trashHandle, moveInfo);
          if (ok) {
            moved++;
            const trashName = String(moveInfo.movedName || t.folderName || "").trim();
            if (trashName && isValidFolderName(trashName)) {
              nextIndex.set(trashName, {
                originalPath: t.path,
                itemCount: Math.max(0, Number(t.itemCount) || 0) | 0,
                trashedAt: Date.now()
              });
            }
            invalidateDirHandleCache(t.path);
            invalidateDirHandleCache(t.parentPath);
            continue;
          }
          failed++;
        }
      } catch {
        failed = Math.max(failed, targets.length - moved);
      } finally {
        hideBusyOverlay();
      }

      if (!moved) {
        showStatusMessage("Move to trash failed.");
        return false;
      }

      WS.meta.trashOriginsByName = nextIndex;
      await saveTrashIndexToFs();
      await loadTrashStateFromFs();
      try { await refreshWorkspaceFromRootHandle(); } catch {}

      if (failed > 0) {
        showStatusMessage(`Moved ${moved} folder${moved === 1 ? "" : "s"} to trash. ${failed} failed.`);
      } else {
        showStatusMessage(`Moved ${moved} folder${moved === 1 ? "" : "s"} to trash.`);
      }
      return true;
    }

    async function restoreTrashFoldersByNames(names) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Restore requires a writable folder.");
        return { restored: 0, failed: 0 };
      }

      const targets = Array.from(new Set((names || []).map(v => String(v || "").trim()).filter(Boolean)));
      if (!targets.length) {
        showStatusMessage("No trash folders selected.");
        return { restored: 0, failed: 0 };
      }

      await loadTrashStateFromFs();
      const rootHandle = WS.meta.fsRootHandle;
      const trashHandle = await ensureTrashDirectoryHandle(rootHandle);
      if (!trashHandle) {
        showStatusMessage("Trash folder unavailable.");
        return { restored: 0, failed: targets.length };
      }

      const index = new Map(WS.meta.trashOriginsByName || []);
      const toRestore = [];
      for (const trashName of targets) {
        if (!trashName || !isValidFolderName(trashName)) continue;
        let entryHandle = null;
        try { entryHandle = await trashHandle.getDirectoryHandle(trashName); } catch {}
        if (!entryHandle) continue;
        const rec = index.get(trashName) || null;
        const originalPath = normalizeWorkspaceRelPath(rec && rec.originalPath);
        if (!originalPath) continue;
        toRestore.push({ trashName, entryHandle, originalPath });
      }

      if (!toRestore.length) {
        showStatusMessage("No restorable trash folders found.");
        return { restored: 0, failed: targets.length };
      }

      showBusyOverlay(toRestore.length === 1 ? "Restoring folder..." : `Restoring ${toRestore.length} folders...`);
      let restored = 0;
      let failed = Math.max(0, targets.length - toRestore.length);
      try {
        for (const item of toRestore) {
          const parts = item.originalPath.split("/").filter(Boolean);
          const desiredName = parts.pop() || "";
          const parentPath = parts.join("/");
          if (!desiredName || !isValidFolderName(desiredName)) {
            failed++;
            continue;
          }
          let parentHandle = null;
          try { parentHandle = await ensureDirectoryHandleForPath(rootHandle, parentPath); } catch {}
          if (!parentHandle) {
            failed++;
            continue;
          }

          const moveInfo = {};
          const ok = await moveEntryWithCollisionRename(trashHandle, item.entryHandle, item.trashName, parentHandle, moveInfo);
          if (!ok) {
            failed++;
            continue;
          }

          index.delete(item.trashName);
          restored++;
          invalidateDirHandleCache(parentPath);
          invalidateDirHandleCache(item.originalPath);
        }
      } finally {
        hideBusyOverlay();
      }

      if (!restored) {
        showStatusMessage("Restore failed.");
        return { restored: 0, failed: Math.max(failed, targets.length) };
      }

      WS.meta.trashOriginsByName = index;
      await saveTrashIndexToFs();
      await loadTrashStateFromFs();
      await refreshWorkspaceFromRootHandle();

      if (failed > 0) {
        showStatusMessage(`Restored ${restored} folder${restored === 1 ? "" : "s"}. ${failed} failed.`);
      } else {
        showStatusMessage(`Restored ${restored} folder${restored === 1 ? "" : "s"}.`);
      }
      return { restored, failed };
    }

    async function setMergeSelectedDirs() {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Set Merge requires a writable folder.");
        return false;
      }
      const selectedPaths = getSelectedPathsInCurrentDir().map(p => String(p || "")).filter(Boolean);
      if (!selectedPaths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      const uniquePaths = Array.from(new Set(selectedPaths));
      const firstParts = uniquePaths[0].split("/").filter(Boolean);
      const parentPath = firstParts.slice(0, -1).join("/");
      for (const p of uniquePaths) {
        const parts = String(p || "").split("/").filter(Boolean);
        const parent = parts.slice(0, -1).join("/");
        if (parent !== parentPath) {
          showStatusMessage("Selected folders must be in the same parent folder.");
          return false;
        }
      }

      const rootHandle = WS.meta.fsRootHandle;
      let parentHandle = null;
      try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
      if (!parentHandle) {
        showStatusMessage("Folder handle unavailable.");
        return false;
      }

      const dirHandles = [];
      for (const p of uniquePaths) {
        try {
          dirHandles.push(await getDirectoryHandleForPath(rootHandle, p));
        } catch {}
      }
      if (!dirHandles.length) {
        showStatusMessage("No folders available.");
        return false;
      }

      const desiredBase = await chooseSetMergeOutputName(dirHandles);
      const tmpBase = `${desiredBase} (Merging)`;
      const tmpName = await uniqueDirNameInParent(parentHandle, tmpBase);
      let tmpHandle = null;
      try { tmpHandle = await parentHandle.getDirectoryHandle(tmpName, { create: true }); } catch {}
      if (!tmpHandle) {
        showStatusMessage("Failed to create merge folder.");
        return false;
      }

      for (let i = 0; i < dirHandles.length; i++) {
        const handle = dirHandles[i];
        const path = uniquePaths[i];
        if (!handle || !path) continue;
        for await (const [name, entryHandle] of handle.entries()) {
          if (!name || name === ".local-gallery") continue;
          const ok = await moveEntryWithCollisionRename(handle, entryHandle, name, tmpHandle);
          if (!ok) {
            showStatusMessage(`Move failed for ${name}.`);
            return false;
          }
        }
        const folderName = path.split("/").filter(Boolean).pop();
        if (folderName) {
          try { await parentHandle.removeEntry(folderName, { recursive: true }); } catch {}
        }
      }

      let finalName = desiredBase;
      if (await entryExistsInDir(parentHandle, finalName)) {
        finalName = await uniqueDirNameInParent(parentHandle, desiredBase);
      }

      const tmpPath = parentPath ? (parentPath + "/" + tmpName) : tmpName;
      try {
        await renameDirectoryOnDisk(tmpPath, finalName);
      } catch {
        showStatusMessage("Failed to finalize merged folder.");
        return false;
      }

      finalizeBulkSelectionAction();
      closeActionMenus();
      await refreshWorkspaceFromRootHandle();

      const finalPath = parentPath ? (parentPath + "/" + finalName) : finalName;
      const idx = findDirEntryIndexByPath(finalPath);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }
      showStatusMessage("Set Merge complete.");
      return true;
    }

    async function moveFileToDirectoryHandle(srcDirHandle, dstDirHandle, name) {
      if (!srcDirHandle || !dstDirHandle) return false;
      const fname = String(name || "");
      if (!fname) return false;
      let fileHandle = null;
      try { fileHandle = await srcDirHandle.getFileHandle(fname); } catch {}
      if (!fileHandle) return false;
      if (typeof fileHandle.move === "function") {
        try {
          await fileHandle.move(dstDirHandle, fname);
          return true;
        } catch {}
      }
      try {
        const file = await fileHandle.getFile();
        const dstFile = await dstDirHandle.getFileHandle(fname, { create: true });
        const writable = await dstFile.createWritable();
        await writable.write(file);
        await writable.close();
        await srcDirHandle.removeEntry(fname);
        return true;
      } catch {}
      return false;
    }

    function updateFileRecordsForFileMoves(oldDirPath, newDirPath, fileIds) {
      const idSet = new Set((fileIds || []).map(id => String(id || "")));
      if (!idSet.size) return;
      const idMap = new Map();
      const nextFileById = new Map();
      const movedNewIds = [];

      for (const [id, rec] of WS.fileById.entries()) {
        const key = String(id || "");
        if (!idSet.has(key)) {
          nextFileById.set(id, rec);
          continue;
        }
        const relPath = newDirPath ? (newDirPath + "/" + rec.name) : rec.name;
        rec.dirPath = newDirPath;
        rec.relPath = relPath;
        const nextId = fileKey(rec.file, relPath);
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
        movedNewIds.push(nextId);
      }

      WS.fileById = nextFileById;

      const oldNode = WS.dirByPath.get(String(oldDirPath || "")) || null;
      if (oldNode && Array.isArray(oldNode.childrenFiles)) {
        oldNode.childrenFiles = oldNode.childrenFiles.filter(id => !idSet.has(String(id || "")));
      }

      const newNode = WS.dirByPath.get(String(newDirPath || "")) || null;
      if (newNode && Array.isArray(newNode.childrenFiles)) {
        for (const id of movedNewIds) {
          if (!newNode.childrenFiles.includes(id)) newNode.childrenFiles.push(id);
        }
      }

      if (idMap.size) {
        remapFileIdsInDirTree(idMap);
        remapFileSelectionIds(idMap);
        if (WS.preview.kind === "file" && WS.preview.fileId && idMap.has(WS.preview.fileId)) {
          WS.preview.fileId = idMap.get(WS.preview.fileId);
        }
        for (const entry of WS.nav.entries || []) {
          if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
            entry.id = idMap.get(String(entry.id || ""));
          }
        }
        for (const it of viewerItems || []) {
          if (it && !it.isFolder && idMap.has(String(it.id || ""))) it.id = idMap.get(String(it.id || ""));
        }
      }
    }

    async function looseSetMergeSelectedFiles() {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Loose Set Merge requires a writable folder.");
        return false;
      }
      const records = getSelectedFileRecordsInCurrentView();
      if (!records.length) {
        showStatusMessage("No files selected.");
        return false;
      }
      const parentPath = String(records[0].dirPath || "");
      for (const rec of records) {
        if (String(rec.dirPath || "") !== parentPath) {
          showStatusMessage("Selected files must be in the same folder.");
          return false;
        }
      }

      const folderNameRaw = chooseLooseSetFolderNameFromRecords(records);
      const folderName = normalizeFolderNameInput(folderNameRaw);
      if (!isValidFolderName(folderName)) {
        showStatusMessage("Invalid folder name.");
        return false;
      }

      const rootHandle = WS.meta.fsRootHandle;
      let parentHandle = null;
      try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
      if (!parentHandle) {
        showStatusMessage("Folder handle unavailable.");
        return false;
      }

      let existing = null;
      try { existing = await parentHandle.getDirectoryHandle(folderName); } catch {}
      if (existing) {
        showStatusMessage("A folder with that name already exists.");
        return false;
      }
      existing = null;
      try { existing = await parentHandle.getFileHandle(folderName); } catch {}
      if (existing) {
        showStatusMessage("A file with that name already exists.");
        return false;
      }

      let tmpName = "";
      for (let i = 0; i < 24; i++) {
        const cand = `.grouping_tmp.${Math.random().toString(36).slice(2, 8)}`;
        let has = false;
        try { await parentHandle.getDirectoryHandle(cand); has = true; } catch {}
        if (!has) {
          try { await parentHandle.getFileHandle(cand); has = true; } catch {}
        }
        if (has) continue;
        tmpName = cand;
        break;
      }
      if (!tmpName) {
        showStatusMessage("Failed to create temporary folder.");
        return false;
      }

      let tmpHandle = null;
      try { tmpHandle = await parentHandle.getDirectoryHandle(tmpName, { create: true }); } catch {}
      if (!tmpHandle) {
        showStatusMessage("Failed to create temporary folder.");
        return false;
      }

      for (const rec of records) {
        const ok = await moveFileToDirectoryHandle(parentHandle, tmpHandle, rec.name);
        if (!ok) {
          showStatusMessage(`Move failed for ${rec.name || "file"}.`);
          return false;
        }
      }

      const tmpPath = parentPath ? (parentPath + "/" + tmpName) : tmpName;
      try {
        await renameDirectoryOnDisk(tmpPath, folderName);
      } catch {
        showStatusMessage("Failed to rename folder.");
        return false;
      }

      const newDirPath = parentPath ? (parentPath + "/" + folderName) : folderName;
      ensureDirPath(newDirPath);
      updateFileRecordsForFileMoves(parentPath, newDirPath, records.map(r => r.id));
      metaComputeFingerprints();
      WS.meta.dirty = true;
      try {
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      } catch {}

      finalizeBulkSelectionAction();
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findDirEntryIndexByPath(newDirPath);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage("Loose Set Merge complete.");
      return true;
    }

    function closeActionMenus() {
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      closeTagContextMenu();
      closePreviewContextMenu();
    }

    function openBulkActionMenuForSelection(path) {
      const p = String(path || "");
      if (!p) return false;
      if (!WS.view.bulkSelectMode) return false;
      const selectedDirs = getSelectedPathsInCurrentDir();
      if (!selectedDirs.length) return false;
      if (!selectedDirs.includes(p)) return false;
      if (WS.view.bulkActionMenuOpen && WS.view.bulkActionMenuAnchorPath === p) {
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return true;
      }
      WS.view.bulkActionMenuOpen = true;
      WS.view.bulkActionMenuAnchorPath = p;
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      const idx = findDirEntryIndexByPath(p);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return true;
    }

    function openDirMenuForPath(path) {
      const p = String(path || "");
      if (!p) return;
      if (openBulkActionMenuForSelection(p)) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = p;
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      const idx = findDirEntryIndexByPath(p);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function openFileMenuForId(fileId) {
      const id = String(fileId || "");
      if (!id) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = id;
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) {
          WS.nav.selectedIndex = findNearestSelectableIndex(i, 1);
          syncPreviewToSelection();
          break;
        }
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function entryKeyForSelection(entry) {
      if (!entry) return "";
      if (entry.kind === "dir") return `dir:${String(entry.node?.path || "")}`;
      if (entry.kind === "file") return `file:${String(entry.id || "")}`;
      return "";
    }

    function findEntryIndexByKey(key) {
      if (!key) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entryKeyForSelection(entry) === key) return i;
      }
      return -1;
    }

    function toggleEntrySelection(entry) {
      if (!entry) return;
      if (entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (!p) return;
        if (WS.view.bulkTagSelectedPaths.has(p)) WS.view.bulkTagSelectedPaths.delete(p);
        else WS.view.bulkTagSelectedPaths.add(p);
      } else if (entry.kind === "file") {
        const id = String(entry.id || "");
        if (!id) return;
        if (WS.view.bulkFileSelectedIds.has(id)) WS.view.bulkFileSelectedIds.delete(id);
        else WS.view.bulkFileSelectedIds.add(id);
      }
    }

    function addEntrySelection(entry) {
      if (!entry) return;
      if (entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (p) WS.view.bulkTagSelectedPaths.add(p);
      } else if (entry.kind === "file") {
        const id = String(entry.id || "");
        if (id) WS.view.bulkFileSelectedIds.add(id);
      }
    }

    function selectEntryRange(anchorIdx, targetIdx) {
      if (anchorIdx < 0 || targetIdx < 0) return;
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      clearBulkTagSelection();
      WS.view.bulkSelectMode = true;
      for (let i = start; i <= end; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || !isSelectableEntry(entry)) continue;
        addEntrySelection(entry);
      }
    }

    function canTrackDirHistory() {
      if (!WS.root) return false;
      if (!WS.nav.dirNode) return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode || WS.view.hiddenMode) return false;
      return true;
    }

    function recordDirHistory() {
      if (!canTrackDirHistory()) return;
      const path = String(WS.nav.dirNode?.path || "");
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      const cur = WS.view.dirHistory[WS.view.dirHistoryIndex] || null;
      if (cur && cur.path === path) {
        cur.selectedKey = selectedKey;
        return;
      }
      if (WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1) {
        WS.view.dirHistory = WS.view.dirHistory.slice(0, WS.view.dirHistoryIndex + 1);
      }
      WS.view.dirHistory.push({ path, selectedKey });
      WS.view.dirHistoryIndex = WS.view.dirHistory.length - 1;
    }

    function initDirHistory() {
      WS.view.dirHistory = [];
      WS.view.dirHistoryIndex = -1;
      if (!WS.root || !WS.nav.dirNode) return;
      const path = String(WS.nav.dirNode?.path || "");
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      WS.view.dirHistory.push({ path, selectedKey });
      WS.view.dirHistoryIndex = 0;
    }

    function restoreDirHistoryEntry(entry) {
      if (!entry || !WS.root) return;
      const node = WS.dirByPath.get(String(entry.path || "")) || WS.root;
      WS.nav.dirNode = node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      const idx = findEntryIndexByKey(String(entry.selectedKey || ""));
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function positionDropdownMenu(menuBtn, menuEl) {
      if (!menuBtn || !menuEl) return;
      menuEl.classList.add("fixed");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      menuEl.style.right = "auto";

      const btnRect = menuBtn.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();

      let left = btnRect.right - menuRect.width;
      if (left < 8) left = 8;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }

      let top = btnRect.bottom + 4;
      if (top + menuRect.height > window.innerHeight - 8) {
        top = btnRect.top - 4 - menuRect.height;
      }
      if (top < 8) top = 8;

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
    }

    function positionDropdownMenuAtPoint(menuEl, x, y) {
      if (!menuEl) return;
      menuEl.classList.add("fixed");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      menuEl.style.right = "auto";

      const menuRect = menuEl.getBoundingClientRect();
      let left = x;
      let top = y;

      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - menuRect.height - 8);
      }

      left = Math.max(8, left);
      top = Math.max(8, top);

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
    }

    async function commitRenameEdit(path, inputEl) {
      if (RENAME_BUSY) return;
      const dirNode = WS.dirByPath.get(String(path || ""));
      if (!dirNode) {
        RENAME_EDIT_PATH = null;
        renderDirectoriesPane(true);
        return;
      }
      RENAME_BUSY = true;
      let ok = false;
      if (dirNode.onlineMeta && (dirNode.onlineMeta.kind === "profile" || dirNode.onlineMeta.kind === "post")) {
        const nextName = inputEl.value || "";
        if (dirNode.onlineMeta.kind === "profile") {
          ok = await renameOnlineProfile(dirNode.onlineMeta.profileKey, nextName);
        } else {
          ok = await renameOnlinePost(dirNode.onlineMeta.profileKey, dirNode.onlineMeta.postKey, nextName);
        }
      } else {
        ok = await renameFolderDirNode(dirNode, inputEl.value || "");
      }
      RENAME_BUSY = false;
      if (ok) {
        RENAME_EDIT_PATH = null;
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        renderOnlineUi();
        return;
      }
      renderDirectoriesPane(true);
    }

    async function commitFileRenameEdit(fileId, inputEl) {
      if (RENAME_BUSY) return;
      const rec = WS.fileById.get(String(fileId || ""));
      if (!rec) {
        RENAME_EDIT_FILE_ID = null;
        renderDirectoriesPane(true);
        return;
      }
      RENAME_BUSY = true;
      let ok = false;
      if (rec.online && rec.onlineMeta) {
        ok = await renameOnlineFile(rec.onlineMeta.profileKey, rec.onlineMeta.fileUrl, inputEl.value || "");
      } else {
        ok = await renameSingleFile(rec, inputEl.value || "");
      }
      RENAME_BUSY = false;
      if (ok) {
        RENAME_EDIT_FILE_ID = null;
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        return;
      }
      renderDirectoriesPane(true);
    }

    function getDirectoriesWithTag(tag) {
      if (!tag) return [];
      if (!WS.nav.dirNode) return [];
      const children = getChildDirsForNodeBase(WS.nav.dirNode);
      if (!children.length) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function gatherTagPathsForDirs(dirs) {
      const seen = new Set();
      const out = [];
      for (const dir of dirs || []) {
        const p = String(dir?.path || "");
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return out;
    }

    function closeTagContextMenu() {
      if (!tagActionMenuEl) return;
      tagActionMenuEl.classList.remove("open", "fixed");
      tagActionMenuEl.innerHTML = "";
      tagActionMenuEl.style.left = "";
      tagActionMenuEl.style.top = "";
      TAG_CONTEXT_MENU_STATE = null;
    }

    function closePreviewContextMenu() {
      if (!previewActionMenuEl) return;
      previewActionMenuEl.classList.remove("open", "fixed");
      previewActionMenuEl.innerHTML = "";
      previewActionMenuEl.style.left = "";
      previewActionMenuEl.style.top = "";
      PREVIEW_CONTEXT_MENU_STATE = null;
    }

    function openTagContextMenu(context) {
      if (!context || !tagActionMenuEl) return;
      const tag = String(context.tag || "").trim();
      const paths = Array.isArray(context.paths) ? context.paths : [];
      const anchor = context.anchor;
      if (!tag || !paths.length || !anchor) return;
      closeTagContextMenu();
      closeActionMenus();
      const menu = tagActionMenuEl;
      menu.appendChild(createTagMenuButton("Rename tag", () => handleTagMenuAction("rename")));
      menu.appendChild(createTagMenuButton("Delete tag", () => handleTagMenuAction("delete")));
      TAG_CONTEXT_MENU_STATE = {
        tag,
        label: context.label || tag,
        paths: paths.slice()
      };
      requestAnimationFrame(() => {
        menu.classList.add("open");
        positionDropdownMenu(anchor, menu);
      });
    }

    function openPreviewContextMenu(x, y) {
      if (!previewActionMenuEl) return;
      closeActionMenus();
      renderDirectoriesPane(true);

      const dirNode = getPreviewTargetDir();
      const ids = dirNode ? getOrderedFileIdsForDir(dirNode) : [];
      const canReverse = !!dirNode && canReorderFilesInDir(dirNode) && ids.length > 1;

      const menu = previewActionMenuEl;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Reverse file order";
      if (!canReverse) btn.disabled = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canReverse) return;
        if (reverseFilesInDir(dirNode, { visibleIds: ids })) {
          syncAfterDirOrderChange(null, { preserveSelection: true });
        }
        closePreviewContextMenu();
      });
      menu.appendChild(btn);
      PREVIEW_CONTEXT_MENU_STATE = { dirPath: String(dirNode?.path || "") };

      requestAnimationFrame(() => {
        menu.classList.add("open");
        positionDropdownMenuAtPoint(menu, x, y);
      });
    }

    function createTagMenuButton(label, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    function renameTagForPaths(tag, newName, paths) {
      const normalizedOld = String(tag || "");
      const normalizedNew = normalizeTag(newName || "");
      if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew) return false;
      const uniquePaths = Array.from(new Set((paths || []).filter(p => p)));
      let changed = false;
      for (const p of uniquePaths) {
        const tags = metaGetUserTags(p);
        if (!tags.includes(normalizedOld)) continue;
        const updated = tags.slice();
        for (let i = 0; i < updated.length; i++) {
          if (updated[i] === normalizedOld) updated[i] = normalizedNew;
        }
        const deduped = [];
        const seen = new Set();
        for (const t of updated) {
          if (!t) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          deduped.push(t);
        }
        if (metaWriteUserTags(p, deduped)) changed = true;
      }
      return changed;
    }

    function deleteTagFromPaths(tag, paths) {
      const normalized = String(tag || "");
      if (!normalized) return false;
      const uniquePaths = Array.from(new Set((paths || []).filter(p => p)));
      let changed = false;
      for (const p of uniquePaths) {
        const tags = metaGetUserTags(p);
        if (!tags.includes(normalized)) continue;
        const filtered = tags.filter(t => t !== normalized);
        if (metaWriteUserTags(p, filtered)) changed = true;
      }
      return changed;
    }

    function handleTagMenuAction(action) {
      const ctx = TAG_CONTEXT_MENU_STATE;
      if (!ctx) return;
      closeTagContextMenu();
      const tag = ctx.tag || "";
      const label = ctx.label || tag;
      const paths = ctx.paths || [];
      if (!tag || !paths.length) {
        showStatusMessage("No folders contain that tag.");
        return;
      }
      if (action === "rename") {
        TAG_ENTRY_RENAME_STATE = { tag, label, paths };
        renderDirectoriesPane(true);
        return;
      }
      if (action === "delete") {
        const confirmed = confirm(`Remove tag '${label}' from these folders?`);
        if (!confirmed) return;
        const changed = deleteTagFromPaths(tag, paths);
        if (!changed) {
          showStatusMessage("No folders updated.");
          return;
        }
        metaScheduleSave();
        refreshAfterTagMetadataChange();
      }
    }

    function renderDirectoriesTagsHeader() {
      if (!directoriesTagsRowEl) return;
      directoriesTagsRowEl.style.display = "none";
      directoriesTagsRowEl.innerHTML = "";
    }

    function renderDirectoriesActionHeader() {
      if (!directoriesActionRowEl || !directoriesActionMenuEl) return;

      if (!WS.root) {
        directoriesActionRowEl.style.display = "none";
        if (WS.view.bulkActionMenuOpen) {
          WS.view.bulkActionMenuOpen = false;
          WS.view.bulkActionMenuAnchorPath = "";
        }
        directoriesActionMenuEl.classList.remove("open");
        directoriesActionMenuEl.innerHTML = "";
        return;
      }

      const canBulk = canUseBulkSelection();
      if (!canBulk && WS.view.bulkSelectMode) {
        WS.view.bulkSelectMode = false;
        clearBulkTagSelection();
      }

      const selectedDirs = canBulk ? getSelectedPathsInCurrentDir() : [];
      const visibleDirNodeByPath = new Map();
      for (const entry of (WS.nav.entries || [])) {
        if (!entry || entry.kind !== "dir" || !entry.node) continue;
        const p = String(entry.node.path || "");
        if (!p) continue;
        visibleDirNodeByPath.set(p, entry.node);
      }
      const selectedDirNodes = selectedDirs.map((p) => {
        const key = String(p || "");
        return visibleDirNodeByPath.get(key) || WS.dirByPath.get(key) || null;
      }).filter(Boolean);
      const selectedDirCount = selectedDirNodes.length;
      const allOnlineDirs = selectedDirCount > 0 && selectedDirNodes.every(d => d?.onlineMeta && (d.onlineMeta.kind === "profile" || d.onlineMeta.kind === "post"));
      const allProfileDirs = allOnlineDirs && selectedDirNodes.every(d => d?.onlineMeta?.kind === "profile");
      const allPostDirs = allOnlineDirs && selectedDirNodes.every(d => d?.onlineMeta?.kind === "post");
      const allLocalDirs = selectedDirCount > 0 && selectedDirNodes.every(d => !d?.onlineMeta);
      const allTrashDirs = selectedDirCount > 0 && selectedDirNodes.every(d => isTrashVirtualDirNode(d));
      const inTrashTagMode = isViewingTagFolder() && WS.view.tagFolderActiveMode === "trash";
      const selectedFiles = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selCount = selectedDirs.length + selectedFiles.length;
      const hasDirSelection = selectedDirs.length > 0;
      if (!selCount) {
        WS.view.bulkActionMenuOpen = false;
        WS.view.bulkActionMenuAnchorPath = "";
      }

      const rowVisible = canBulk && (WS.view.bulkSelectMode || WS.view.bulkActionMenuOpen);
      directoriesActionRowEl.style.display = rowVisible ? "flex" : "none";

      if (directoriesSelectAllBtn) {
        const visibleFiles = canBulk ? Array.from(getVisibleFileIdsInEntries()) : [];
        const allSelected = visibleFiles.length > 0 && selectedFiles.length === visibleFiles.length;
        directoriesSelectAllBtn.style.display = "none";
        directoriesSelectAllBtn.disabled = !WS.view.bulkSelectMode || !visibleFiles.length || allSelected;
      }

      const menuOpen = WS.view.bulkActionMenuOpen && canBulk && hasDirSelection;
      directoriesActionMenuEl.classList.toggle("open", menuOpen);
      directoriesActionMenuEl.innerHTML = "";

      if (!menuOpen) return;

      const allFavorite = selectedDirs.every(p => metaHasFavorite(p));
      const allHidden = selectedDirs.every(p => metaHasHidden(p));

      const makeActionBtn = (label, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onClick();
        });
        return btn;
      };

      if (allOnlineDirs) {
        directoriesActionMenuEl.appendChild(makeActionBtn("Download selected folders", async () => {
          WS.view.bulkActionMenuOpen = false;
          await materializeOnlineFolderSelection(selectedDirNodes);
          finalizeBulkSelectionAction();
        }));

        if (allProfileDirs) {
          directoriesActionMenuEl.appendChild(makeActionBtn("Refresh selected profiles", async () => {
            WS.view.bulkActionMenuOpen = false;
            const keys = Array.from(new Set(selectedDirNodes.map(d => d?.onlineMeta?.profileKey).filter(Boolean)));
            for (const key of keys) {
              await refreshOnlineProfile(key);
            }
            finalizeBulkSelectionAction();
          }));
        }

        directoriesActionMenuEl.appendChild(makeActionBtn("Tag selected", () => {
          WS.view.bulkActionMenuOpen = false;
          if (!selectedDirs.length) return;
          finalizeBulkSelectionAction();
          startBulkTagging(selectedDirs);
        }));

        directoriesActionMenuEl.appendChild(makeActionBtn(allFavorite ? "Unfavorite selected" : "Favorite selected", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetFavoriteBulk(selectedDirs, !allFavorite);
          finalizeBulkSelectionAction();
        }));

        const scrubSelectedBtn = makeActionBtn("Scrub", async () => {
          WS.view.bulkActionMenuOpen = false;
          await scrubFoldersByPaths(selectedDirs);
          finalizeBulkSelectionAction();
        });
        if (!WS.meta.fsRootHandle) scrubSelectedBtn.disabled = true;
        directoriesActionMenuEl.appendChild(scrubSelectedBtn);

        if (allProfileDirs) {
          const renameBtn = makeActionBtn("Rename profile", () => {
            WS.view.bulkActionMenuOpen = false;
            const p = String(selectedDirs[0] || "");
            if (!p) return;
            RENAME_EDIT_PATH = p;
            TAG_EDIT_PATH = null;
            renderDirectoriesPane(true);
            setTimeout(() => {
              const row = findDirRowForPath(p);
              const input = (row && row.querySelector(".renameEditInput")) || (directoriesListEl && directoriesListEl.querySelector(".dirRow.selected .renameEditInput"));
              if (input) {
                try { input.focus(); input.select(); } catch {}
              }
            }, 0);
          });
          if (selectedDirCount !== 1) renameBtn.disabled = true;
          directoriesActionMenuEl.appendChild(renameBtn);

          directoriesActionMenuEl.appendChild(makeActionBtn("Delete selected profiles", async () => {
            WS.view.bulkActionMenuOpen = false;
            const confirmed = confirm("Delete selected profiles and all related folders?");
            if (!confirmed) return;
            const keys = Array.from(new Set(selectedDirNodes.map(d => d?.onlineMeta?.profileKey).filter(Boolean)));
            for (const key of keys) {
              await deleteOnlineProfile(key);
            }
            finalizeBulkSelectionAction();
          }));
        } else if (allPostDirs) {
          const renameBtn = makeActionBtn("Rename post", () => {
            WS.view.bulkActionMenuOpen = false;
            const p = String(selectedDirs[0] || "");
            if (!p) return;
            RENAME_EDIT_PATH = p;
            TAG_EDIT_PATH = null;
            renderDirectoriesPane(true);
            setTimeout(() => {
              const row = findDirRowForPath(p);
              const input = (row && row.querySelector(".renameEditInput")) || (directoriesListEl && directoriesListEl.querySelector(".dirRow.selected .renameEditInput"));
              if (input) {
                try { input.focus(); input.select(); } catch {}
              }
            }, 0);
          });
          if (selectedDirCount !== 1) renameBtn.disabled = true;
          directoriesActionMenuEl.appendChild(renameBtn);
        }
      } else {
        if (inTrashTagMode) {
          const restoreSelectedBtn = makeActionBtn("Restore selected folders", async () => {
            const trashNames = selectedDirNodes
              .filter(d => isTrashVirtualDirNode(d))
              .map(d => String(d.trashName || ""))
              .filter(Boolean);
            if (!trashNames.length) {
              showStatusMessage("No trash folders selected.");
              return;
            }
            const count = trashNames.length;
            const confirmed = confirm(`Restore ${count} folder${count === 1 ? "" : "s"} from trash?`);
            if (!confirmed) return;
            WS.view.bulkActionMenuOpen = false;
            const result = await restoreTrashFoldersByNames(trashNames);
            if (result.restored > 0) finalizeBulkSelectionAction();
          });
          if (!WS.meta.fsRootHandle || !allTrashDirs) restoreSelectedBtn.disabled = true;
          directoriesActionMenuEl.appendChild(restoreSelectedBtn);
          return;
        }

        const scoreRow = document.createElement("div");
        scoreRow.className = "scoreRow";
        const scoreUpBtn = makeActionBtn("+", () => {
          WS.view.bulkActionMenuOpen = false;
          metaBumpScoreBulk(selectedDirs, 1);
          finalizeBulkSelectionAction();
        });
        scoreUpBtn.classList.add("scoreBtn");
        const scoreDownBtn = makeActionBtn("-", () => {
          WS.view.bulkActionMenuOpen = false;
          metaBumpScoreBulk(selectedDirs, -1);
          finalizeBulkSelectionAction();
        });
        scoreDownBtn.classList.add("scoreBtn");
        scoreRow.appendChild(scoreUpBtn);
        scoreRow.appendChild(scoreDownBtn);
        directoriesActionMenuEl.appendChild(scoreRow);

        directoriesActionMenuEl.appendChild(makeActionBtn("Tag selected", () => {
          WS.view.bulkActionMenuOpen = false;
          if (!selectedDirs.length) return;
          finalizeBulkSelectionAction();
          startBulkTagging(selectedDirs);
        }));

        directoriesActionMenuEl.appendChild(makeActionBtn(allFavorite ? "Unfavorite selected" : "Favorite selected", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetFavoriteBulk(selectedDirs, !allFavorite);
          finalizeBulkSelectionAction();
        }));

        directoriesActionMenuEl.appendChild(makeActionBtn(allHidden ? "Unhide selected" : "Hide selected", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetHiddenBulk(selectedDirs, !allHidden);
          finalizeBulkSelectionAction();
        }));

        const scrubSelectedBtn = makeActionBtn("Scrub", async () => {
          WS.view.bulkActionMenuOpen = false;
          await scrubFoldersByPaths(selectedDirs);
          finalizeBulkSelectionAction();
        });
        if (!WS.meta.fsRootHandle) scrubSelectedBtn.disabled = true;
        directoriesActionMenuEl.appendChild(scrubSelectedBtn);

        const setMergeBtn = makeActionBtn("Set Merge", async () => {
          WS.view.bulkActionMenuOpen = false;
          await setMergeSelectedDirs();
        });
        if (!WS.meta.fsRootHandle) setMergeBtn.disabled = true;
        directoriesActionMenuEl.appendChild(setMergeBtn);

        const deleteSelectedBtn = makeActionBtn("Delete selected folders", async () => {
          const localPaths = selectedDirNodes
            .filter(d => d && !d.onlineMeta)
            .map(d => String(d.path || ""))
            .filter(Boolean);
          if (!localPaths.length) {
            showStatusMessage("No folders selected.");
            return;
          }
          const count = localPaths.length;
          const confirmed = confirm(`Move ${count} selected folder${count === 1 ? "" : "s"} to trash?`);
          if (!confirmed) return;
          WS.view.bulkActionMenuOpen = false;
          const moved = await moveFolderPathsToTrash(localPaths);
          if (moved) finalizeBulkSelectionAction();
        });
        deleteSelectedBtn.classList.add("destructiveAction");
        if (!WS.meta.fsRootHandle || !allLocalDirs) deleteSelectedBtn.disabled = true;
        directoriesActionMenuEl.appendChild(deleteSelectedBtn);
      }

      const anchorBtn = findDirMenuButtonForPath(WS.view.bulkActionMenuAnchorPath);
      if (anchorBtn) {
        requestAnimationFrame(() => positionDropdownMenu(anchorBtn, directoriesActionMenuEl));
      }
    }

    function findDirMenuButtonForPath(path) {
      if (!directoriesListEl) return null;
      const rows = directoriesListEl.querySelectorAll(".dirRow");
      let fallback = null;
      for (const row of rows) {
        const btn = row.querySelector(".dirMenuBtn");
        if (btn && !fallback) fallback = btn;
        if (path && row.dataset && row.dataset.dirPath === path) {
          return btn;
        }
      }
      return fallback;
    }

    function findDirRowForPath(path) {
      if (!directoriesListEl) return null;
      const rows = directoriesListEl.querySelectorAll(".dirRow");
      for (const row of rows) {
        if (String(row?.dataset?.dirPath || "") === String(path || "")) return row;
      }
      return null;
    }

    function setDirectoriesHeaderActive(active) {
      if (!directoriesHeader) return;
      directoriesHeader.classList.toggle("active", !!active);
    }

    function renderDirectoriesBulkHeader() {
      if (!directoriesBulkRowEl) return;
      directoriesBulkRowEl.style.display = "none";
      directoriesBulkRowEl.innerHTML = "";
    }

    function renderDirectoriesPane(keepScroll = false) {
      const prevScroll = keepScroll ? directoriesListEl.scrollTop : 0;
      directoriesListEl.innerHTML = "";
      updateTitleLabel();
      const showFolderItemCount = !(WS.meta && WS.meta.options && WS.meta.options.showFolderItemCount === false);
      const showFolderSize = !(WS.meta && WS.meta.options && WS.meta.options.showFolderSize === false);
      const showDirFileTypeLabel = !(WS.meta && WS.meta.options && WS.meta.options.showDirFileTypeLabel === false);
      const dirSortMetrics = buildDirSortMetrics();
      const dirSizeByPath = dirSortMetrics.sizeByPath;
      const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
      const selectedFilesInView = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selectedFilesInViewCount = selectedFilesInView.length;
      renderDirectoriesTagsHeader();
      renderDirectoriesBulkHeader();
      renderDirectoriesActionHeader();

      const headerActive = !!WS.root && (
        (directoriesTagsRowEl && directoriesTagsRowEl.style.display !== "none") ||
        (directoriesBulkRowEl && directoriesBulkRowEl.style.display !== "none")
      );
      setDirectoriesHeaderActive(headerActive);

      if (!WS.root) {
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }


      if (!WS.nav.entries.length) {
        let emptyMsg = "Empty directory.";
        if (isViewingTagFolder()) {
          if (WS.view.tagFolderActiveMode === "favorites") emptyMsg = "No favorite folders.";
          else if (WS.view.tagFolderActiveMode === "hidden") emptyMsg = "No hidden folders.";
          else if (WS.view.tagFolderActiveMode === "trash") emptyMsg = "Trash is empty.";
          else {
            const tagLabel = String(WS.view.tagFolderActiveTag || "");
            emptyMsg = tagLabel ? `No folders tagged '${tagLabel}'.` : "No tagged folders.";
          }
        }
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">${escapeHtml(emptyMsg)}</div>`;
        renderDirectoriesActionHeader();
        return;
      }

      let maxMetaLen = 10;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "dir") {
          if (showFolderItemCount) {
            const countText = `${dirItemCount(entry.node)} items`;
            if (countText.length > maxMetaLen) maxMetaLen = countText.length;
          }
          if (showFolderSize) {
            const sizeText = formatOnlineDownloadBytes(dirSizeByPath.get(String(entry.node?.path || "")) || 0);
            if (sizeText.length > maxMetaLen) maxMetaLen = sizeText.length;
          }
        }
      }
      try { directoriesListEl.style.setProperty("--dirMetaCh", String(maxMetaLen)); } catch {}

      const frag = document.createDocumentFragment();
      WS.nav.entries.forEach((entry, idx) => {
        const row = document.createElement("div");
        row.className = "dirRow" + (idx === WS.nav.selectedIndex ? " selected" : "");
        row.tabIndex = -1;

        const isTagEntry = entry.kind === "tag";
        if (isTagEntry) {
          row.classList.add("tagEntry");
        }

        const renameActive = isTagEntry && !entry.special && TAG_ENTRY_RENAME_STATE && (
          (entry.placeholder && TAG_ENTRY_RENAME_STATE.placeholder) ||
          (entry.tag && entry.tag === TAG_ENTRY_RENAME_STATE.tag)
        );
        if (isTagEntry) {
          const label = String(entry.label || entry.tag || "Tag");
          const countText = entry.count ? `${entry.count} folders` : "Tag folder";
          const iconText = entry.special === "trash" ? "🗑" : "🏷";
          if (renameActive) {
            const initialValue = TAG_ENTRY_RENAME_STATE.label || label;
            row.innerHTML = `
              <div class="dirIcon">${iconText}</div>
              <div class="dirName"><input class="tagEditInput tagEntryRenameInput renameEditInput" type="text" value="${escapeHtml(initialValue)}" placeholder="${escapeHtml(label)}" /></div>
              <div class="dirMeta">${escapeHtml(countText)}</div>
            `;
          } else {
            row.innerHTML = `
              <div class="dirIcon">${iconText}</div>
              <div class="dirName" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
              <div class="dirMeta">${escapeHtml(countText)}</div>
            `;
          }
        } else {
          let icon = "📁";
          let name = "";
          let nameHtml = "";
          let meta = "";
          let voteHtml = "";
          let rightHtml = "";
          let fileMenuHtml = "";

          if (entry.kind === "dir") {
            row.dataset.dirPath = entry.node?.path || "";
            const p = entry.node?.path || "";
            const isFavorite = metaHasFavorite(p);
            const isHidden = metaHasHidden(p);
            const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
            if (sel) row.classList.add("bulkSelected");
            const isTrashFolder = isTrashVirtualDirNode(entry.node);
            const onlineKind = entry.node?.onlineMeta?.kind || "";
            const canRename = onlineKind ? true : !!WS.meta.fsRootHandle;
            const canBatchIndex = !!WS.meta.fsRootHandle;
            const canResetOrder = !!entry.node?.preserveOrder;
            const canDeleteFolder = !onlineKind && !!WS.meta.fsRootHandle && !!entry.node?.parent;
            icon = "📁";
            name = dirDisplayName(entry.node);
            const dirMetaLines = [];
            if (showFolderItemCount) dirMetaLines.push(`${dirItemCount(entry.node)} items`);
            if (isTrashFolder && entry.node?.trashOriginalPath) {
              dirMetaLines.push(`From ${displayPath(entry.node.trashOriginalPath)}`);
            }
            if (showFolderSize) dirMetaLines.push(formatOnlineDownloadBytes(dirSizeByPath.get(String(p || "")) || 0));
            const statusBadges = [];
            if (isFavorite) statusBadges.push(`<span class="dirFavoriteHeart dirStatusBadge" title="Favorite">♥</span>`);
            if (onlineKind) {
              statusBadges.push(buildOnlineSourceIconHtml(entry.node, {
                className: "dirOnlineBadge dirStatusBadge onlineSourceIcon",
                imgClassName: "onlineSourceIconImg onlineDirBadgeIcon",
                fallbackClassName: "onlineSourceIconFallback onlineDirBadgeFallback",
                title: "Online"
              }));
            }
            if (isHidden) statusBadges.push(`<span class="dirHiddenBadge dirStatusBadge" title="Hidden">🙈</span>`);
            const statusBadgeHtml = statusBadges.length ? `<span class="dirStatusBadges">${statusBadges.join("")}</span>` : "";
            nameHtml = `<span class="dirNameText">${escapeHtml(name)}</span>${statusBadgeHtml}`;
            const sc = metaGetScore(p);
            const scoreMode = folderScoreDisplayMode();
            if (!isTrashFolder && scoreMode !== "hidden") {
              const arrows = scoreMode === "show";
              voteHtml = `
          <div class="voteBox" data-path="${escapeHtml(p)}">
            ${arrows ? `<div class="voteBtn up">▲</div>` : ""}
            <div class="voteScore">${sc}</div>
            ${arrows ? `<div class="voteBtn down">▼</div>` : ""}
          </div>
          `;
            }
            const menuOpen = WS.view.dirActionMenuPath === p;
            // Menu (three dot / ⋯) for single-folder actions.
            let menuButtons = "";
            let menuTitle = "Folder menu";
            if (isTrashFolder) {
              menuTitle = "Trash folder menu";
              menuButtons = `
                <button type="button" data-action="restore-trash-folder"${entry.node?.trashOriginalPath ? "" : " disabled"}>Restore to original location</button>
              `;
            } else if (onlineKind === "profile") {
              menuTitle = "Profile menu";
              menuButtons = `
                <div class="scoreRow">
                  <button type="button" class="scoreBtn" data-action="score-up">+</button>
                  <button type="button" class="scoreBtn" data-action="score-down">-</button>
                </div>
                <button type="button" data-action="download-online-folder">Download in place</button>
                <button type="button" data-action="refresh-profile">Refresh profile</button>
                <button type="button" data-action="scrub-folder"${WS.meta.fsRootHandle ? "" : " disabled"}>Scrub</button>
                <button type="button" data-action="tag">Tag</button>
                <button type="button" data-action="favorite">${isFavorite ? "Unfavorite" : "Favorite"}</button>
                <button type="button" data-action="rename-profile"${canRename ? "" : " disabled"}>Rename profile</button>
                <button type="button" data-action="delete-profile">Delete profile</button>
              `;
            } else if (onlineKind === "post") {
              menuTitle = "Post menu";
              menuButtons = `
                <div class="scoreRow">
                  <button type="button" class="scoreBtn" data-action="score-up">+</button>
                  <button type="button" class="scoreBtn" data-action="score-down">-</button>
                </div>
                <button type="button" data-action="download-online-folder">Download in place</button>
                <button type="button" data-action="scrub-folder"${WS.meta.fsRootHandle ? "" : " disabled"}>Scrub</button>
                <button type="button" data-action="tag">Tag</button>
                <button type="button" data-action="favorite">${isFavorite ? "Unfavorite" : "Favorite"}</button>
                <button type="button" data-action="rename-post"${canRename ? "" : " disabled"}>Rename post</button>
              `;
            } else {
              menuButtons = `
                <div class="scoreRow">
                  <button type="button" class="scoreBtn" data-action="score-up">+</button>
                  <button type="button" class="scoreBtn" data-action="score-down">-</button>
                </div>
                <button type="button" data-action="tag">Tag</button>
                <button type="button" data-action="rename"${canRename ? "" : " disabled"}>Rename</button>
                <button type="button" data-action="batch-index-1"${canBatchIndex ? "" : " disabled"}>Batch Index I</button>
                <button type="button" data-action="batch-index-2"${canBatchIndex ? "" : " disabled"}>Batch Index II</button>
                <button type="button" data-action="reset-order"${canResetOrder ? "" : " disabled"}>Reset order</button>
                <button type="button" data-action="scrub-folder"${WS.meta.fsRootHandle ? "" : " disabled"}>Scrub</button>
                <button type="button" data-action="favorite">${isFavorite ? "Unfavorite" : "Favorite"}</button>
                <button type="button" data-action="hidden">${isHidden ? "Unhide" : "Hide"}</button>
                <button type="button" class="destructiveAction" data-action="delete-folder"${canDeleteFolder ? "" : " disabled"}>Delete folder</button>
              `;
            }
            const menuHtml = `
              <div class="dirMenu">
              <button class="dirMenuBtn" title="${escapeHtml(menuTitle)}">⋯</button>
              <div class="dropdownMenu${menuOpen ? " open" : ""}">
                ${menuButtons}
              </div>
            </div>
            `;
            const metaHtml = dirMetaLines.length
              ? `<div class="dirMeta">${dirMetaLines.map(line => `<div class="dirMetaLine">${escapeHtml(line)}</div>`).join("")}</div>`
              : "";
            const onlineDlHtml = onlineKind ? buildOnlineDownloadMetaHtml(entry.node) : "";
            rightHtml = `<div class="dirRight">${metaHtml}${onlineDlHtml}${menuHtml}</div>`;
          } else {
            const rec = WS.fileById.get(entry.id);
            const isVid = rec?.type === "video";
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(String(entry.id || ""));
            if (sel) row.classList.add("bulkSelected");
            icon = isVid ? "🎞" : "🖼";
            name = fileDisplayNameForRecord(rec);
            meta = showDirFileTypeLabel ? (isVid ? "video" : "image") : "";
            const fileMenuOpen = WS.view.fileActionMenuId === String(entry.id || "");
            const bulkFileMenuActive = canBulk && sel && selectedFilesInViewCount > 0;
            const canLooseSetMerge = !!WS.meta.fsRootHandle;
            const isOnlineFile = !!rec?.online;
            const fileMenuButtons = bulkFileMenuActive
              ? (isOnlineFile
                ? `<button type="button" data-action="rename-online-file"${selectedFilesInViewCount > 1 ? " disabled" : ""}>Rename file</button>`
                : `<button type="button" data-action="loose-set-merge"${canLooseSetMerge ? "" : " disabled"}>Loose Set Merge</button>`)
              : (isOnlineFile
                ? `<button type="button" data-action="rename-online-file">Rename file</button>`
                : `<button type="button" data-action="rename-file">Rename</button>`);
            // File menu (three dot / ⋯) for single-file actions.
            fileMenuHtml = `
              <div class="dirMenu">
              <button class="dirMenuBtn" title="${escapeHtml(isOnlineFile ? "Media menu" : "File menu")}">⋯</button>
              <div class="dropdownMenu${fileMenuOpen ? " open" : ""}">
                ${fileMenuButtons}
              </div>
            </div>
            `;
          }

          if (entry.kind === "dir" && (entry.node?.path || "") === (RENAME_EDIT_PATH || "")) {
            const curName = String((entry.node?.onlineMeta?.kind === "profile" && getOnlineProfileRename(entry.node?.onlineMeta?.profileKey))
              || (entry.node?.onlineMeta?.kind === "post" && getOnlinePostRename(entry.node?.onlineMeta?.profileKey, entry.node?.onlineMeta?.postKey))
              || entry.node?.name || "");
            const renamePlaceholder = entry.node?.onlineMeta?.kind === "profile"
              ? "profile name"
              : (entry.node?.onlineMeta?.kind === "post" ? "post name" : "folder name");
            if (voteHtml) {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="${escapeHtml(renamePlaceholder)}" /></div>
                ${voteHtml}
                ${rightHtml}
              `;
            } else {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="${escapeHtml(renamePlaceholder)}" /></div>
                ${rightHtml}
              `;
            }
          } else if (entry.kind === "dir" && (entry.node?.path || "") === (TAG_EDIT_PATH || "")) {
            const p = entry.node?.path || "";
            const curTags = metaGetUserTags(p).join(", ");
            if (voteHtml) {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput" type="text" value="${escapeHtml(curTags)}" placeholder="tag1, tag2" /></div>
                ${voteHtml}
                ${rightHtml}
              `;
            } else {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput" type="text" value="${escapeHtml(curTags)}" placeholder="tag1, tag2" /></div>
                ${rightHtml}
              `;
            }
          } else {
            if (entry.kind === "dir") {
              if (voteHtml) {
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName dirNameWithBadge" title="${escapeHtml(name)}">${nameHtml}</div>
                  ${voteHtml}
                  ${rightHtml}
                `;
              } else {
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName dirNameWithBadge" title="${escapeHtml(name)}">${nameHtml}</div>
                  ${rightHtml}
                `;
              }
            } else {
              if (String(entry.id || "") === String(RENAME_EDIT_FILE_ID || "")) {
                const rec = WS.fileById.get(entry.id);
                const curName = String((rec?.online && rec?.onlineMeta && getOnlineFileRename(rec.onlineMeta.profileKey, rec.onlineMeta.fileUrl)) || rec?.name || "");
                const metaHtml = meta ? `<div class="dirMeta">${escapeHtml(meta)}</div>` : "";
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="file name" /></div>
                  ${metaHtml}
                  ${fileMenuHtml}
                `;
              } else {
            const metaHtml = meta ? `<div class="dirMeta">${escapeHtml(meta)}</div>` : "";
            row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                ${metaHtml}
                ${fileMenuHtml}
              `;
          }
            }
          }
        }

        if (isTagEntry && !entry.special && entry.tag) {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dirs = getDirsForTagEntry(entry);
            const paths = gatherTagPathsForDirs(dirs);
            openTagContextMenu({
              tag: String(entry.tag || ""),
              label: String(entry.label || entry.tag || ""),
              anchor: row,
              paths
            });
          });
        }

        if (isTagEntry && renameActive) {
          const renameInput = row.querySelector(".tagEntryRenameInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                cancelTagEntryRename();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitTagEntryRename(renameInput);
              }
            });
            renameInput.addEventListener("blur", () => {
              commitTagEntryRename(renameInput);
            });
          }
        }

        row.addEventListener("click", (e) => {
          closeActionMenus();
          if (e.shiftKey) {
            const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : idx;
            selectEntryRange(anchor, idx);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx);
            return;
          }
          if (e.ctrlKey || e.metaKey) {
            WS.view.bulkSelectMode = true;
            toggleEntrySelection(entry);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx);
            return;
          }

          if (WS.view.bulkSelectMode && (WS.view.bulkTagSelectedPaths.size || WS.view.bulkFileSelectedIds.size)) {
            clearBulkTagSelection();
            WS.view.bulkSelectMode = false;
          }
          WS.view.dirSelectAnchorIndex = idx;
          setDirectoriesSelection(idx);
        });

        if (entry.kind === "dir") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openDirMenuForPath(entry.node?.path || "");
          });
        } else if (entry.kind === "file") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openFileMenuForId(entry.id);
          });
        }

        if (entry.kind === "dir") {
          const p = entry.node?.path || "";

          const iconEl = row.querySelector(".dirIcon");
          if (iconEl) {
            const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
            const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
            if (canBulk) {
              iconEl.title = sel ? "Deselect folder" : "Select folder";
              iconEl.style.cursor = "pointer";
              iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!p) return;
                if (WS.view.bulkTagSelectedPaths.has(p)) WS.view.bulkTagSelectedPaths.delete(p);
                else WS.view.bulkTagSelectedPaths.add(p);
                renderDirectoriesPane(true);
              });
            } else {
              iconEl.style.cursor = "default";
            }
          }

          const up = row.querySelector(".voteBtn.up");
          const down = row.querySelector(".voteBtn.down");
          if (up) up.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(entry.node?.path || "", 1); });
          if (down) down.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(entry.node?.path || "", -1); });

          const menuBtn = row.querySelector(".dirMenuBtn");
          if (menuBtn) {
            menuBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (openBulkActionMenuForSelection(p)) return;
              if (WS.view.dirActionMenuPath === p) {
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              openDirMenuForPath(p);
            });
          }

          const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
          if (menuDropdown) {
            menuDropdown.addEventListener("click", (e) => e.stopPropagation());
            const actionButtons = Array.from(menuDropdown.querySelectorAll("button[data-action]"));
            actionButtons.forEach((btn) => {
              btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                WS.view.dirActionMenuPath = "";
                if (action === "download-online-folder") {
                  materializeOnlineFolderNode(entry.node).catch(() => {});
                  return;
                }
                if (action === "refresh-profile") {
                  const profileKey = entry.node?.onlineMeta?.profileKey || "";
                  if (!profileKey) return;
                  refreshOnlineProfile(profileKey);
                  return;
                }
                if (action === "delete-profile") {
                  const profileKey = entry.node?.onlineMeta?.profileKey || "";
                  if (!profileKey) return;
                  const confirmed = confirm("Delete this profile and all related folders?");
                  if (!confirmed) return;
                  deleteOnlineProfile(profileKey);
                  return;
                }
                if (action === "rename-profile" || action === "rename-post") {
                  RENAME_EDIT_PATH = p;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "tag") {
                  TAG_EDIT_PATH = p;
                  RENAME_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .tagEditInput") || row.querySelector(".tagEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "rename") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Rename requires a writable folder.");
                    return;
                  }
                  RENAME_EDIT_PATH = p;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "batch-index-1") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  batchIndexFolderFiles(entry.node);
                  return;
                }
                if (action === "batch-index-2") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  batchIndexChildFolderFiles(entry.node);
                  return;
                }
                if (action === "reset-order") {
                  if (entry && entry.node) {
                    resetDirFileOrder(entry.node, {
                      silent: entry.node !== WS.nav.dirNode,
                      selectId: null
                    });
                    if (entry.node !== WS.nav.dirNode) {
                      showStatusMessage("Order reset.");
                    }
                  }
                  return;
                }
                if (action === "scrub-folder") {
                  await scrubFoldersByPaths([p]);
                  return;
                }
                if (action === "restore-trash-folder") {
                  const trashName = String(entry.node?.trashName || "").trim();
                  if (!trashName) {
                    showStatusMessage("Trash folder cannot be restored.");
                    return;
                  }
                  const source = String(entry.node?.trashOriginalPath || "").trim();
                  if (!source) {
                    showStatusMessage("Original folder location is unknown.");
                    return;
                  }
                  const confirmed = confirm(`Restore folder to '${displayPath(source)}'?`);
                  if (!confirmed) return;
                  await restoreTrashFoldersByNames([trashName]);
                  return;
                }
                if (action === "favorite") {
                  metaToggleFavorite(p);
                  return;
                }
                if (action === "hidden") {
                  metaToggleHidden(p);
                  return;
                }
                if (action === "delete-folder") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Delete requires a writable folder.");
                    return;
                  }
                  const label = displayPath(p) || dirDisplayName(entry.node) || "folder";
                  const confirmed = confirm(`Move folder '${label}' to trash?`);
                  if (!confirmed) return;
                  await moveFolderPathsToTrash([p]);
                  return;
                }
                if (action === "score-up") {
                  metaBumpScore(p, 1);
                  return;
                }
                if (action === "score-down") {
                  metaBumpScore(p, -1);
                  return;
                }
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                RENAME_EDIT_PATH = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitRenameEdit(p, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              commitRenameEdit(p, renameInput);
            });
          }

          const input = row.querySelector(".tagEditInput:not(.renameEditInput)");
          if (input) {
            input.addEventListener("click", (e) => { e.stopPropagation(); });
            input.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                TAG_EDIT_PATH = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const tags = normalizeTagsFromText(input.value || "");
                metaSetUserTags(p, tags);
                return;
              }
            });
            input.addEventListener("blur", () => {
              const tags = normalizeTagsFromText(input.value || "");
              metaSetUserTags(p, tags);
            });
          }
        } else if (entry.kind === "file") {
          const iconEl = row.querySelector(".dirIcon");
          if (iconEl) {
            const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
            const id = String(entry.id || "");
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(id);
            if (canBulk) {
              iconEl.title = sel ? "Deselect file" : "Select file";
              iconEl.style.cursor = "pointer";
              iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!id) return;
                if (WS.view.bulkFileSelectedIds.has(id)) WS.view.bulkFileSelectedIds.delete(id);
                else WS.view.bulkFileSelectedIds.add(id);
                renderDirectoriesPane(true);
              });
            } else {
              iconEl.style.cursor = "default";
            }
          }

          const menuBtn = row.querySelector(".dirMenuBtn");
          if (menuBtn) {
            menuBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              WS.view.bulkActionMenuOpen = false;
              WS.view.dirActionMenuPath = "";
              const id = String(entry.id || "");
              WS.view.fileActionMenuId = (WS.view.fileActionMenuId === id) ? "" : id;
              renderDirectoriesPane(true);
            });
          }

          const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
          if (menuDropdown) {
            menuDropdown.addEventListener("click", (e) => e.stopPropagation());
            const actionButtons = Array.from(menuDropdown.querySelectorAll("button[data-action]"));
            actionButtons.forEach((btn) => {
              btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                WS.view.fileActionMenuId = "";
                if (action === "loose-set-merge") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Loose Set Merge requires a writable folder.");
                    return;
                  }
                  await looseSetMergeSelectedFiles();
                  return;
                }
                if (action === "rename-file") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  RENAME_EDIT_FILE_ID = String(entry.id || "");
                  RENAME_EDIT_PATH = null;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "rename-online-file") {
                  RENAME_EDIT_FILE_ID = String(entry.id || "");
                  RENAME_EDIT_PATH = null;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                RENAME_EDIT_FILE_ID = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitFileRenameEdit(entry.id, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              commitFileRenameEdit(entry.id, renameInput);
            });
          }
        }

        frag.appendChild(row);
      });

      directoriesListEl.appendChild(frag);
      renderDirectoriesActionHeader();

      const shouldCenter = WS.view.pendingDirScroll === "center-selected";
      if (shouldCenter) WS.view.pendingDirScroll = "";

      if (keepScroll && !shouldCenter) {
        directoriesListEl.scrollTop = prevScroll;
        if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
        return;
      }

      const selected = directoriesListEl.querySelector(".dirRow.selected");
      if (selected && shouldCenter) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const selectedRow = directoriesListEl.querySelector(".dirRow.selected");
            if (!selectedRow) return;
            const target = selectedRow.offsetTop - (directoriesListEl.clientHeight / 2) + (selectedRow.offsetHeight / 2);
            const maxScroll = Math.max(0, directoriesListEl.scrollHeight - directoriesListEl.clientHeight);
            WS.view.scrollBusyDirs = true;
            directoriesListEl.scrollTop = Math.max(0, Math.min(maxScroll, target));
            requestAnimationFrame(() => { WS.view.scrollBusyDirs = false; });
          });
        });
      } else if (selected) {
        const r = selected.getBoundingClientRect();
        const c = directoriesListEl.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) selected.scrollIntoView({ block: "nearest" });
      }
      if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
    }

    directoriesListEl.addEventListener("scroll", () => {
      if (WS.view.folderBehavior !== "loop") return;
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;
      if (WS.view.scrollBusyDirs) return;

      const el = directoriesListEl;
      const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
      if (!near) return;

      const baseCount = getOrderedFileIdsForDir(WS.nav.dirNode).length;
      if (!baseCount) return;

      if (WS.view.dirLoopRepeats >= WS.view.loopMaxRepeats) return;

      WS.view.scrollBusyDirs = true;
      WS.view.dirLoopRepeats = Math.min(WS.view.loopMaxRepeats, WS.view.dirLoopRepeats + 2);

      const saved = el.scrollTop;
      rebuildDirectoriesEntries();
      renderDirectoriesPane(true);
      el.scrollTop = saved;

      WS.view.scrollBusyDirs = false;
    });

    if (favoritesBtn) {
      favoritesBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (WS.view.hiddenMode) toggleHiddenMode();
        toggleFavoritesMode();
      });
    }

    if (hiddenBtn) {
      hiddenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (WS.view.favoritesMode) toggleFavoritesMode();
        toggleHiddenMode();
      });
    }

    if (directoriesSelectAllBtn) {
      directoriesSelectAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canUseBulkSelection()) return;
        if (!WS.view.bulkSelectMode) return;
        const visible = Array.from(getVisibleFileIdsInEntries());
        if (!visible.length) return;
        if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
        for (let i = 0; i < visible.length; i++) WS.view.bulkFileSelectedIds.add(String(visible[i] || ""));
        renderDirectoriesPane(true);
      });
    }

    if (dirBackBtn) {
      dirBackBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goDirHistory(-1);
      });
    }

    if (dirForwardBtn) {
      dirForwardBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goDirHistory(1);
      });
    }

    if (dirUpBtn) {
      dirUpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (VIEWER_MODE) {
          hideOverlay();
          return;
        }
        goDirUp();
      });
    }

    function exitBulkSelectModeIfNeeded(target) {
      if (!WS.view.bulkSelectMode) return false;
      if (!target || !target.closest) {
        exitBulkSelectMode();
        return true;
      }
      if (target.closest(".dirRow")) return false;
      if (target.closest(".dirMenu")) return false;
      if (target.closest(".dropdownMenu")) return false;
      if (target.closest("#directoriesActionRow")) return false;
      if (target.closest("#directoriesBulkRow")) return false;
      if (target.closest("#directoriesSearchRow")) return false;
      if (target.closest("#directoriesTagsRow")) return false;
      exitBulkSelectMode();
      return true;
    }

    function exitBulkSelectMode() {
      if (!WS.view.bulkSelectMode) return false;
      WS.view.bulkSelectMode = false;
      clearBulkTagSelection();
      renderDirectoriesPane(true);
      return true;
    }

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (TAG_CONTEXT_MENU_STATE) {
        if (target && target.closest && target.closest("#tagActionMenu")) {
          return;
        }
        closeTagContextMenu();
      }
      if (previewActionMenuEl && previewActionMenuEl.classList.contains("open")) {
        if (target && target.closest && target.closest("#previewActionMenu")) {
          return;
        }
        closePreviewContextMenu();
      }
      if (exitBulkSelectModeIfNeeded(target)) return;
      const hasActionMenu = WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath || WS.view.fileActionMenuId;
      const hasPreviewMenu = !!(previewActionMenuEl && previewActionMenuEl.classList.contains("open"));
      if (!hasActionMenu && !hasPreviewMenu) return;
      if (target && target.closest) {
        if (target.closest(".dirMenu")) return;
        if (target.closest("#directoriesActionRow")) return;
      }
      closeActionMenus();
      renderDirectoriesPane(true);
    });

    if (directoriesSearchInput) {
      directoriesSearchInput.addEventListener("click", (e) => { e.stopPropagation(); });
      const startDirectorySearch = () => {
        if (!WS.root) return;
        const q = String(WS.view.dirSearchQuery || "").trim();
        if (!q) return;

        const keepRoot = WS.view.dirSearchPinned && WS.view.searchRootActive;
        if (!keepRoot) {
          if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
            WS.view.searchRootIsFavorites = true;
            WS.view.searchRootFavorites = getAllFavoriteDirs();
            WS.view.searchRootIsHidden = false;
            WS.view.searchRootHidden = [];
            WS.view.searchRootPath = "";
          } else if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
            WS.view.searchRootIsFavorites = false;
            WS.view.searchRootFavorites = [];
            WS.view.searchRootIsHidden = true;
            WS.view.searchRootHidden = getAllHiddenDirs();
            WS.view.searchRootPath = "";
          } else {
            WS.view.searchRootIsFavorites = false;
            WS.view.searchRootFavorites = [];
            WS.view.searchRootIsHidden = false;
            WS.view.searchRootHidden = [];
            WS.view.searchRootPath = String(WS.nav.dirNode?.path || "");
          }
        }

        WS.view.dirSearchPinned = true;
        WS.view.searchRootActive = true;
        WS.view.searchAnchorPath = "";
        WS.view.searchEntryRootPath = "";
        computeDirectorySearchResults();

        if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = false;

        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();

        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      };

      directoriesSearchInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          startDirectorySearch();
          try { directoriesSearchInput.blur(); } catch {}
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelDirectorySearch();
          directoriesSearchInput.value = "";
          if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;

          TAG_EDIT_PATH = null;
          clearBulkTagPlaceholder();
          syncBulkSelectionForCurrentDir();

          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      });
      directoriesSearchInput.addEventListener("input", () => {
        const val = directoriesSearchInput.value || "";
        WS.view.dirSearchQuery = val;
        if (directoriesSearchClearBtn) {
          const enabled = !!(WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
          directoriesSearchClearBtn.disabled = !enabled;
        }
      });
    }

    if (directoriesSearchClearBtn) {
      directoriesSearchClearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        cancelDirectorySearch();
        if (directoriesSearchInput) directoriesSearchInput.value = "";
        directoriesSearchClearBtn.disabled = true;

        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();

        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      });
    }

    function firstFileEntryIndexForDirEntries() {
      for (let i = 0; i < WS.nav.entries.length; i++) if (WS.nav.entries[i]?.kind === "file") return i;
      return -1;
    }

    function lastFileEntryIndexForDirEntries() {
      for (let i = WS.nav.entries.length - 1; i >= 0; i--) if (WS.nav.entries[i]?.kind === "file") return i;
      return -1;
    }

    function slideStepFileInternal(step) {
      if (!WS.root || !WS.nav.dirNode) return { moved: false, dirChanged: false };
      if (WS.view.folderBehavior !== "slide") return { moved: false, dirChanged: false };
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return { moved: false, dirChanged: false };
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return { moved: false, dirChanged: false };
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return { moved: false, dirChanged: false };

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry || entry.kind !== "file") return { moved: false, dirChanged: false };

      const fileIdxs = [];
      for (let i = 0; i < WS.nav.entries.length; i++) if (WS.nav.entries[i]?.kind === "file") fileIdxs.push(i);
      if (!fileIdxs.length) return { moved: false, dirChanged: false };

      const pos = fileIdxs.indexOf(WS.nav.selectedIndex);
      if (pos === -1) return { moved: false, dirChanged: false };

      const nextPos = pos + step;
      if (nextPos >= 0 && nextPos < fileIdxs.length) {
        WS.nav.selectedIndex = fileIdxs[nextPos];
        syncPreviewToSelection();
        return { moved: true, dirChanged: false };
      }

      if (step > 0) {
        const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
        if (!nextDir) return { moved: false, dirChanged: false };
        WS.nav.dirNode = nextDir;
        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        const idx = firstFileEntryIndexForDirEntries();
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        return { moved: true, dirChanged: true };
      } else {
        const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
        if (!prevDir) return { moved: false, dirChanged: false };
        WS.nav.dirNode = prevDir;
        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        const idx = lastFileEntryIndexForDirEntries();
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        return { moved: true, dirChanged: true };
      }
    }

    function slideMoveFiles(delta) {
      const step = delta > 0 ? 1 : -1;
      let remaining = Math.abs(delta);
      let moved = false;
      let dirChanged = false;

      while (remaining > 0) {
        const r = slideStepFileInternal(step);
        if (!r.moved) break;
        moved = true;
        if (r.dirChanged) dirChanged = true;
        remaining--;
      }

      if (!moved) return;

      renderDirectoriesPane();
      renderPreviewPane(dirChanged);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function canUseFolderJumpActions() {
      if (!WS.root || !WS.nav.dirNode) return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
      return true;
    }

    function jumpToDirectoryFirstFile(dirNode) {
      if (!dirNode) return false;
      WS.nav.dirNode = dirNode;
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      const idx = firstFileEntryIndexForDirEntries();
      if (idx >= 0) WS.nav.selectedIndex = idx;
      else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);

      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return idx >= 0;
    }

    function pickRandomFirstFileJumpTarget(sourceDirNode) {
      if (!sourceDirNode) return null;
      const siblings = getVisibleSiblingDirsForSlide(sourceDirNode);
      const sourcePath = String(sourceDirNode.path || "");
      const eligible = siblings.filter((dir) => {
        if (!dir) return false;
        if (String(dir.path || "") === sourcePath) return false;
        return getOrderedFileIdsForDir(dir).length > 0;
      });
      if (!eligible.length) return null;

      const idx = Math.floor(Math.random() * eligible.length);
      return eligible[idx] || null;
    }

    function jumpToNextFolderFirstFile() {
      if (!canUseFolderJumpActions()) return;
      const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
      if (!nextDir) return;
      jumpToDirectoryFirstFile(nextDir);
    }

    function jumpToPrevFolderFirstFile() {
      if (!canUseFolderJumpActions()) return;
      const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
      if (!prevDir) return;
      jumpToDirectoryFirstFile(prevDir);
    }

    function randomFirstFileJumpFromDirectories() {
      if (!canUseFolderJumpActions()) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      const sourceDir = WS.nav.dirNode;
      const targetDir = pickRandomFirstFileJumpTarget(sourceDir);
      if (!targetDir) {
        showStatusMessage("First File Jump: no matching folder.");
        return false;
      }
      const ok = jumpToDirectoryFirstFile(targetDir);
      if (ok) showStatusMessage("First File Jump");
      else showStatusMessage("First File Jump: no files.");
      return ok;
    }

    /* =========================================================
       Preview Pane
       - inline breadcrumb + counts
       - folder preview shows folder contents
       - file preview shows large in-pane preview (video autoplay)
       ========================================================= */

    function navigateToDirectory(node) {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      if (!node) return;
      if (isTrashVirtualDirNode(node)) {
        showStatusMessage("Use folder menu to restore this trash folder.");
        return;
      }

      if (isViewingTagFolder()) {
        const selectedEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
        const selectedPath = (selectedEntry && selectedEntry.kind === "dir")
          ? (selectedEntry.node?.path || "")
          : (node.path || "");
        pushTagViewContext(selectedPath);
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderOriginPath = "";
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        WS.view.searchRootActive = false;
        WS.view.searchAnchorPath = node.path || "";
        WS.view.searchEntryRootPath = node.path || "";
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = node.path || "";
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = node.path || "";
      }

      WS.nav.dirNode = node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function getPreviewTargetDir() {
      if (WS.preview.kind === "dir" && WS.preview.dirNode) return WS.preview.dirNode;
      if (WS.preview.kind === "file" && WS.preview.fileId) {
        const rec = WS.fileById.get(WS.preview.fileId);
        const p = rec ? (rec.dirPath || "") : "";
        return WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;
      }
      return WS.nav.dirNode || WS.root;
    }

    function getDirectoryItemCount(dirNode) {
      if (!dirNode) return 0;
      const dirs = getChildDirsForNode(dirNode);
      const files = getOrderedFileIdsForDir(dirNode);
      return dirs.length + files.length;
    }

    function getBreadcrumbNodesForDir(dirNode) {
      const nodes = [];
      let cur = dirNode;
      while (cur) { nodes.push(cur); cur = cur.parent; }
      nodes.reverse();
      return nodes;
    }

    function setPreviewBodyMode(mode) {
      if (!previewBodyEl) return;
      previewBodyEl.classList.toggle("preview-file", mode === "file");
      previewBodyEl.classList.toggle("preview-grid", mode !== "file");
    }

    function ensureThumbUrl(rec) {
      if (!rec) return null;
      if (rec.type !== "image") return rec.thumbUrl || null;
      if (rec.online && rec.url) return rec.url;

      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const mode = opt ? String(opt.imageThumbSize || "medium") : "medium";

      if (mode === "high") {
        if (mediaFilterEnabled()) {
          if (rec.thumbUrl && rec.thumbMode === "high") return rec.thumbUrl;
          if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
            try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
            rec.thumbUrl = null;
          }
          rec.thumbMode = null;
          enqueueImageThumb(rec);
          return ensureMediaUrl(rec) || null;
        }
        if (rec.thumbUrl && rec.thumbMode === "high") return rec.thumbUrl;
        if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
          try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
          rec.thumbUrl = null;
        }
        rec.thumbMode = "high";
        try { rec.thumbUrl = URL.createObjectURL(rec.file); return rec.thumbUrl; } catch { return null; }
      }

      if (rec.thumbUrl && rec.thumbMode === mode) return rec.thumbUrl;

      if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
        try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
        rec.thumbUrl = null;
      }
      rec.thumbMode = null;

      enqueueImageThumb(rec);
      return ensureMediaUrl(rec) || null;
    }

    function ensureMediaUrl(rec) {
      if (!rec) return null;
      if (rec.url) return rec.url;
      if (!rec.file) return null;
      try { rec.url = URL.createObjectURL(rec.file); return rec.url; } catch { return null; }
    }

    function getVideoPosterForRecord(rec) {
      if (rec && rec.videoThumbUrl) return rec.videoThumbUrl;
      return BLACK_POSTER_URL;
    }

    function applyVideoPoster(videoEl, rec) {
      if (!videoEl) return;
      const poster = getVideoPosterForRecord(rec);
      if (videoEl.poster !== poster) videoEl.poster = poster;
    }

    function preloadMediaRecord(rec, aggressive) {
      if (!rec) return;
      const url = ensureMediaUrl(rec);
      if (!url) return;
      if (PRELOAD_CACHE.has(url)) return;
      if (rec.type === "image") {
        const img = new Image();
        img.src = url;
        PRELOAD_CACHE.set(url, img);
        return;
      }
      const vid = document.createElement("video");
      vid.preload = aggressive ? "auto" : "metadata";
      vid.muted = true;
      normalizeVideoPlaybackRate(vid);
      vid.playsInline = true;
      vid.src = url;
      try { if (aggressive) vid.load(); } catch {}
      PRELOAD_CACHE.set(url, vid);
    }

    function preloadNextMedia(items, startIdx) {
      const mode = preloadMode();
      if (mode === "off") return;
      if (!Array.isArray(items) || !items.length) return;
      const aggressive = (mode === "ultra");
      const count = aggressive ? 3 : 1;
      let idx = startIdx;
      let found = 0;
      let guard = 0;
      while (found < count && guard < items.length * 2) {
        idx = (idx + 1) % items.length;
        const it = items[idx];
        if (it && !it.isFolder) {
          const rec = WS.fileById.get(it.id);
          if (rec) {
            preloadMediaRecord(rec, aggressive);
            found++;
          }
        }
        guard++;
      }
    }

    function ensurePreviewFileElements() {
      if (!previewViewportBox) {
        previewViewportBox = document.createElement("div");
        previewViewportBox.id = "filePreviewViewport";
      }
      if (!previewImgEl) {
        previewImgEl = document.createElement("img");
        previewImgEl.style.display = "none";
        previewImgEl.onload = () => {
          previewImgEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };
        previewViewportBox.appendChild(previewImgEl);
      }
      if (!previewVideoEl) {
        previewVideoEl = document.createElement("video");
        previewVideoEl.controls = true;
        previewVideoEl.preload = "metadata";
        previewVideoEl.playsInline = true;
        previewVideoEl.autoplay = true;
        previewVideoEl.muted = false;
        normalizeVideoPlaybackRate(previewVideoEl);
        previewVideoEl.poster = BLACK_POSTER_URL;
        previewVideoEl.style.display = "none";
        previewViewportBox.appendChild(previewVideoEl);
      }
      if (!previewFolderEl) {
        previewFolderEl = document.createElement("div");
        previewFolderEl.style.display = "none";
        previewViewportBox.appendChild(previewFolderEl);
      }
    }

    function ensureViewerFromPreviewFileId(fileId) {
      if (!WS.root || !fileId) return;
      const rec = WS.fileById.get(fileId);
      if (!rec) return;

      const p = rec ? (rec.dirPath || "") : "";
      const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;

      viewerDirNode = dn;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      let idx = 0;
      const found = viewerItems.findIndex(it => !it.isFolder && it.id === fileId);
      if (found >= 0) idx = found;
      viewerIndex = idx;
    }

    function previewVideoMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.videoPreview || "muted") : "muted";
    }

    function galleryVideoMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.videoGallery || "muted") : "muted";
    }

    function videoSkipStepSeconds() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const raw = opt ? String(opt.videoSkipStep || "10") : "10";
      const v = parseInt(raw, 10);
      return Number.isFinite(v) ? v : 10;
    }

    function videoEndBehavior() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.videoEndBehavior || "loop") : "loop";
    }

    function slideshowBehavior() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.slideshowDefault || "cycle") : "cycle";
    }

    function preloadMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.preloadNextMode || "off") : "off";
    }

    function previewDisplayMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.previewMode || "grid") : "grid";
    }

    function renderPreviewViewerItem(idx) {
      ensurePreviewFileElements();

      if (!viewerItems.length) {
        if (previewImgEl) previewImgEl.style.display = "none";
        if (previewVideoEl) previewVideoEl.style.display = "none";
        if (previewFolderEl) previewFolderEl.style.display = "none";
        MediaFilterEngine.detach("preview");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        return;
      }

      const n = viewerItems.length;
      let i = idx;
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      viewerIndex = i;

      const item = viewerItems[viewerIndex];

      let willShowVideo = false;
      let rec = null;
      if (item && !item.isFolder) {
        rec = WS.fileById.get(item.id);
        if (rec && rec.type === "video") willShowVideo = true;
      }

      if (previewVideoEl) {
        try { previewVideoEl.pause(); } catch {}
        previewVideoEl.classList.remove("ready");
        if (!willShowVideo) previewVideoEl.style.display = "none";
      }
      if (previewImgEl) {
        previewImgEl.classList.remove("ready");
        previewImgEl.style.display = "none";
      }
      if (previewFolderEl) previewFolderEl.style.display = "none";
      MediaFilterEngine.detach("preview");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");

      if (!item) return;

      if (item.isFolder) {
        previewFolderEl.style.display = "flex";
        previewFolderEl.style.flexDirection = "column";
        previewFolderEl.style.alignItems = "center";
        previewFolderEl.style.justifyContent = "center";
        previewFolderEl.style.minWidth = "200px";
        previewFolderEl.style.maxWidth = "80%";
        previewFolderEl.style.padding = "24px 32px";
        previewFolderEl.style.borderRadius = "4px";
        previewFolderEl.style.background = "var(--color1-secondary)";
        previewFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

        previewFolderEl.innerHTML = "";

        const icon = document.createElement("div");
        icon.style.fontSize = "56px";
        icon.style.marginBottom = "12px";
        icon.textContent = "📁";

        const name = document.createElement("div");
        name.style.fontSize = "14px";
        name.style.color = "var(--color0-primary)";
        name.style.textAlign = "center";
        name.style.whiteSpace = "nowrap";
        name.style.overflow = "hidden";
        name.style.textOverflow = "ellipsis";
        name.textContent = dirDisplayName(item.dirNode) || "Folder";

        previewFolderEl.appendChild(icon);
        previewFolderEl.appendChild(name);
        return;
      }

      if (!rec) return;

      if (rec.type === "video") {
        const mode = previewVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE && !VIEWER_MODE;
        if (!VIEWER_MODE && viewerVideoEl) { try { viewerVideoEl.pause(); } catch {} }
        normalizeVideoPlaybackRate(previewVideoEl);
        previewVideoEl.autoplay = doAuto;
        previewVideoEl.onloadeddata = null;
        previewVideoEl.onended = null;
        previewVideoEl.muted = (mode === "muted") || BANIC_ACTIVE || VIEWER_MODE;
        const endBehavior = videoEndBehavior();
        if (WS.view.slideshowActive) {
          previewVideoEl.loop = false;
          previewVideoEl.onended = () => { if (WS.view.slideshowActive) viewerStep(1); };
        } else if (endBehavior === "loop") {
          previewVideoEl.loop = true;
        } else if (endBehavior === "next") {
          previewVideoEl.loop = false;
          previewVideoEl.onended = () => { if (!WS.view.slideshowActive) viewerStep(1); };
        } else {
          previewVideoEl.loop = false;
        }
        previewVideoEl.onloadeddata = () => {
          previewVideoEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };

        applyVideoPoster(previewVideoEl, rec);
        const src = ensureMediaUrl(rec) || "";
        const same = previewVideoEl.src === src;
        if (!same) {
          previewVideoEl.src = src;
        }
        previewVideoEl.style.display = "block";
        syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video");

        applyVideoCarryToElement(previewVideoEl, rec.id);

        if (previewVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { previewVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { previewVideoEl.play(); } catch {} }
        else { try { previewVideoEl.pause(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      previewImgEl.onload = () => {
        previewImgEl.classList.add("ready");
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = previewImgEl.src === src;
      if (!same) previewImgEl.src = src;
      previewImgEl.style.display = "block";
      syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image");

      if (previewImgEl.complete && previewImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => { previewImgEl.classList.add("ready"); });
      }
      preloadNextMedia(viewerItems, viewerIndex);
    }

    function syncDirectoriesToViewerState() {
      if (!WS.root) return;
      if (!viewerDirNode) return;
      if (!viewerItems.length) return;

      WS.nav.dirNode = viewerDirNode;
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      const item = viewerItems[viewerIndex] || null;

      let idx = 0;
      if (item) {
        if (item.isFolder) {
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const e = WS.nav.entries[i];
            if (e && e.kind === "dir" && e.node === item.dirNode) { idx = i; break; }
          }
        } else {
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const e = WS.nav.entries[i];
            if (e && e.kind === "file" && e.id === item.id) { idx = i; break; }
          }
        }
      }

      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();

      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function renderPreviewPane(animate = false, keepScroll = false) {
      const prevScroll = keepScroll ? previewBodyEl.scrollTop : 0;

      if (!WS.root || !WS.nav.dirNode) {
        previewBodyEl.innerHTML = "";
        setPreviewBodyMode("grid");
        updateModePill();
        if (itemsPill) itemsPill.textContent = "Items: —";
        previewBodyEl.innerHTML = "";
        return;
      }

      const targetDir = getPreviewTargetDir();
      updateModePill();
      const currentDirCount = getDirectoryItemCount(WS.nav.dirNode || WS.root);
      if (itemsPill) itemsPill.textContent = `Items: ${currentDirCount}`;

      if (WS.preview.kind === "file" && WS.preview.fileId) {
        setPreviewBodyMode("file");
        const rec = WS.fileById.get(WS.preview.fileId);
        if (!rec) {
          previewBodyEl.innerHTML = "";
          previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">File not found.</div>`;
          MediaFilterEngine.detach("preview");
          if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
          if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
          return;
        }

        ensurePreviewFileElements();

        if (previewBodyEl.firstChild !== previewViewportBox || previewBodyEl.childNodes.length !== 1) {
          previewBodyEl.innerHTML = "";
          previewBodyEl.appendChild(previewViewportBox);
        }

        ensureViewerFromPreviewFileId(rec.id);
        if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "preview";
        renderPreviewViewerItem(viewerIndex);

        if (keepScroll) previewBodyEl.scrollTop = prevScroll;
        return;
      }

      setPreviewBodyMode("grid");
      if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
      MediaFilterEngine.detach("preview");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");

      previewBodyEl.innerHTML = "";

      const dirNode = targetDir;
      if (!dirNode) {
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">No preview.</div>`;
        return;
      }

      if (previewDisplayMode() === "expanded") {
        renderExpandedPreviewPane(dirNode, animate, keepScroll, prevScroll);
        preloadOnlineMediaForDir(dirNode);
        return;
      }

      renderFolderContents(dirNode, previewBodyEl, animate);

      if (animate) {
        requestAnimationFrame(() => {
          const cards = previewBodyEl.querySelectorAll(".fileCard.enter");
          cards.forEach(c => c.classList.remove("enter"));
        });
      }

      if (keepScroll) previewBodyEl.scrollTop = prevScroll;
      preloadOnlineMediaForDir(dirNode);
    }

    previewBodyEl.addEventListener("scroll", () => {
      if (WS.view.folderBehavior !== "loop") return;
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.preview.kind === "file") return;
      if (DIR_FILE_DRAG.id) return;
      if (WS.view.scrollBusyPreview) return;

      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const baseCount = getOrderedFileIdsForDir(dirNode).length;
      if (!baseCount) return;

      const el = previewBodyEl;
      const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
      if (!near) return;

      if (WS.view.previewLoopRepeats >= WS.view.loopMaxRepeats) return;

      WS.view.scrollBusyPreview = true;
      WS.view.previewLoopRepeats = Math.min(WS.view.loopMaxRepeats, WS.view.previewLoopRepeats + 2);

      const saved = el.scrollTop;
      renderPreviewPane(false, true);
      el.scrollTop = saved;

      WS.view.scrollBusyPreview = false;
    });

    previewBodyEl.addEventListener("contextmenu", (e) => {
      const target = e.target;
      if (target && target.closest) {
        if (target.closest(".fileCard")) return;
        if (target.closest(".folderCard")) return;
        if (target.closest("#filePreviewViewport")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      openPreviewContextMenu(e.clientX, e.clientY);
    });


    function makeSpacer() {
      const sp = document.createElement("div");
      sp.className = "previewSectionSpacer";
      return sp;
    }

    function makeFolderPreviewCard(dirNode) {
      const card = document.createElement("div");
      card.className = "folderCard";
      card.style.cursor = "pointer";
      const icon = dirNode && dirNode.onlineMeta
        ? buildOnlineSourceIconHtml(dirNode, {
          className: "onlineSourceIcon",
          imgClassName: "onlineSourceIconImg onlineFolderCardIcon",
          fallbackClassName: "onlineSourceIconFallback onlineFolderCardIconFallback",
          title: "Online folder"
        })
        : "📁";
      const nm = dirDisplayName(dirNode) || "folder";
      const sc = metaGetScore(dirNode?.path || "");
      const scoreMode = folderScoreDisplayMode();
      const showPreviewFolderItemCount = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFolderItemCount === false);
      const voteSeg = scoreMode !== "hidden" ? `
          <div class="voteBox">
            ${scoreMode === "show" ? `<div class="voteBtn up">▲</div>` : ""}
            <div class="voteScore">${sc}</div>
            ${scoreMode === "show" ? `<div class="voteBtn down">▼</div>` : ""}
          </div>
          ` : ``;
      const countSeg = showPreviewFolderItemCount ? `<div class="meta">${dirItemCount(dirNode)} items</div>` : ``;
      card.innerHTML = `
        <div class="left">
          <div class="icon">${icon}</div>
          <div class="name" title="${escapeHtml(nm)}">${escapeHtml(nm)}</div>
        </div>
        <div class="folderRight">
          ${voteSeg}
          ${countSeg}
        </div>
      `;
      const up = card.querySelector(".voteBtn.up");
      const down = card.querySelector(".voteBtn.down");
      if (up) up.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", 1); });
      if (down) down.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", -1); });

      card.addEventListener("click", () => {
        navigateToDirectory(dirNode);
      });
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openDirMenuForPath(dirNode?.path || "");
      });
      return card;
    }

    function renderFilesGrid(ids, container, animate, dirNode) {
      const LIMIT = 800;
      if (!ids.length) return 0;

      const grid = document.createElement("div");
      grid.className = "gridFiles";
      if (dirNode && canReorderFilesInPreviewDir(dirNode)) setupPreviewGridDrag(grid);
      const frag = document.createDocumentFragment();

      let rendered = 0;
      for (let i = 0; i < ids.length && rendered < LIMIT; i++) {
        const id = ids[i];
        const rec = WS.fileById.get(id);
        if (!rec) continue;

        const card = makePreviewFileCard(rec, animate, dirNode, ids);
        frag.appendChild(card);
        rendered++;
      }

      grid.appendChild(frag);
      container.appendChild(grid);
      return rendered;
    }

    function renderFolderContents(dirNode, container, animate) {
      const folders = getChildDirsForNode(dirNode);
      let hasContent = false;

      if (folders.length) {
        const gridF = document.createElement("div");
        gridF.className = "gridFolders";
        const fragF = document.createDocumentFragment();

        for (const d of folders) {
          fragF.appendChild(makeFolderPreviewCard(d));
        }

        gridF.appendChild(fragF);
        container.appendChild(gridF);
        container.appendChild(makeSpacer());
        hasContent = true;
      }

      const ids = getOrderedFileIdsForDir(dirNode);
      if (ids.length) {
        renderFilesGrid(ids, container, animate, dirNode);
        hasContent = true;
      }

      if (!hasContent) {
        const empty = document.createElement("div");
        empty.className = "label";
        empty.style.padding = "10px";
        empty.textContent = "Empty folder.";
        container.appendChild(empty);
      }

      return {
        folderCount: folders.length,
        fileCount: ids.length,
        hasContent
      };
    }

    function renderExpandedPreviewPane(dirNode, animate, keepScroll, prevScroll) {
      previewBodyEl.innerHTML = "";

      const baseDirs = getChildDirsForNode(dirNode);
      const baseFiles = getOrderedFileIdsForDir(dirNode);
      const targetPath = WS.preview.kind === "dir" && WS.preview.dirNode ? String(WS.preview.dirNode.path || "") : "";

      let hasAny = false;
      let scrollTarget = null;

      const makeSection = (title, metaText, path) => {
        const section = document.createElement("div");
        section.className = "expandedSection";
        if (path) section.dataset.path = path;

        const bar = document.createElement("div");
        bar.className = "expandedBar";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = title;

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = metaText;

        bar.appendChild(name);
        bar.appendChild(meta);
        section.appendChild(bar);
        return section;
      };

      if (baseFiles.length) {
        const section = makeSection("Files in this folder", `${baseFiles.length} files`, "");
        renderFilesGrid(baseFiles, section, animate, dirNode);
        previewBodyEl.appendChild(section);
        hasAny = true;
      }

      for (const child of baseDirs) {
        const nm = dirDisplayName(child) || "folder";
        const childFolders = getChildDirsForNode(child).length;
        const childFiles = getOrderedFileIdsForDir(child).length;
        const total = childFolders + childFiles;
        const section = makeSection(nm, `${total} items`, child.path || "");
        renderFolderContents(child, section, animate);
        previewBodyEl.appendChild(section);
        hasAny = true;
        if (targetPath && String(child.path || "") === targetPath) scrollTarget = section;
      }

      if (!hasAny) {
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">Empty folder.</div>`;
        return;
      }

      if (animate) {
        requestAnimationFrame(() => {
          const cards = previewBodyEl.querySelectorAll(".fileCard.enter");
          cards.forEach(c => c.classList.remove("enter"));
        });
      }

      if (keepScroll) {
        previewBodyEl.scrollTop = prevScroll;
      } else if (scrollTarget) {
        previewBodyEl.scrollTop = scrollTarget.offsetTop;
      }
    }

    function canReorderFilesInPreviewDir(dirNode) {
      const target = getPreviewTargetDir();
      if (!target || !dirNode) return false;
      if (String(target.path || "") !== String(dirNode.path || "")) return false;
      return canReorderFilesInDir(dirNode);
    }

    const PREVIEW_DRAG_STATE = {
      placeholder: null,
      grid: null,
      draggedId: null,
      draggedCard: null,
      dirNode: null,
      visibleIds: null,
      raf: 0,
      lastX: 0,
      lastY: 0,
      pendingHide: false
    };

    function ensurePreviewDragPlaceholder(card) {
      if (!PREVIEW_DRAG_STATE.placeholder) {
        const ph = document.createElement("div");
        ph.className = "fileCard drag-placeholder";
        ph.setAttribute("aria-hidden", "true");
        PREVIEW_DRAG_STATE.placeholder = ph;
      }
      const rect = card.getBoundingClientRect();
      const ph = PREVIEW_DRAG_STATE.placeholder;
      ph.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      ph.style.height = `${Math.max(1, Math.round(rect.height))}px`;
      return ph;
    }

    function placePreviewDragPlaceholder(card) {
      const grid = card.parentElement;
      if (!grid) return;
      const ph = ensurePreviewDragPlaceholder(card);
      if (ph.parentElement && ph.parentElement !== grid) {
        ph.parentElement.removeChild(ph);
      }
      PREVIEW_DRAG_STATE.grid = grid;
      if (card !== ph) grid.insertBefore(ph, card);
    }

    function clearPreviewDragPlaceholder() {
      const ph = PREVIEW_DRAG_STATE.placeholder;
      if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
      PREVIEW_DRAG_STATE.grid = null;
    }

    function getPreviewGridCards(grid) {
      if (!grid) return [];
      return Array.from(grid.querySelectorAll(".fileCard"))
        .filter(card => !card.classList.contains("drag-placeholder") && !card.classList.contains("drag-hidden"));
    }

    function updatePreviewPlaceholderFromPoint(grid, x, y) {
      const cards = getPreviewGridCards(grid);
      if (!cards.length) {
        const ph = PREVIEW_DRAG_STATE.placeholder;
        if (ph && ph.parentElement !== grid) grid.appendChild(ph);
        return;
      }
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const rowMid = rect.top + rect.height / 2;
        if (y < rowMid) {
          placePreviewDragPlaceholder(card);
          return;
        }
        if (y >= rect.top && y <= rect.bottom) {
          const colMid = rect.left + rect.width / 2;
          if (x < colMid) {
            placePreviewDragPlaceholder(card);
            return;
          }
        }
      }
      const ph = PREVIEW_DRAG_STATE.placeholder;
      if (ph && ph.parentElement !== grid) grid.appendChild(ph);
    }

    function schedulePreviewDragUpdate(grid, x, y) {
      PREVIEW_DRAG_STATE.lastX = x;
      PREVIEW_DRAG_STATE.lastY = y;
      if (PREVIEW_DRAG_STATE.raf) return;
      PREVIEW_DRAG_STATE.raf = requestAnimationFrame(() => {
        PREVIEW_DRAG_STATE.raf = 0;
        updatePreviewPlaceholderFromPoint(grid, PREVIEW_DRAG_STATE.lastX, PREVIEW_DRAG_STATE.lastY);
      });
    }

    function beginPreviewDrag(card, dragDir, visibleIds) {
      PREVIEW_DRAG_STATE.draggedCard = card;
      PREVIEW_DRAG_STATE.draggedId = String(card?.dataset?.fileId || "");
      PREVIEW_DRAG_STATE.dirNode = dragDir;
      PREVIEW_DRAG_STATE.visibleIds = Array.isArray(visibleIds) ? visibleIds.slice() : null;
      const grid = card?.parentElement || null;
      PREVIEW_DRAG_STATE.grid = grid;
      PREVIEW_DRAG_STATE.pendingHide = true;
    }

    function finishPreviewDrag() {
      if (PREVIEW_DRAG_STATE.raf) {
        cancelAnimationFrame(PREVIEW_DRAG_STATE.raf);
        PREVIEW_DRAG_STATE.raf = 0;
      }
      const card = PREVIEW_DRAG_STATE.draggedCard;
      if (card) card.classList.remove("drag-hidden");
      PREVIEW_DRAG_STATE.draggedCard = null;
      PREVIEW_DRAG_STATE.draggedId = null;
      PREVIEW_DRAG_STATE.dirNode = null;
      PREVIEW_DRAG_STATE.visibleIds = null;
      PREVIEW_DRAG_STATE.pendingHide = false;
      clearPreviewDragPlaceholder();
    }

    function ensurePreviewDragHidden() {
      if (!PREVIEW_DRAG_STATE.pendingHide) return;
      const card = PREVIEW_DRAG_STATE.draggedCard;
      const grid = PREVIEW_DRAG_STATE.grid || card?.parentElement || null;
      if (!card || !grid) return;
      PREVIEW_DRAG_STATE.pendingHide = false;
      placePreviewDragPlaceholder(card);
      card.classList.add("drag-hidden");
    }

    function setupPreviewGridDrag(grid) {
      if (!grid || grid.dataset.previewDragBound === "1") return;
      grid.dataset.previewDragBound = "1";

      grid.addEventListener("dragover", (e) => {
        if (!PREVIEW_DRAG_STATE.draggedId) return;
        if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
        e.preventDefault();
        ensurePreviewDragHidden();
        schedulePreviewDragUpdate(grid, e.clientX, e.clientY);
      });

      grid.addEventListener("drop", (e) => {
        if (!PREVIEW_DRAG_STATE.draggedId) return;
        if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
        e.preventDefault();
        e.stopPropagation();
        const dirNode = PREVIEW_DRAG_STATE.dirNode;
        const dragId = PREVIEW_DRAG_STATE.draggedId;
        const ids = PREVIEW_DRAG_STATE.visibleIds || (dirNode ? getOrderedFileIdsForDir(dirNode) : []);
        const list = ids.filter(id => String(id || "") !== String(dragId));
        const children = Array.from(grid.children);
        let insertIdx = 0;
        for (const child of children) {
          if (child === PREVIEW_DRAG_STATE.placeholder) break;
          if (child.classList && child.classList.contains("fileCard")
            && !child.classList.contains("drag-hidden")
            && !child.classList.contains("drag-placeholder")) {
            insertIdx++;
          }
        }
        insertIdx = Math.max(0, Math.min(list.length, insertIdx));
        let targetId = null;
        let placeAfter = false;
        if (list.length) {
          if (insertIdx >= list.length) {
            targetId = list[list.length - 1];
            placeAfter = true;
          } else {
            targetId = list[insertIdx];
            placeAfter = false;
          }
        }
        if (dirNode && targetId) {
          const moved = reorderFilesInDir(dirNode, dragId, targetId, placeAfter, { visibleIds: ids });
          if (moved) syncAfterDirOrderChange(null, { preserveSelection: true });
        }
        DIR_FILE_DRAG.id = null;
        DIR_FILE_DRAG.dirPath = null;
        finishPreviewDrag();
      });
    }

    function makePreviewFileCard(rec, animate, dirNode, visibleIds) {
      const card = document.createElement("div");
      card.className = "fileCard";
      card.style.cursor = "pointer";
      if (animate) card.classList.add("enter");

      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = "lazy";
      img.draggable = false;
      img.alt = fileDisplayNameForRecord(rec) || "";

      if (rec.type === "image") {
        img.src = ensureThumbUrl(rec) || "";
      } else {
        img.src = rec.videoThumbUrl || "";
        if (!img.src) img.style.objectFit = "contain";
      }

      const showPreviewFileTypeLabel = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFileTypeLabel === false);
      const showPreviewFileName = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFileName === false);
      const showAnyMeta = showPreviewFileTypeLabel || showPreviewFileName;
      let meta = null;
      if (showAnyMeta) {
        meta = document.createElement("div");
        meta.className = (showPreviewFileTypeLabel && showPreviewFileName) ? "metaBlock" : "metaBlock compact";

        if (showPreviewFileName) {
          const top = document.createElement("div");
          top.className = "topLine";

          const name = document.createElement("div");
          name.className = "name";
          name.textContent = fileDisplayNameForRecord(rec) || "—";
          name.title = relPathDisplayName(rec.relPath || rec.name || "");

          top.appendChild(name);
          meta.appendChild(top);
        }

        if (showPreviewFileTypeLabel) {
          const mini = document.createElement("div");
          mini.className = "mini";
          mini.textContent = rec.type === "video" ? "video" : "image";
          meta.appendChild(mini);
        }
      }

      card.appendChild(img);
      if (meta) card.appendChild(meta);

      const fileId = String(rec.id || "");
      if (fileId) card.dataset.fileId = fileId;
      const dragDir = dirNode || WS.dirByPath.get(rec.dirPath || "") || null;
      if (fileId && dragDir && canReorderFilesInPreviewDir(dragDir)) {
        const handleDragStart = (e) => {
          if (!canReorderFilesInPreviewDir(dragDir) || WS.view.bulkSelectMode) {
            e.preventDefault();
            return;
          }
          DIR_FILE_DRAG.id = fileId;
          DIR_FILE_DRAG.dirPath = String(dragDir.path || "");
          card.classList.add("dragging");
          beginPreviewDrag(card, dragDir, visibleIds);
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", fileId); } catch {}
            try {
              const rect = card.getBoundingClientRect();
              e.dataTransfer.setDragImage(card, rect.width / 2, rect.height / 2);
            } catch {}
          }
        };
        const handleDragEnd = () => {
          DIR_FILE_DRAG.id = null;
          DIR_FILE_DRAG.dirPath = null;
          card.classList.remove("dragging");
          finishPreviewDrag();
        };
        const setupDragSource = (el) => {
          if (!el) return;
          el.draggable = true;
          el.addEventListener("dragstart", handleDragStart);
          el.addEventListener("dragend", handleDragEnd);
        };
        setupDragSource(card);
        setupDragSource(img);
        setupDragSource(meta);
      }

      card.addEventListener("click", () => {
        if (!WS.root) return;

        const p = rec.dirPath || "";
        const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;

        if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
          WS.view.searchRootActive = false;
          WS.view.searchAnchorPath = dn.path || "";
          WS.view.searchEntryRootPath = dn.path || "";
        }

        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.favoritesRootActive = false;
          WS.view.favoritesAnchorPath = dn.path || "";
        }

        if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.hiddenRootActive = false;
          WS.view.hiddenAnchorPath = dn.path || "";
        }

        WS.nav.dirNode = dn;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();

        let idx = 0;
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e = WS.nav.entries[i];
          if (e && e.kind === "file" && e.id === rec.id) { idx = i; break; }
        }
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();

        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      });

      return card;
    }

    /* =========================================================
       Video thumbnails (lazy, low quality) for Preview Pane
       ========================================================= */

    function enqueueVideoThumb(rec) {
      if (!rec) return;
      if (rec.online) return;
      WS.videoThumbQueue.push(rec.id);
    }

    function getPreviewFileIdsForDir(dirNode, includeChildren = false) {
      if (!dirNode) return [];
      const ids = dirNode.childrenFiles.slice();
      if (!dirNode.preserveOrder) ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      const out = ids.filter(id => passesFilter(WS.fileById.get(id)));

      if (!includeChildren) return out;

      for (const child of getChildDirsForNode(dirNode)) {
        const childIds = getPreviewFileIdsForDir(child, false);
        for (const id of childIds) out.push(id);
      }

      return out;
    }

    function kickVideoThumbsForPreview() {
      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const includeChildren = previewDisplayMode() === "expanded" && WS.preview.kind !== "file";
      const ids = getPreviewFileIdsForDir(dirNode, includeChildren);
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;
        enqueueVideoThumb(rec);
      }
      drainVideoThumbQueue();
    }

    async function drainVideoThumbQueue() {
      if (WS.videoThumbActive >= 4) return;
      while (WS.videoThumbActive < 4 && WS.videoThumbQueue.length) {
        const id = WS.videoThumbQueue.shift();
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;

        WS.videoThumbActive++;
        generateVideoThumb(rec).catch(() => {}).finally(() => {
          WS.videoThumbActive--;
          renderPreviewPane(false);
          drainVideoThumbQueue();
        });
      }
    }

    async function generateVideoThumb(rec) {
      const url = ensureMediaUrl(rec);
      if (!url) return;

      const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
      if (rec.videoThumbUrl) {
        try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
        rec.videoThumbUrl = null;
      }
      rec.videoThumbMode = mode;

      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      normalizeVideoPlaybackRate(v);
      v.playsInline = true;
      v.src = url;
      v.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        const onMeta = () => resolve();
        const onErr = () => reject(new Error("video load failed"));
        v.addEventListener("loadedmetadata", onMeta, { once: true });
        v.addEventListener("error", onErr, { once: true });
      });

      const t = Math.min(0.25, Math.max(0, (v.duration || 0) * 0.10));
      try { v.currentTime = isFinite(t) ? t : 0; } catch {}

      await new Promise((resolve) => {
        const done = () => resolve();
        v.addEventListener("seeked", done, { once: true });
        setTimeout(done, 350);
      });

      const w = videoThumbWidthForOption();
      const ar = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (4/3);
      const h = Math.max(120, Math.round(w / ar));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      renderFilteredToCanvas(ctx, v, v.videoWidth || w, v.videoHeight || h, w, h, getMediaFilterForType(), true);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", mode === "high" ? 0.75 : 0.6));
      if (!blob) return;

      rec.videoThumbUrl = URL.createObjectURL(blob);
    }

    /* =========================================================
       Image thumbnails (lazy) for Preview Pane
       ========================================================= */

    function enqueueImageThumb(rec) {
      if (!rec) return;
      if (rec.type !== "image") return;
      if (rec.online) return;
      WS.imageThumbQueue.push(rec.id);
      drainImageThumbQueue();
    }

    async function drainImageThumbQueue() {
      if (WS.imageThumbActive >= 4) return;
      while (WS.imageThumbActive < 4 && WS.imageThumbQueue.length) {
        const id = WS.imageThumbQueue.shift();
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "image") continue;

        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
        if (mode === "high" && !thumbFiltersActive()) continue;
        if (rec.thumbUrl && rec.thumbMode === mode) continue;

        WS.imageThumbActive++;
        generateImageThumb(rec).catch(() => {}).finally(() => {
          WS.imageThumbActive--;
          renderPreviewPane(false);
          drainImageThumbQueue();
        });
      }
    }

    async function generateImageThumb(rec) {
      const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
      if (mode === "high" && !thumbFiltersActive()) {
        rec.thumbMode = "high";
        return;
      }

      if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
        try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
        rec.thumbUrl = null;
      }

      const w = imageThumbWidthForOption();
      const file = rec.file;
      if (!file) return;

      let bmp = null;
      try { bmp = await createImageBitmap(file); } catch { bmp = null; }
      if (!bmp) return;

      const ar = (bmp.width && bmp.height) ? (bmp.width / bmp.height) : (4/3);
      const h = Math.max(120, Math.round(w / ar));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      renderFilteredToCanvas(ctx, bmp, bmp.width || w, bmp.height || h, w, h, getMediaFilterForType(), true);

      try { bmp.close(); } catch {}

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", mode === "high" ? 0.85 : (mode === "medium" ? 0.75 : 0.65)));
      if (!blob) return;

      rec.thumbUrl = URL.createObjectURL(blob);
      rec.thumbMode = mode;
    }

    function kickImageThumbsForPreview() {
      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const ids = getPreviewFileIdsForDir(dirNode);
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "image") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
        if (mode === "high") continue;
        if (rec.thumbUrl && rec.thumbMode === mode) continue;
        enqueueImageThumb(rec);
      }
    }

    /* =========================================================
       Gallery Mode (Overlay)
       - Rotated control model:
         Up/Down = previous/next item
         Left/Right = leave/enter directory
       - Nav buttons now represent Left/Right directory actions
       ========================================================= */

    function buildViewerItemsForDir(dirNode) {
      const items = [];
      if (!dirNode) return items;

      const dirs = getChildDirsForNode(dirNode);
      for (const d of dirs) items.push({ isFolder: true, dirNode: d });

      const ids = getOrderedFileIdsForDir(dirNode);
      for (const id of ids) items.push({ isFolder: false, id });

      return items;
    }

    function pausePreviewVideoForOverlay() {
      PREVIEW_VIDEO_PAUSE.active = false;
      PREVIEW_VIDEO_PAUSE.fileId = null;
      PREVIEW_VIDEO_PAUSE.time = 0;
      PREVIEW_VIDEO_PAUSE.wasPlaying = false;

      if (WS.preview.kind !== "file" || !WS.preview.fileId) return;
      const rec = WS.fileById.get(WS.preview.fileId);
      if (!rec || rec.type !== "video") return;
      if (!previewVideoEl || previewVideoEl.style.display === "none") return;

      try {
        VIDEO_CARRY.active = true;
        VIDEO_CARRY.fileId = rec.id;
        VIDEO_CARRY.time = previewVideoEl.currentTime || 0;
        VIDEO_CARRY.wasPlaying = !previewVideoEl.paused;
        previewVideoEl.pause();
      } catch {}
    }

    function resumePreviewVideoAfterOverlay() {
      if (!VIDEO_CARRY.active) return;
      if (!previewVideoEl || previewVideoEl.style.display === "none") return;
      applyVideoCarryToElement(previewVideoEl, VIDEO_CARRY.fileId || "");
    }

    function openGalleryForDir(dirNode, startId = null, requestFullscreen = false) {
      viewerDirNode = dirNode;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      if (!viewerItems.length) return;

      let idx = 0;
      if (startId) {
        const found = viewerItems.findIndex(it => !it.isFolder && it.id === startId);
        if (found >= 0) idx = found;
      }
      viewerIndex = idx;

      showOverlay();
      if (requestFullscreen) enterFullscreenIfPossible();
    }

    function openGalleryFromDirectoriesSelection(requestFullscreen) {
      if (!WS.nav.entries.length) return;
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;

      if (entry.kind === "dir") {
        if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
          WS.view.searchRootActive = false;
          WS.view.searchAnchorPath = entry.node?.path || "";
          WS.view.searchEntryRootPath = entry.node?.path || "";
        }
        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.favoritesRootActive = false;
          WS.view.favoritesAnchorPath = entry.node?.path || "";
        }
        if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.hiddenRootActive = false;
          WS.view.hiddenAnchorPath = entry.node?.path || "";
        }
        openGalleryForDir(entry.node, null, requestFullscreen);
      } else if (entry.kind === "file") {
        const rec = WS.fileById.get(entry.id);
        const p = rec ? (rec.dirPath || "") : (WS.nav.dirNode?.path || "");
        const dn = WS.dirByPath.get(p) || WS.nav.dirNode;
        openGalleryForDir(dn, entry.id, requestFullscreen);
      }
    }

    function openGalleryFromViewerState(requestFullscreen) {
      if (!viewerDirNode || !viewerItems.length) {
        openGalleryFromDirectoriesSelection(requestFullscreen);
        return;
      }
      showOverlay();
      if (requestFullscreen) enterFullscreenIfPossible();
    }

    function ensureViewerElements() {
      if (!viewerImgEl) {
        viewerImgEl = document.createElement("img");
        viewerImgEl.style.display = "none";
        viewerImgEl.onload = () => {
          viewerImgEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };
        viewport.appendChild(viewerImgEl);
      }
      if (!viewerVideoEl) {
        viewerVideoEl = document.createElement("video");
        viewerVideoEl.controls = true;
        viewerVideoEl.preload = "metadata";
        viewerVideoEl.playsInline = true;
        viewerVideoEl.autoplay = true;
        normalizeVideoPlaybackRate(viewerVideoEl);
        viewerVideoEl.poster = BLACK_POSTER_URL;
        viewerVideoEl.style.display = "none";
        viewport.appendChild(viewerVideoEl);
      }
      if (!viewerFolderEl) {
        viewerFolderEl = document.createElement("div");
        viewerFolderEl.style.display = "none";
        viewport.appendChild(viewerFolderEl);
      }
    }

    function showOverlay() {
      pausePreviewVideoForOverlay();
      VIEWER_MODE = true;
      ACTIVE_MEDIA_SURFACE = "overlay";
      overlay.classList.add("active");
      ensureViewerElements();
      renderViewerItem(viewerIndex);
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      overlay.classList.add("ui-hidden");
    }

    function stopSlideshow() {
      WS.view.slideshowActive = false;
      if (WS.view.slideshowTimer) {
        clearInterval(WS.view.slideshowTimer);
        WS.view.slideshowTimer = null;
      }
    }

    function startSlideshow(delayMs) {
      stopSlideshow();
      WS.view.slideshowActive = true;
      WS.view.slideshowTimer = setInterval(() => {
        if (!WS.view.slideshowActive) return;
        const item = viewerItems[viewerIndex] || null;
        if (item && !item.isFolder) {
          const rec = WS.fileById.get(item.id);
          if (rec && rec.type === "video") return;
        }
        viewerStep(1);
      }, delayMs);
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      else if (ACTIVE_MEDIA_SURFACE === "preview") renderPreviewViewerItem(viewerIndex);
    }

    function handleSlideshowHotkey(useViewerStatus) {
      const mode = slideshowBehavior();
      if (mode === "cycle") {
        WS.view.slideshowModeIndex = (WS.view.slideshowModeIndex + 1) % WS.view.slideshowDurations.length;
        const ms = WS.view.slideshowDurations[WS.view.slideshowModeIndex] | 0;
        if (!ms) {
          stopSlideshow();
          if (useViewerStatus) showStatusMessage("Slideshow: Off");
          else showSlideshowMessage("Slideshow: Off");
        } else {
          startSlideshow(ms);
          if (useViewerStatus) showStatusMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
          else showSlideshowMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
        }
        return;
      }

      const seconds = parseInt(mode, 10);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : 0;
      if (WS.view.slideshowActive) {
        stopSlideshow();
        if (useViewerStatus) showStatusMessage("Slideshow: Off");
        else showSlideshowMessage("Slideshow: Off");
        return;
      }
      if (ms > 0) {
        startSlideshow(ms);
        if (useViewerStatus) showStatusMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
        else showSlideshowMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
      }
    }

    function hideOverlay() {
      try {
        const item = viewerItems[viewerIndex] || null;
        if (item && !item.isFolder) {
          const rec = WS.fileById.get(item.id);
          if (rec && rec.type === "video" && viewerVideoEl && viewerVideoEl.style.display !== "none") {
            VIDEO_CARRY.active = true;
            VIDEO_CARRY.fileId = rec.id;
            VIDEO_CARRY.time = viewerVideoEl.currentTime || 0;
            VIDEO_CARRY.wasPlaying = !viewerVideoEl.paused;
          }
        }
      } catch {}

      overlay.classList.remove("active");
      VIEWER_MODE = false;
      if (viewerVideoEl) {
        try { viewerVideoEl.pause(); } catch {}
        try { viewerVideoEl.removeAttribute("src"); } catch {}
        try { viewerVideoEl.load(); } catch {}
        viewerVideoEl.classList.remove("ready");
        viewerVideoEl.classList.remove("mediaHidden");
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        try { viewerImgEl.removeAttribute("src"); } catch {}
        viewerImgEl.classList.remove("ready");
        viewerImgEl.classList.remove("mediaHidden");
        viewerImgEl.style.display = "none";
      }
      MediaFilterEngine.detach("viewer");
      if (viewerFolderEl) viewerFolderEl.style.display = "none";
      filenameEl.textContent = "";
      exitFullscreenIfNeeded();
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      overlay.classList.remove("ui-hidden");
      stopSlideshow();
      statusMessageEl.classList.remove("visible");
      syncDirectoriesToViewerState();
      if (!VIEWER_MODE && WS.preview.kind === "file" && WS.preview.fileId) ACTIVE_MEDIA_SURFACE = "preview";
      else if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
      resumePreviewVideoAfterOverlay();
    }

    function showUI() { overlay.classList.remove("ui-hidden"); }
    function hideUI() { overlay.classList.add("ui-hidden"); }

    function showGlobalCursor() {
      document.body.classList.remove("cursor-hidden");
    }

    function hideGlobalCursor() {
      document.body.classList.add("cursor-hidden");
    }

    function resetGlobalCursorHideTimer() {
      showGlobalCursor();
      if (globalCursorHideTimer) { clearTimeout(globalCursorHideTimer); globalCursorHideTimer = null; }
      globalCursorHideTimer = setTimeout(() => { hideGlobalCursor(); }, 2000);
    }

    function resetUIHideTimer() {
      showUI();
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      uiHideTimer = setTimeout(() => { hideUI(); }, 2000);
    }

    overlay.addEventListener("mousemove", () => {
      if (!VIEWER_MODE) return;
      resetUIHideTimer();
    });

    document.addEventListener("mousemove", resetGlobalCursorHideTimer, { passive: true });
    resetGlobalCursorHideTimer();

    function findFirstFileIndex(items) {
      for (let i = 0; i < items.length; i++) if (!items[i].isFolder) return i;
      return -1;
    }

    function findLastFileIndex(items) {
      for (let i = items.length - 1; i >= 0; i--) if (!items[i].isFolder) return i;
      return -1;
    }

    function moveToNextDirectoryFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx + 1; s < siblingDirs.length; s++) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const firstFileIndex = findFirstFileIndex(viewerItems);
        if (firstFileIndex === -1) continue;

        viewerIndex = firstFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function moveToPrevDirectoryFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx - 1; s >= 0; s--) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const lastFileIndex = findLastFileIndex(viewerItems);
        if (lastFileIndex === -1) continue;

        viewerIndex = lastFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function moveToPrevDirectoryFirstFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx - 1; s >= 0; s--) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const firstFileIndex = findFirstFileIndex(viewerItems);
        if (firstFileIndex === -1) continue;

        viewerIndex = firstFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function viewerStep(delta) {
      if (!viewerItems.length) return false;
      const n = viewerItems.length;
      const prevDir = viewerDirNode;
      const prevIdx = viewerIndex;

      let i = viewerIndex + delta;

      if (WS.view.folderBehavior === "loop") {
        i = i % n;
        if (i < 0) i += n;
        viewerIndex = i;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
      }

      if (WS.view.folderBehavior === "slide") {
        if (i < 0) {
          if (!moveToPrevDirectoryFile()) return false;
          return true;
        }
        if (i >= n) {
          if (!moveToNextDirectoryFile()) return false;
          return true;
        }

        viewerIndex = i;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
      }

      if (i < 0) i = 0;
      if (i >= n) i = n - 1;

      viewerIndex = i;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
      return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
    }

    function viewerJumpRelative(delta) {
      if (!viewerItems.length) return;
      const step = delta > 0 ? 1 : -1;
      let remaining = Math.abs(delta);
      while (remaining > 0) {
        const moved = viewerStep(step);
        if (!moved) break;
        remaining--;
      }
    }

    function viewerJumpToNextFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToNextDirectoryFile();
    }

    function viewerJumpToPrevFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToPrevDirectoryFirstFile();
    }

    function jumpViewerToDirectoryFirstFile(dirNode) {
      if (!dirNode) return false;
      viewerDirNode = dirNode;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      if (!viewerItems.length) return false;
      const firstFileIndex = findFirstFileIndex(viewerItems);
      if (firstFileIndex < 0) return false;
      viewerIndex = firstFileIndex;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
      return true;
    }

    function randomFirstFileJumpFromViewer() {
      const sourceDir = viewerDirNode || WS.nav.dirNode;
      if (!sourceDir) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      if (!canUseFolderJumpActions()) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      const targetDir = pickRandomFirstFileJumpTarget(sourceDir);
      if (!targetDir) {
        showStatusMessage("First File Jump: no matching folder.");
        return false;
      }
      const ok = jumpViewerToDirectoryFirstFile(targetDir);
      if (ok) showStatusMessage("First File Jump");
      else showStatusMessage("First File Jump: no files.");
      return ok;
    }

    function renderViewerItem(idx) {
      if (!viewerItems.length) {
        if (viewerImgEl) viewerImgEl.style.display = "none";
        if (viewerVideoEl) viewerVideoEl.style.display = "none";
        if (viewerFolderEl) viewerFolderEl.style.display = "none";
        filenameEl.textContent = "";
        MediaFilterEngine.detach("viewer");
        if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
        if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
        return;
      }

      ensureViewerElements();

      const n = viewerItems.length;
      let i = idx;
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      viewerIndex = i;

      const item = viewerItems[viewerIndex];

      if (viewerVideoEl) {
        try { viewerVideoEl.pause(); } catch {}
        viewerVideoEl.classList.remove("ready");
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        viewerImgEl.classList.remove("ready");
        viewerImgEl.style.display = "none";
      }
      if (viewerFolderEl) viewerFolderEl.style.display = "none";
      MediaFilterEngine.detach("viewer");
      if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
      if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");

      if (!item) return;

      if (item.isFolder) {
        viewerFolderEl.style.display = "flex";
        viewerFolderEl.style.flexDirection = "column";
        viewerFolderEl.style.alignItems = "center";
        viewerFolderEl.style.justifyContent = "center";
        viewerFolderEl.style.minWidth = "200px";
        viewerFolderEl.style.maxWidth = "80%";
        viewerFolderEl.style.padding = "24px 32px";
        viewerFolderEl.style.borderRadius = "4px";
        viewerFolderEl.style.background = "var(--color1-secondary)";
        viewerFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

        viewerFolderEl.innerHTML = "";

        const icon = document.createElement("div");
        icon.style.fontSize = "56px";
        icon.style.marginBottom = "12px";
        icon.textContent = "📁";

        const name = document.createElement("div");
        name.style.fontSize = "14px";
        name.style.color = "var(--color0-primary)";
        name.style.textAlign = "center";
        name.style.whiteSpace = "nowrap";
        name.style.overflow = "hidden";
        name.style.textOverflow = "ellipsis";
        name.textContent = dirDisplayName(item.dirNode) || "Folder";

        viewerFolderEl.appendChild(icon);
        viewerFolderEl.appendChild(name);

        filenameEl.textContent = item.dirNode?.path ? displayPath(item.dirNode.path) : (dirDisplayName(item.dirNode) || "");
        return;
      }

      const rec = WS.fileById.get(item.id);
      if (!rec) return;

      filenameEl.textContent = relPathDisplayName(rec.relPath || rec.name || "");

      if (rec.type === "video") {
        const mode = galleryVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE;
        if (previewVideoEl) { try { previewVideoEl.pause(); } catch {} }
        normalizeVideoPlaybackRate(viewerVideoEl);
        viewerVideoEl.autoplay = doAuto;
        viewerVideoEl.onloadeddata = null;
        viewerVideoEl.onended = null;
        viewerVideoEl.muted = (mode === "muted") || BANIC_ACTIVE;
        const endBehavior = videoEndBehavior();
        if (WS.view.slideshowActive) {
          viewerVideoEl.loop = false;
          viewerVideoEl.onended = () => { if (WS.view.slideshowActive) viewerStep(1); };
        } else if (endBehavior === "loop") {
          viewerVideoEl.loop = true;
        } else if (endBehavior === "next") {
          viewerVideoEl.loop = false;
          viewerVideoEl.onended = () => { if (!WS.view.slideshowActive) viewerStep(1); };
        } else {
          viewerVideoEl.loop = false;
        }
        viewerVideoEl.onloadeddata = () => {
          viewerVideoEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };

        applyVideoPoster(viewerVideoEl, rec);
        const src = ensureMediaUrl(rec) || "";
        const same = viewerVideoEl.src === src;
        if (!same) {
          viewerVideoEl.src = src;
          try { viewerVideoEl.load(); } catch {}
        }
        viewerVideoEl.style.display = "block";
        syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video");

        applyVideoCarryToElement(viewerVideoEl, rec.id);

        if (viewerVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { viewerVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { viewerVideoEl.play(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      viewerImgEl.onload = () => {
        viewerImgEl.classList.add("ready");
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = viewerImgEl.src === src;
      if (!same) viewerImgEl.src = src;
      viewerImgEl.style.display = "block";
      syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image");

      if (viewerImgEl.complete && viewerImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => { viewerImgEl.classList.add("ready"); });
      }
      preloadNextMedia(viewerItems, viewerIndex);
    }

    function viewerEnterDir() { // Right
      const it = viewerItems[viewerIndex];
      if (it && it.isFolder && it.dirNode) {
        if (viewerDirNode) viewerDirNode.lastIndex = viewerIndex;
        viewerDirNode = it.dirNode;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        let idx = typeof viewerDirNode.lastIndex === "number" ? viewerDirNode.lastIndex : 0;
        if (idx < 0) idx = 0;
        if (idx >= viewerItems.length) idx = viewerItems.length - 1;
        viewerIndex = idx;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
      }
    }

    function viewerLeaveDir() { // Left
      if (tryRestoreTagDirectoryContext()) return;
      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }
      if (WS.view.dirSearchPinned && !WS.view.searchRootActive) {
        if (VIEWER_MODE) hideOverlay();
        returnToSearchResults();
        return;
      }
      if (!viewerDirNode || !viewerDirNode.parent) return;
      const child = viewerDirNode;
      child.lastIndex = viewerIndex;
      viewerDirNode = viewerDirNode.parent;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      let idx = 0;
      for (let i = 0; i < viewerItems.length; i++) {
        const it = viewerItems[i];
        if (it.isFolder && it.dirNode === child) { idx = i; break; }
      }
      viewerDirNode.lastIndex = idx;
      viewerIndex = idx;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      WS.view.pendingDirScroll = "center-selected";
      syncDirectoriesToViewerState();
    }

    function getActiveMediaVideo() {
      if (VIEWER_MODE) return viewerVideoEl && viewerVideoEl.style.display !== "none" ? viewerVideoEl : null;
      if (ACTIVE_MEDIA_SURFACE === "preview") return previewVideoEl && previewVideoEl.style.display !== "none" ? previewVideoEl : null;
      return null;
    }

    function seekViewerVideo(deltaSeconds) {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {
        let t = (vid.currentTime || 0) + deltaSeconds;
        if (t < 0) t = 0;
        if (!isNaN(vid.duration) && isFinite(vid.duration) && vid.duration >= 0) {
          if (t > vid.duration) t = vid.duration;
        }
        vid.currentTime = t;
      } catch {}
    }

    function toggleViewerVideoPlayPause() {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {         if (vid.paused) {
          vid.play();
        } else {
          vid.pause();
        }
      } catch {}
    }

    function toggleViewerVideoMute() {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {
        vid.muted = !vid.muted;
      } catch {}
    }

    /* =========================================================
       Fullscreen helpers
       ========================================================= */

    async function enterFullscreenIfPossible() {
      if (!overlay) return;
      if (document.fullscreenElement) return;
      try { await overlay.requestFullscreen(); } catch {}
    }

    function exitFullscreenIfNeeded() {
      if (!document.fullscreenElement) return;
      try { document.exitFullscreen(); } catch {}
    }

    /* =========================================================
       Overlay buttons + basic wiring
       ========================================================= */

    if (closeBtn) closeBtn.addEventListener("click", (e) => { e.stopPropagation(); hideOverlay(); });

    overlay.addEventListener("click", (e) => {
      if (!VIEWER_MODE) return;
    });

    /* =========================================================
       Global UI sync helpers
       ========================================================= */

    function syncButtons() {
      const hasWS = !!WS.root && (!!WS.nav.dirNode || WS.view.favoritesMode || WS.view.hiddenMode);
      if (favoritesBtn) favoritesBtn.disabled = !hasWS;
      if (hiddenBtn) hiddenBtn.disabled = !hasWS;
      if (refreshBtn) refreshBtn.disabled = !WS.meta.fsRootHandle;

      if (directoriesSearchInput) {
        directoriesSearchInput.disabled = !hasWS;
        const v = String(WS.view.dirSearchQuery || "");
        if (directoriesSearchInput.value !== v) directoriesSearchInput.value = v;
        const placeholderName = (function () {
          if (!hasWS) return "folder";
          if (WS.view.favoritesMode) return "Favorites";
          if (WS.view.hiddenMode) return "Hidden";
          const node = WS.nav.dirNode;
          if (node && node.name) {
            const nm = dirDisplayName(node);
            if (nm) return nm;
          }
          const p = String(node?.path || "");
          if (p) {
            const parts = p.split(/[/\\\\]+/).filter(Boolean);
            if (parts.length) return parts[parts.length - 1];
          }
          return "folder";
        })();
        directoriesSearchInput.placeholder = `Search ${placeholderName}`;
      }
      if (directoriesSearchClearBtn) {
        const enabled = hasWS && (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
        directoriesSearchClearBtn.disabled = !enabled;
      }

      if (dirBackBtn) dirBackBtn.disabled = !(WS.view.dirHistoryIndex > 0);
      if (dirForwardBtn) dirForwardBtn.disabled = !(WS.view.dirHistoryIndex >= 0 && WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1);
      if (dirUpBtn) dirUpBtn.disabled = !WS.nav.dirNode || !WS.nav.dirNode.parent || (WS.view.dirSearchPinned && WS.view.searchRootActive) || WS.view.favoritesMode || WS.view.hiddenMode;

      syncMetaButtons();
      updateModePill();
    }

    function applyViewModesEverywhere(animate = false) {
      if (!WS.root || (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)) {
        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        return;
      }

      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane(true);
      renderPreviewPane(animate, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function applyRandomSortModeEverywhere(animate = false) {
      if (VIEWER_MODE) {
        if (!viewerDirNode) return;
        const currentItem = viewerItems[viewerIndex] || null;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) return;
        let nextIndex = 0;
        if (currentItem) {
          if (currentItem.isFolder) {
            const path = String(currentItem.dirNode?.path || "");
            const found = viewerItems.findIndex(item => item.isFolder && String(item.dirNode?.path || "") === path);
            if (found >= 0) nextIndex = found;
          } else {
            const found = viewerItems.findIndex(item => !item.isFolder && item.id === currentItem.id);
            if (found >= 0) nextIndex = found;
          }
        }
        viewerIndex = Math.max(0, Math.min(viewerItems.length - 1, nextIndex));
        renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return;
      }
      if (!WS.root || (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)) {
        applyViewModesEverywhere(animate);
        return;
      }
      const currentEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
      const currentKey = currentEntry
        ? (currentEntry.kind === "dir"
          ? { kind: "dir", path: String(currentEntry.node?.path || "") }
          : (currentEntry.kind === "file"
            ? { kind: "file", id: String(currentEntry.id || "") }
            : { kind: "tag", label: String(currentEntry.label || ""), tag: String(currentEntry.tag || ""), special: String(currentEntry.special || "") }))
        : null;
      rebuildDirectoriesEntries();
      let nextIndex = -1;
      if (currentKey) {
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const entry = WS.nav.entries[i];
          if (!entry || entry.kind !== currentKey.kind) continue;
          if (entry.kind === "dir" && String(entry.node?.path || "") === currentKey.path) { nextIndex = i; break; }
          if (entry.kind === "file" && String(entry.id || "") === currentKey.id) { nextIndex = i; break; }
          if (entry.kind === "tag"
            && String(entry.label || "") === currentKey.label
            && String(entry.tag || "") === currentKey.tag
            && String(entry.special || "") === currentKey.special) { nextIndex = i; break; }
        }
      }
      const fallbackIndex = nextIndex >= 0 ? nextIndex : WS.nav.selectedIndex;
      WS.nav.selectedIndex = findNearestSelectableIndex(fallbackIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(animate, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function toggleRandomSortMode() {
      if (!WS.root) return false;
      WS.view.randomMode = !WS.view.randomMode;
      if (WS.view.randomMode) reseedRandomSortMode();
      else WS.view.randomCache = new Map();
      applyRandomSortModeEverywhere(true);
      showStatusMessage(`Random file sort: ${WS.view.randomMode ? "On" : "Off"}`);
      return true;
    }

    function runRandomActionForDirectories() {
      const mode = randomActionMode();
      if (mode === "randomFileSort") return toggleRandomSortMode();
      return randomFirstFileJumpFromDirectories();
    }

    function runRandomActionForViewer() {
      const mode = randomActionMode();
      if (mode === "randomFileSort") return toggleRandomSortMode();
      return randomFirstFileJumpFromViewer();
    }

    /* =========================================================
       Key controls
       ========================================================= */

    function isTextInputTarget(el) {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    const MEDIA_FILTER_CYCLE = [
      { value: "off", label: "Off" },
      { value: "vibrant", label: "Vibrant" },
      { value: "cinematic", label: "Cinematic" },
      { value: "orangeTeal", label: "Orange+Teal" },
      { value: "bw", label: "Black + White" },
      { value: "uv", label: "UV Camera" },
      { value: "infrared", label: "Infrared Camera" }
    ];

    const COLOR_SCHEME_CYCLE = [
      { value: "classic", label: "Classic Dark" },
      { value: "light", label: "Light" },
      { value: "superdark", label: "OLED Dark" },
      { value: "synthwave", label: "Synthwave" },
      { value: "verdant", label: "Verdant" },
      { value: "azure", label: "Azure" },
      { value: "ember", label: "Ember" },
      { value: "amber", label: "Amber" },
      { value: "retro90s", label: "Retro 90s" },
      { value: "retro90s-dark", label: "Retro 90s Dark" }
    ];

    const VIDEO_END_BEHAVIOR_CYCLE = [
      { value: "loop", label: "Loop video" },
      { value: "next", label: "Advance to next item" },
      { value: "stop", label: "Stop at end" }
    ];

    function cycleFilterMode() {
      const m = WS.view.filterMode;
      WS.view.filterMode = (m === "all") ? "images" : (m === "images") ? "videos" : (m === "videos") ? "gifs" : "all";
      applyViewModesEverywhere(true);
      showStatusMessage(`Filter: ${WS.view.filterMode}`);
    }

    function cycleFolderBehavior() {
      const b = WS.view.folderBehavior;
      const next = (b === "stop") ? "loop" : (b === "loop") ? "slide" : "stop";
      WS.view.folderBehavior = next;
      if (WS.meta && WS.meta.options) {
        WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, { defaultFolderBehavior: next }));
        WS.meta.dirty = true;
        metaScheduleSave();
      }
      applyViewModesEverywhere(true);
      showStatusMessage(`Folder behavior: ${WS.view.folderBehavior}`);
    }

    function setOptionValue(key, value) {
      if (!WS.meta) return null;
      const next = {};
      next[key] = value;
      WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
      WS.meta.dirty = true;
      metaScheduleSave();
      return WS.meta.options ? WS.meta.options[key] : null;
    }

    function toggleOptionValue(key) {
      const current = WS.meta && WS.meta.options ? !!WS.meta.options[key] : false;
      return setOptionValue(key, !current);
    }

    function cycleOptionValue(key, list) {
      const values = list.map(entry => entry.value);
      const current = WS.meta && WS.meta.options ? String(WS.meta.options[key] || "") : "";
      const idx = values.indexOf(current);
      const next = values[(idx >= 0 ? idx + 1 : 0) % values.length];
      setOptionValue(key, next);
      return next;
    }

    function labelForCycleValue(list, value) {
      const entry = list.find(item => item.value === value);
      return entry ? entry.label : String(value || "");
    }

    function handleExtrasKeybindAction(action) {
      if (!action || !WS.meta) return false;
      switch (action) {
        case "cycleMediaFilter": {
          const next = cycleOptionValue("mediaFilter", MEDIA_FILTER_CYCLE);
          applyMediaFilterFromOptions();
          showStatusMessage(`Media filter: ${labelForCycleValue(MEDIA_FILTER_CYCLE, next)}`);
          return true;
        }
        case "cycleColorScheme": {
          const next = cycleOptionValue("colorScheme", COLOR_SCHEME_CYCLE);
          applyColorSchemeFromOptions();
          showStatusMessage(`Color scheme: ${labelForCycleValue(COLOR_SCHEME_CYCLE, next)}`);
          return true;
        }
        case "toggleRetroMode": {
          const next = toggleOptionValue("retroMode");
          applyRetroModeFromOptions();
          showStatusMessage(`Retro mode: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleScanlinesOverlay": {
          const next = toggleOptionValue("crtScanlinesEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Scanlines: ${next ? "On" : "Off"}`);
          return true;
        }
        case "togglePixelatedOverlay": {
          const next = toggleOptionValue("crtPixelateEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Pixelated overlay: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleFilmGrainOverlay": {
          const next = toggleOptionValue("crtGrainEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Film grain: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleVhsOverlay": {
          const next = toggleOptionValue("vhsOverlayEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`VHS overlay: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleFilmCornersOverlay": {
          const next = toggleOptionValue("filmCornerOverlayEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Film corners: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleAnimatedFilters": {
          const next = toggleOptionValue("animatedMediaFilters");
          applyMediaFilterFromOptions();
          showStatusMessage(`Animated filters: ${next ? "On" : "Off"}`);
          return true;
        }
        case "cycleFolderSort": {
          WS.meta.dirSortMode = cycleDirSortMode(WS.meta.dirSortMode);
          WS.meta.dirty = true;
          metaScheduleSave();
          applyViewModesEverywhere(true);
          showStatusMessage(`Folder sort: ${dirSortModeLabel(WS.meta.dirSortMode)}`);
          return true;
        }
        case "cycleFolderBehavior": {
          cycleFolderBehavior();
          return true;
        }
        case "cycleVideoEndBehavior": {
          const next = cycleOptionValue("videoEndBehavior", VIDEO_END_BEHAVIOR_CYCLE);
          showStatusMessage(`Video end: ${labelForCycleValue(VIDEO_END_BEHAVIOR_CYCLE, next)}`);
          return true;
        }
        case "toggleShowHiddenFolder": {
          const next = toggleOptionValue("showHiddenFolder");
          if (!next && WS.view.tagFolderActiveMode === "hidden") exitTagFolderView();
          renderDirectoriesPane(true);
          showStatusMessage(`Hidden folder: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowUntaggedFolder": {
          const next = toggleOptionValue("showUntaggedFolder");
          if (!next && WS.view.tagFolderActiveMode === "untagged") exitTagFolderView();
          renderDirectoriesPane(true);
          showStatusMessage(`Untagged folder: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowPreviewFileName": {
          const next = toggleOptionValue("showPreviewFileName");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview file names: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowPreviewFileType": {
          const next = toggleOptionValue("showPreviewFileTypeLabel");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview file types: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowPreviewFolderCounts": {
          const next = toggleOptionValue("showPreviewFolderItemCount");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview folder counts: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowFolderItemCounts": {
          const next = toggleOptionValue("showFolderItemCount");
          renderDirectoriesPane(true);
          showStatusMessage(`Folder counts: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowDirFileTypeLabel": {
          const next = toggleOptionValue("showDirFileTypeLabel");
          renderDirectoriesPane(true);
          showStatusMessage(`Directory file types: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleHideFileExtensions": {
          const next = toggleOptionValue("hideFileExtensions");
          applyOptionsEverywhere(false);
          showStatusMessage(`Hide extensions: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleHideUnderscores": {
          const next = toggleOptionValue("hideUnderscoresInNames");
          applyOptionsEverywhere(false);
          showStatusMessage(`Hide underscores: ${next ? "On" : "Off"}`);
          return true;
        }
        default:
          return false;
      }
    }

    function moveDirectoriesSelection(delta) {
      if (!WS.root) return;
      if (!WS.nav.entries.length) return;

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;

      if (WS.view.folderBehavior === "slide" && entry && entry.kind === "file") {
        slideMoveFiles(delta);
        return;
      }

      setDirectoriesSelection(WS.nav.selectedIndex + delta);
    }

    function getDirectorySelectionForKeybindAction() {
      const out = [];
      const seen = new Set();
      let usedBulk = false;

      if (WS.view.bulkSelectMode) {
        const selected = getSelectedPathsInCurrentDir();
        if (selected.length) usedBulk = true;
        for (let i = 0; i < selected.length; i++) {
          const p = String(selected[i] || "");
          if (!p || seen.has(p)) continue;
          seen.add(p);
          out.push(p);
        }
        return { paths: out, usedBulk };
      }

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (entry && entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (p && !seen.has(p)) out.push(p);
      }

      return { paths: out, usedBulk };
    }

    function getFileSelectionForKeybindAction() {
      const out = [];
      const seen = new Set();
      let usedBulk = false;

      if (WS.view.bulkSelectMode) {
        const selected = getSelectedFileIdsInCurrentView();
        if (selected.length) usedBulk = true;
        for (let i = 0; i < selected.length; i++) {
          const id = String(selected[i] || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
        return { ids: out, usedBulk };
      }

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (entry && entry.kind === "file") {
        const id = String(entry.id || "");
        if (id && !seen.has(id)) out.push(id);
      }

      return { ids: out, usedBulk };
    }

    function selectDirectoryEntryByPath(path) {
      const p = String(path || "");
      if (!p) return false;
      const idx = findDirEntryIndexByPath(p);
      if (idx < 0) return false;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();
      return true;
    }

    function selectFileEntryById(fileId) {
      const id = String(fileId || "");
      if (!id) return false;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) {
          WS.nav.selectedIndex = findNearestSelectableIndex(i, 1);
          syncPreviewToSelection();
          return true;
        }
      }
      return false;
    }

    function focusSelectedDirectoryInlineInput(selector) {
      setTimeout(() => {
        if (!directoriesListEl) return;
        const selectedInput = directoriesListEl.querySelector(`.dirRow.selected ${selector}`);
        const input = selectedInput || directoriesListEl.querySelector(selector);
        if (!input) return;
        try { input.focus(); input.select(); } catch {}
      }, 0);
    }

    function applyFolderScoreSelectionAction(delta) {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (usedBulk) finalizeBulkSelectionAction();
      metaBumpScoreBulk(paths, delta);
      return true;
    }

    function startTagSelectionEdit() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;

      if (paths.length > 1) {
        TAG_EDIT_PATH = null;
        startBulkTagging(paths);
        return true;
      }

      const path = paths[0];
      TAG_EDIT_PATH = path;
      clearBulkTagPlaceholder();
      selectDirectoryEntryByPath(path);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".tagEditInput:not(.renameEditInput)");
      return true;
    }

    function toggleFavoriteSelection() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (usedBulk) finalizeBulkSelectionAction();
      const allFavorite = paths.every(p => metaHasFavorite(p));
      metaSetFavoriteBulk(paths, !allFavorite);
      return true;
    }

    function startFolderRenameSelection() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (paths.length > 1) {
        showStatusMessage("Select one folder to rename.");
        return false;
      }

      const path = String(paths[0] || "");
      const dirNode = WS.dirByPath.get(path);
      if (!dirNode) return false;
      const isOnline = !!(dirNode.onlineMeta && (dirNode.onlineMeta.kind === "profile" || dirNode.onlineMeta.kind === "post"));
      if (!isOnline && !WS.meta.fsRootHandle) {
        showStatusMessage("Rename requires a writable folder.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      TAG_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      RENAME_EDIT_PATH = path;
      clearBulkTagPlaceholder();
      selectDirectoryEntryByPath(path);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".renameEditInput");
      return true;
    }

    function startFileRenameSelection() {
      const { ids, usedBulk } = getFileSelectionForKeybindAction();
      if (!ids.length) {
        showStatusMessage("No files selected.");
        return false;
      }
      if (ids.length > 1) {
        showStatusMessage("Select one file to rename.");
        return false;
      }

      const id = String(ids[0] || "");
      const rec = WS.fileById.get(id);
      if (!rec) return false;
      if (!rec.online && !WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = id;
      clearBulkTagPlaceholder();
      selectFileEntryById(id);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".renameEditInput");
      return true;
    }

    function handleSelectionKeybindAction(action) {
      if (!action || !WS.root || VIEWER_MODE) return false;
      switch (action) {
        case "scoreUpSelection":
          return applyFolderScoreSelectionAction(1);
        case "scoreDownSelection":
          return applyFolderScoreSelectionAction(-1);
        case "tagSelection":
          return startTagSelectionEdit();
        case "favoriteSelection":
          return toggleFavoriteSelection();
        case "renameFolderSelection":
          return startFolderRenameSelection();
        case "renameFileSelection":
          return startFileRenameSelection();
        default:
          return false;
      }
    }

    function closeFilePreviewToFolder() {
      if (!WS.root) return;
      if (WS.preview.kind !== "file") return;
      WS.preview.kind = "dir";
      WS.preview.fileId = null;
      WS.preview.dirNode = getPreviewTargetDir();
      ACTIVE_MEDIA_SURFACE = "none";
      renderPreviewPane(true, true);
      syncButtons();
    }

    function handleBackAction() {
      if (MENU_OPEN) { closeMenu(); return true; }
      if (WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath || WS.view.fileActionMenuId) {
        closeActionMenus();
        renderDirectoriesPane(true);
        return true;
      }
      if (VIEWER_MODE) { hideOverlay(); return true; }
      if (WS.preview.kind === "file" && WS.preview.fileId) {
        closeFilePreviewToFolder();
        return true;
      }
      return false;
    }

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = normalizeKeyValue(e.key);
      if (!key) return;

      if (key === ".") {
        if (isTextInputTarget(e.target)) return;
        if (VIEWER_MODE) return;
        if (directoriesSearchInput && !directoriesSearchInput.disabled) {
          e.preventDefault();
          try { directoriesSearchInput.focus(); directoriesSearchInput.select(); } catch {}
          return;
        }
      }

      const action = keybindActionFor(key);

      if (action === "panic") {
        e.preventDefault();
        applyBanicState(!BANIC_ACTIVE);
        return;
      }

      if (BANIC_ACTIVE) return;

      if (key === "Escape" || action === "back") {
        const handled = handleBackAction();
        if (handled) e.preventDefault();
        return;
      }

      if (MENU_OPEN) return;

      if (isTextInputTarget(e.target)) return;

      if (handleExtrasKeybindAction(action)) {
        e.preventDefault();
        return;
      }

      if (handleSelectionKeybindAction(action)) {
        e.preventDefault();
        return;
      }

      if (VIEWER_MODE) {
        switch (action) {
          case "selectUp":
            e.preventDefault();
            viewerStep(-1);
            return;
          case "selectDown":
            e.preventDefault();
            viewerStep(1);
            return;
          case "leaveDir":
            e.preventDefault();
            hideOverlay();
            return;
          case "enterDir":
            e.preventDefault();
            viewerEnterDir();
            return;
          case "prevFolder":
            e.preventDefault();
            viewerJumpToPrevFolderFirstFile();
            return;
          case "nextFolder":
            e.preventDefault();
            viewerJumpToNextFolderFirstFile();
            return;
          case "randomJump":
            e.preventDefault();
            runRandomActionForViewer();
            return;
          case "cycleFilter":
            e.preventDefault();
            cycleFilterMode();
            return;
          case "slideshow":
            e.preventDefault();
            handleSlideshowHotkey(true);
            return;
          case "seekBack":
            e.preventDefault();
            seekViewerVideo(-videoSkipStepSeconds());
            return;
          case "seekForward":
            e.preventDefault();
            seekViewerVideo(videoSkipStepSeconds());
            return;
          case "playPause":
            e.preventDefault();
            toggleViewerVideoPlayPause();
            return;
          case "muteToggle":
            e.preventDefault();
            toggleViewerVideoMute();
            return;
          case "jumpMinus50":
            e.preventDefault();
            viewerJumpRelative(-50);
            return;
          case "jumpMinus10":
            e.preventDefault();
            viewerJumpRelative(-10);
            return;
          case "jumpPlus10":
            e.preventDefault();
            viewerJumpRelative(10);
            return;
          case "jumpPlus50":
            e.preventDefault();
            viewerJumpRelative(50);
            return;
          default:
            return;
        }
      }

      if (!WS.root) return;

      const inFilePreview = (WS.preview.kind === "file" && !!WS.preview.fileId);

      if (inFilePreview) {
        switch (action) {
          case "selectUp":
            e.preventDefault();
            viewerStep(-1);
            return;
          case "selectDown":
            e.preventDefault();
            viewerStep(1);
            return;
          case "leaveDir":
            e.preventDefault();
            viewerLeaveDir();
            return;
          case "enterDir":
            e.preventDefault();
            openGalleryFromViewerState(true);
            return;
          case "prevFolder":
            e.preventDefault();
            viewerJumpToPrevFolderFirstFile();
            return;
          case "nextFolder":
            e.preventDefault();
            jumpToNextFolderFirstFile();
            return;
          case "randomJump":
            e.preventDefault();
            runRandomActionForViewer();
            return;
          case "cycleFilter":
            e.preventDefault();
            cycleFilterMode();
            return;
          case "slideshow":
            e.preventDefault();
            handleSlideshowHotkey(false);
            return;
          case "seekBack":
            e.preventDefault();
            seekViewerVideo(-videoSkipStepSeconds());
            return;
          case "seekForward":
            e.preventDefault();
            seekViewerVideo(videoSkipStepSeconds());
            return;
          case "playPause":
            e.preventDefault();
            toggleViewerVideoPlayPause();
            return;
          case "muteToggle":
            e.preventDefault();
            toggleViewerVideoMute();
            return;
          case "jumpMinus50":
            e.preventDefault();
            viewerJumpRelative(-50);
            return;
          case "jumpMinus10":
            e.preventDefault();
            viewerJumpRelative(-10);
            return;
          case "jumpPlus10":
            e.preventDefault();
            viewerJumpRelative(10);
            return;
          case "jumpPlus50":
            e.preventDefault();
            viewerJumpRelative(50);
            return;
          case "historyBack":
            e.preventDefault();
            goDirHistory(-1);
            return;
          case "historyForward":
            e.preventDefault();
            goDirHistory(1);
            return;
          default:
            return;
        }
      }

      switch (action) {
        case "selectUp":
          e.preventDefault();
          moveDirectoriesSelection(-1);
          return;
        case "selectDown":
          e.preventDefault();
          moveDirectoriesSelection(1);
          return;
        case "leaveDir":
          e.preventDefault();
          leaveDirectory();
          return;
        case "enterDir":
          e.preventDefault();
          enterSelectedDirectory();
          return;
        case "prevFolder":
          e.preventDefault();
          jumpToPrevFolderFirstFile();
          return;
        case "nextFolder":
          e.preventDefault();
          jumpToNextFolderFirstFile();
          return;
        case "randomJump":
          e.preventDefault();
          runRandomActionForDirectories();
          return;
        case "cycleFilter":
          e.preventDefault();
          cycleFilterMode();
          return;
        case "jumpMinus50":
          e.preventDefault();
          moveDirectoriesSelection(-50);
          return;
        case "jumpMinus10":
          e.preventDefault();
          moveDirectoriesSelection(-10);
          return;
        case "jumpPlus10":
          e.preventDefault();
          moveDirectoriesSelection(10);
          return;
        case "jumpPlus50":
          e.preventDefault();
          moveDirectoriesSelection(50);
          return;
        case "historyBack":
          e.preventDefault();
          goDirHistory(-1);
          return;
        case "historyForward":
          e.preventDefault();
          goDirHistory(1);
          return;
        default:
          return;
      }
    });

    /* =========================================================
       Initial UI state
       ========================================================= */

    if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;
    applyColorSchemeFromOptions();
    applyRetroModeFromOptions();
    rebuildKeybindIndex();
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();

  
