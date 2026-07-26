// ==UserScript==
// @name         Export AI Chat to Markdown
// @description  Export a ChatGPT, Gemini, Grok, or Claude conversation to a Markdown file
// @namespace    AI_Export_MD
// @version      2.0.0
// @author       Kairox
// @include      *://chatgpt.com/*
// @include      *://grok.com/*
// @include      *://gemini.google.com/*
// @include      *://claude.ai/*
// @noframes
// @license      MIT
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const exportLabel = "Export";

    const CommonUtil = {
        createElement: function(tag, opts = {}) {
            const el = document.createElement(tag);
            if (opts.html) el.innerHTML = opts.html;
            if (opts.text) el.textContent = opts.text;
            if (opts.className) el.className = opts.className;
            if (opts.style) Object.assign(el.style, opts.style);
            if (opts.childrens) opts.childrens.forEach(c => el.appendChild(c));
            return el;
        }
    };

    const HtmlToMarkdown = {
        to: function(html, platform) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const isChatGPT = platform === "chatGPT", isGemini = platform === "gemini", isGrok = platform === "grok", isClaude = platform === "claude";

            if (!isGemini) doc.querySelectorAll("span.katex-html").forEach(el => el.remove());
            doc.querySelectorAll("mrow").forEach(m => m.remove());
            doc.querySelectorAll('annotation[encoding="application/x-tex"]').forEach(el => {
                if (el.closest(".katex-display")) el.replaceWith(`\n$$\n${el.textContent.trim()}\n$$\n`);
                else el.replaceWith(`$${el.textContent.trim()}$`);
            });

            doc.querySelectorAll("strong, b").forEach(b => b.parentNode.replaceChild(document.createTextNode(`**${b.textContent}**`), b));
            doc.querySelectorAll("em, i").forEach(i => i.parentNode.replaceChild(document.createTextNode(`*${i.textContent}*`), i));
            doc.querySelectorAll("p code").forEach(c => c.parentNode.replaceChild(document.createTextNode(`\`${c.textContent}\``), c));
            doc.querySelectorAll("a").forEach(a => a.parentNode.replaceChild(document.createTextNode(`[${a.textContent}](${a.href})`), a));
            doc.querySelectorAll("img").forEach(img => img.parentNode.replaceChild(document.createTextNode(`![${img.alt}](${img.src})`), img));

            if (isChatGPT) {
                doc.querySelectorAll("pre").forEach(pre => {
                    const type = pre.querySelector("div > div:first-child")?.textContent || "";
                    const code = pre.querySelector("div > div:nth-child(3) > code")?.textContent || pre.textContent;
                    pre.innerHTML = `\n\`\`\`${type}\n${code}\n\`\`\`\n`;
                });
            } else if (isGrok) {
                doc.querySelectorAll("div.not-prose").forEach(div => {
                    const type = div.querySelector("div > div > span")?.textContent || "";
                    const code = div.querySelector("div > div:nth-child(3) > code")?.textContent || div.textContent;
                    div.innerHTML = `\n\`\`\`${type}\n${code}\n\`\`\`\n`;
                });
            } else if (isGemini) {
                doc.querySelectorAll("code-block").forEach(div => {
                    const type = div.querySelector("div > div > span")?.textContent || "";
                    const code = div.querySelector("div > div:nth-child(2) > div > pre")?.textContent || div.textContent;
                    div.innerHTML = `\n\`\`\`${type}\n${code}\n\`\`\`\n`;
                });
            } else if (isClaude) {
                doc.querySelectorAll("pre").forEach(pre => {
                    const code = pre.querySelector("code");
                    const type = code ? Array.from(code.classList).find(c => c.startsWith('language-'))?.replace('language-', '') : "";
                    pre.innerHTML = `\n\`\`\`${type || ''}\n${code ? code.textContent : pre.textContent}\n\`\`\`\n`;
                });
            }

            doc.querySelectorAll("ul").forEach(ul => {
                let m = "";
                ul.querySelectorAll(":scope > li").forEach(li => m += `- ${li.textContent.trim()}\n`);
                ul.parentNode.replaceChild(document.createTextNode("\n" + m.trim()), ul);
            });
            doc.querySelectorAll("ol").forEach(ol => {
                let m = "";
                ol.querySelectorAll(":scope > li").forEach((li, idx) => m += `${idx + 1}. ${li.textContent.trim()}\n`);
                ol.parentNode.replaceChild(document.createTextNode("\n" + m.trim()), ol);
            });
            for (let i = 1; i <= 6; i++) {
                doc.querySelectorAll(`h${i}`).forEach(h => h.parentNode.replaceChild(document.createTextNode(`\n${"#".repeat(i)} ${h.textContent}\n`), h));
            }
            doc.querySelectorAll("p").forEach(p => p.parentNode.replaceChild(document.createTextNode("\n" + p.textContent + "\n"), p));
            return doc.body.innerHTML.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
        }
    };

    const sanitize = s => (s || "").replace(/[\/\\\?\%\*\:\|"<>\.]/g, "_").replace(/\s+/g, " ").trim();

    const Chat = {
        // Display names for each platform, used in the header and filename.
        aiName: { chatGPT: "ChatGPT", grok: "Grok", gemini: "Gemini", claude: "Claude" },

        // Best-effort detection of the project/space/gem a conversation belongs to.
        getProject: function(platform) {
            let el = null;
            if (platform === "chatGPT") {
                el = document.querySelector('a[href*="/g/g-p-"]');
            } else if (platform === "claude") {
                el = document.querySelector('a[href*="/project/"]');
            } else if (platform === "gemini") {
                el = document.querySelector('bot-list-item .selected, gem-list-item .selected');
            }
            return el ? el.textContent.trim() : "";
        },

        getElements: function() {
            const h = window.location.href, res = [];
            let p = "", t = document.title || "Export";
            if (h.includes("chatgpt.com")) {
                p = "chatGPT"; t = document.querySelector("#history a[data-active]")?.textContent || t;
                res.push(...document.querySelectorAll("div[data-message-id]"));
            } else if (h.includes("grok.com")) {
                p = "grok"; res.push(...document.querySelectorAll("div.message-bubble"));
            } else if (h.includes("gemini.google.com")) {
                p = "gemini"; t = document.querySelector("conversations-list div.selected")?.textContent || t;
                const qs = document.querySelectorAll("user-query-content"), rs = document.querySelectorAll("model-response");
                for (let i = 0; i < qs.length; i++) { res.push(qs[i]); if (rs[i]) res.push(rs[i]); }
            } else if (h.includes("claude.ai")) {
                p = "claude"; res.push(...document.querySelectorAll('[data-testid="user-message"], .font-claude-response'));
            }
            return { res, p, title: sanitize(t), project: sanitize(this.getProject(p)) };
        },

        // scope: 'whole' = both sides, 'ai' = AI responses only.
        export: function(scope) {
            const { res, p, title, project } = this.getElements();
            if (!res.length) return;

            const ai = this.aiName[p] || "AI";

            // Header block, so the file itself records where it came from.
            let header = `# ${title}\n\n`;
            header += `**AI:** ${ai}  \n`;
            if (project) header += `**Project:** ${project}  \n`;
            header += `**Exported:** ${new Date().toISOString().slice(0, 10)}\n\n---\n`;

            let body = "";
            if (scope === 'ai') {
                body = res.reduce((a, x, i) => { if (i % 2 === 1) a += `\n${HtmlToMarkdown.to(x.innerHTML, p)}\n\n---\n`; return a; }, "");
            } else {
                body = res.reduce((a, x, i) => { if (i % 2 === 0 && res[i + 1]) a += `\n# Q:\n${HtmlToMarkdown.to(x.innerHTML, p)}\n\n# A:\n${HtmlToMarkdown.to(res[i + 1].innerHTML, p)}\n\n---\n`; return a; }, "");
            }

            const content = (header + body).replace(/&amp;/g, "&");
            const b = new Blob([content], { type: 'text/markdown' });

            // Filename: [Project] AI - Title.md
            let name = (project ? `[${project}] ` : "") + `${ai} - ${title}`;
            const u = URL.createObjectURL(b), a = document.createElement("a");
            a.href = u; a.download = `${name}.md`; document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(u); }, 0);
        }
    };

    GM_addStyle(`
        .ai-export-drag-box { position: fixed; z-index: 2147483646; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(28,28,30,0.85); backdrop-filter: blur(12px); color: #fff; border-radius: 100px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); cursor: move; user-select: none; border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px; font-family: system-ui; font-size: 14px; font-weight: 600; transition: transform 0.2s ease, opacity 0.2s; white-space: nowrap; }
        .ai-export-drag-box:hover { transform: scale(1.05); }
        .ai-export-menu-panel { position: absolute; width: max-content; min-width: 150px; background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); border-radius: 16px; padding: 6px; display: none; flex-direction: column; }
        .pos-bottom-right { bottom: calc(100% + 15px); right: 0; transform-origin: bottom right; animation: aiPopUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 -10px 50px rgba(0,0,0,0.2); }
        .pos-bottom-left { bottom: calc(100% + 15px); left: 0; transform-origin: bottom left; animation: aiPopUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 -10px 50px rgba(0,0,0,0.2); }
        .pos-top-right { top: calc(100% + 15px); right: 0; transform-origin: top right; animation: aiPopDown 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 10px 50px rgba(0,0,0,0.2); }
        .pos-top-left { top: calc(100% + 15px); left: 0; transform-origin: top left; animation: aiPopDown 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 10px 50px rgba(0,0,0,0.2); }
        @media (prefers-color-scheme: dark) {
            .ai-export-menu-panel { background: rgba(30,30,34,0.9); }
            .pos-bottom-right, .pos-bottom-left { box-shadow: 0 -10px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1); }
            .pos-top-right, .pos-top-left { box-shadow: 0 10px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1); }
        }
        @keyframes aiPopUp { 0% { opacity: 0; transform: scale(0.9) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes aiPopDown { 0% { opacity: 0; transform: scale(0.9) translateY(-10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .ai-export-menu-item { display: flex; align-items: center; padding: 12px 14px; background: transparent; border: none; border-radius: 10px; text-align: left; cursor: pointer; color: #333; font-size: 13px; font-weight: 500; transition: 0.15s ease; width: 100%; white-space: nowrap; }
        @media (prefers-color-scheme: dark) { .ai-export-menu-item { color: #eee; } }
        .ai-export-menu-item:hover { background: rgba(16,163,127,0.15); color: #10a37f; }
        .ai-export-menu-item.clicked { transform: scale(0.92); background: rgba(16,163,127,0.3); opacity: 0.7; }
    `);

    function init() {
        if (document.querySelector('.ai-export-drag-box')) return;
        const box = CommonUtil.createElement("div", { className: "ai-export-drag-box" });
        box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;pointer-events:none;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg><span>${exportLabel}</span></div>`;
        const menu = CommonUtil.createElement("div", { className: "ai-export-menu-panel" });
        // Two minimalist choices: the whole conversation, or just the AI's replies.
        [
            { scope: 'whole', label: 'Whole conversation' },
            { scope: 'ai', label: 'AI only' }
        ].forEach(({ scope, label }) => {
            const btn = CommonUtil.createElement("button", { className: "ai-export-menu-item", text: label });
            btn.onclick = (e) => {
                e.stopPropagation();
                btn.classList.add('clicked');
                setTimeout(() => {
                    btn.classList.remove('clicked');
                    Chat.export(scope);
                    menu.style.display = 'none';
                }, 200);
            };
            menu.appendChild(btn);
        });
        box.appendChild(menu);
        document.body.appendChild(box);
        const sX = GM_getValue('x', window.innerWidth - 160), sY = GM_getValue('y', window.innerHeight - 100);
        box.style.left = Math.max(0, Math.min(sX, window.innerWidth - 120)) + 'px'; box.style.top = Math.max(0, Math.min(sY, window.innerHeight - 60)) + 'px';
        let drag = false, moved = false, sX0, sY0, iL, iT;
        box.onmousedown = (e) => { drag = true; moved = false; sX0 = e.clientX; sY0 = e.clientY; iL = box.offsetLeft; iT = box.offsetTop; e.preventDefault(); };
        document.onmousemove = (e) => {
            if (!drag) return;
            const dx = e.clientX - sX0, dy = e.clientY - sY0;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            box.style.left = (iL + dx) + 'px'; box.style.top = (iT + dy) + 'px';
        };
        document.onmouseup = () => { if (drag && moved) { GM_setValue('x', box.offsetLeft); GM_setValue('y', box.offsetTop); } drag = false; };
        box.onclick = () => {
            if (!moved) {
                if (menu.style.display !== 'flex') {
                    const rect = box.getBoundingClientRect();
                    const isBottom = rect.top > window.innerHeight / 2;
                    const isRight = rect.left > window.innerWidth / 2;

                    menu.className = 'ai-export-menu-panel';
                    if (isBottom && isRight) menu.classList.add('pos-bottom-right');
                    else if (isBottom && !isRight) menu.classList.add('pos-bottom-left');
                    else if (!isBottom && isRight) menu.classList.add('pos-top-right');
                    else if (!isBottom && !isRight) menu.classList.add('pos-top-left');

                    menu.style.display = 'flex';
                } else {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener("click", (e) => { if (!box.contains(e.target)) menu.style.display = 'none'; });
    }

    if (typeof trustedTypes !== "undefined" && trustedTypes.defaultPolicy === null) {
        trustedTypes.createPolicy("default", { createHTML: s => s, createScriptURL: s => s, createScript: s => s });
    }
    setTimeout(init, 1000);
    setInterval(init, 3000);
})();
