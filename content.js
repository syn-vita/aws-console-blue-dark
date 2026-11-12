// AWS Console – Blue Dark Mode
//
// The console uses Cloudscape design tokens. The new "one theme"
// (body.awsui-one-theme) remaps the neutral palette from blue-tinted grays
// (#0f141a, #161d26, #1b232d …) to warm near-blacks (#161512, #201e1b …).
// The previous "visual refresh" theme still ships in the same CSS, guarded by
// `.awsui-visual-refresh:not(.awsui-one-theme)`. This script finds those rules,
// re-targets them at `.awsui-one-theme`, and re-emits their --color-* tokens
// with !important. Token names are hashed per bundle, so everything is
// discovered at runtime instead of hard-coded.

(() => {
  const STYLE_ID = "aws-blue-dark-restore";
  const ONE_THEME_WHERE = /:where\(:not\(\.awsui-one-theme\):not\(\.awsui-one-theme \*\)\)/g;
  const fetchedText = new Map(); // href -> css text (cross-origin sheets)

  // Strategy A (older bundles): the blue theme is guarded by
  // `.awsui-visual-refresh:not(.awsui-one-theme)` → re-target at one-theme.
  const retarget = (sel) =>
    sel
      .replace(ONE_THEME_WHERE, "")
      .replace(/\.awsui-visual-refresh/g, "")
      .replace(/:not\(\.awsui-one-theme\)/g, ".awsui-one-theme");

  // Strategy B (newer bundles): the blue theme is the plain base rule and
  // `.awsui-one-theme …` rules override it → re-apply the base value.
  // `norm` maps a one-theme selector and its base selector to the same key.
  const normParts = (parts, strip) => [
    ...new Set(
      parts.map((part) => {
        const s = part.replace(strip, "").replace(/\s+/g, " ").trim();
        return s === "" || /^:not\(#\\9 ?\)$/.test(s) ? "body" : s;
      })
    ),
  ].sort().join(",");
  const norm = (sel) =>
    normParts(
      sel.replace(ONE_THEME_WHERE, "").replace(/:not\(\.awsui-one-theme\)/g, "").split(","),
      /\.awsui-one-theme\b/g
    );
  // Same element, minus the dark-mode qualifier (e.g. ".awsui-polaris-dark-mode" → "body").
  const lightKey = (key) => normParts(key.split(","), /\.awsui-polaris-dark-mode\b/g);
  const hasOneTheme = (sel) =>
    sel.replace(ONE_THEME_WHERE, "").replace(/:not\(\.awsui-one-theme\)/g, "").includes("awsui-one-theme");

  function collect(rules, acc) {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { collect(r.cssRules, acc); continue; }
      const sel = r.selectorText;
      if (!sel || !r.style) continue;

      if (sel.includes("awsui-visual-refresh")) {
        if (!sel.includes(":not(.awsui-one-theme)")) continue;
        const decls = [];
        for (const p of r.style) {
          if (!p.startsWith("--color-")) continue;
          decls.push(`${p}:${r.style.getPropertyValue(p).trim()} !important`);
          acc.restored.add(p);
        }
        if (decls.length) acc.rules.push(`${retarget(sel)}{${decls.join(";")}}`);
        continue;
      }

      const props = [];
      for (const p of r.style) if (p.startsWith("--color-")) props.push(p);
      if (!props.length) continue;

      if (hasOneTheme(sel)) {
        acc.oneTheme.push({ sel, props });
      } else {
        const key = norm(sel);
        let m = acc.base.get(key);
        if (!m) acc.base.set(key, (m = new Map()));
        for (const p of props) {
          m.set(p, r.style.getPropertyValue(p).trim());
          acc.knownProps.add(p);
        }
        if (sel.includes("polaris-dark-mode")) for (const p of props) acc.darkProps.add(p);
      }
    }
  }

  function sheetRules(sheet) {
    try {
      return sheet.cssRules;
    } catch {
      // Cross-origin (CDN) sheet: use text fetched by the service worker.
      const href = sheet.href;
      if (!href) return null;
      if (fetchedText.has(href)) {
        const text = fetchedText.get(href);
        if (!text) return null;
        try {
          const s = new CSSStyleSheet();
          s.replaceSync(text);
          return s.cssRules;
        } catch { return null; }
      }
      fetchedText.set(href, "");
      chrome.runtime.sendMessage({ type: "fetch-css", href }, (res) => {
        if (res && res.text) { fetchedText.set(href, res.text); forceRebuild = true; schedule(); }
      });
      return null;
    }
  }

  function build() {
    const acc = { rules: [], restored: new Set(), oneTheme: [], base: new Map(), darkProps: new Set(), knownProps: new Set() };
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID) continue;
      const rules = sheetRules(sheet);
      if (rules) collect(rules, acc);
    }
    // What the old theme resolved token `p` to on the element matched by `key`.
    const resolve = (key, p) => {
      const exact = acc.base.get(key);
      if (exact && exact.has(p)) return exact.get(p);
      // No dark-specific rule: the light base rule on the same element applied.
      const light = lightKey(key);
      const lb = light !== key && acc.base.get(light);
      if (lb && lb.has(p)) return lb.get(p);
      // No rule on this element at all: the token simply inherited (custom
      // properties inherit by default). Not on body, where there's no parent.
      if (light !== "body" && acc.knownProps.has(p)) return "inherit";
      return null;
    };

    const undo = [];
    for (const { sel, props } of acc.oneTheme) {
      const key = norm(sel);
      // A light-mode one-theme rule must not force a light base value over a
      // dark-mode base rule on the same element; the dark one-theme rule (if
      // any) handles that token instead.
      const lightRule = !sel.includes("polaris-dark-mode");
      const decls = [];
      for (const p of props) {
        if (acc.restored.has(p)) continue;
        if (lightRule && acc.darkProps.has(p)) continue;
        const v = resolve(key, p);
        if (v !== null) decls.push(`${p}:${v} !important`);
      }
      if (decls.length) undo.push(`${sel}{${decls.join(";")}}`);
    }
    // Several service bundles ship identical rules; dedupe the output,
    // keeping the last copy so cascade order is unchanged.
    return [...new Set(undo.concat(acc.rules).reverse())].reverse().join("\n");
  }

  // Sheets already inspected → whether they contain Cloudscape color tokens.
  const seen = new WeakMap();
  const isRelevant = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { if (isRelevant(r.cssRules)) return true; continue; }
      if (r.selectorText && r.selectorText.includes("awsui-") && r.style) {
        for (const p of r.style) if (p.startsWith("--color-")) return true;
      }
    }
    return false;
  };
  // True if a new token-bearing sheet appeared since the last build.
  function hasNewRelevantSheet() {
    let found = false;
    for (const sheet of document.styleSheets) {
      if (seen.has(sheet) || (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID)) continue;
      const rules = sheetRules(sheet);
      if (!rules) continue; // cross-origin, pending fetch → schedule() fires on arrival
      const rel = isRelevant(rules);
      seen.set(sheet, rel);
      if (rel) found = true;
    }
    return found;
  }

  function styleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
    }
    // Keep it last so it follows any late-loaded sheets.
    if (el !== document.documentElement.lastElementChild) document.documentElement.appendChild(el);
    return el;
  }

  const isDark = () => !!document.querySelector(".awsui-polaris-dark-mode");

  let enabled = true;
  let lastCss = "";

  // Cheap: only flips the <style> on/off. Runs on dark-mode toggles.
  function updateToggle() {
    const el = document.getElementById(STYLE_ID);
    // Only touch dark mode; light mode stays exactly as AWS ships it.
    if (el) el.disabled = !(enabled && isDark());
  }

  // Expensive: re-scans stylesheets. Runs when sheets are added.
  let forceRebuild = true;
  function apply() {
    const el = styleEl();
    if (hasNewRelevantSheet() || forceRebuild) {
      forceRebuild = false;
      const css = build();
      if (css !== lastCss) { el.textContent = css; lastCss = css; }
    }
    updateToggle();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  }

  chrome.storage.sync.get({ enabled: true }, (v) => { enabled = v.enabled; updateToggle(); });
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) { enabled = c.enabled.newValue; updateToggle(); }
  });

  // Dark-mode class lives on <html> or <body>; watch only those two.
  const classObserver = new MutationObserver(updateToggle);
  const watchClasses = (node) => node && classObserver.observe(node, { attributes: true, attributeFilter: ["class"] });
  watchClasses(document.documentElement);
  watchClasses(document.body);

  // New stylesheets (SPA route changes / lazy-loaded service bundles).
  new MutationObserver((muts) => {
    let changed = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeName === "BODY") { watchClasses(n); changed = true; }
        else if (n.nodeName === "LINK") { n.addEventListener("load", schedule, { once: true }); changed = true; }
        else if (n.nodeName === "STYLE" && n.id !== STYLE_ID) changed = true;
      }
    }
    if (changed) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  schedule();
})();
