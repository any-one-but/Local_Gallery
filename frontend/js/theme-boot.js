/* Paint the theme the library last used before anything else runs, so the
   boot splash and the passcode screen -- both up before the library's own
   settings can be read -- are already in it. Written by
   applyColorSchemeFromOptions. */
(function () {
  try {
    // The Mac app hands over the look it saved to a file
    // (window.__LG_REMEMBERED_LOOK, written into this page by
    // electron/media.js) -- a file write is durable, where localStorage
    // can lose the last change on quit. Everywhere else, localStorage.
    var host = window.__LG_REMEMBERED_LOOK;
    var useHost = !!(host && typeof host === "object");
    var t = useHost ? host.theme : localStorage.getItem("lgAppTheme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute(
        "data-theme",
        t === "light" ? "graphite-light" : "retro90s-dark",
      );
      document.documentElement.style.colorScheme = t;
    }
    // The UI color tint and highlight, written by applyUiColorsFromOptions.
    var ui = useHost ? host : JSON.parse(localStorage.getItem("lgUiColors") || "null");
    var vars = ui && ui[t === "light" ? "light" : "dark"];
    if (vars)
      for (var name in vars)
        document.documentElement.style.setProperty(name, vars[name]);
    if (ui && ui.prism)
      document.documentElement.setAttribute("data-ui-prism", "");
  } catch (e) {}
})();
