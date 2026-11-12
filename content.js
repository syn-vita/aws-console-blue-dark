// AWS Console – Blue Dark Mode
//
// The console uses Cloudscape design tokens. The new "one theme"
// (body.awsui-one-theme) remaps the neutral palette from blue-tinted grays
// (#0f141a, #161d26, #1b232d …) to warm near-blacks (#161512, #201e1b …).
// The previous theme still ships in the same CSS. This script finds it and
// re-emits its --color-* tokens with !important. Token names are hashed per
// bundle, so everything is discovered at runtime instead of hard-coded.
//
// To avoid a black flash on navigation, the generated CSS is cached in the
// page's localStorage and injected synchronously at document_start, before
// the first paint; it is then refreshed as stylesheets load.

(() => {
  const STYLE_ID = "aws-blue-dark-restore";
  // Bump the version when the generated CSS format changes, so old (larger)
  // rules aren't merged back in forever.
  const CACHE_KEY = "awsBlueDark.v3";
  const OLD_CACHE_KEYS = ["awsBlueDark.v2"];
  const CACHE_MAX_CHARS = 2_000_000;
  const ONE_THEME_WHERE = /:where\(:not\(\.awsui-one-theme\):not\(\.awsui-one-theme \*\)\)/g;
  const fetchedText = new Map(); // href -> css text (cross-origin sheets)

  // ---------- cache (sync, so it can apply before first paint) ----------

  const readCache = () => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
  };
  const writeCache = (data) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota / blocked */ }
  };
  try { for (const k of OLD_CACHE_KEYS) localStorage.removeItem(k); } catch { /* blocked */ }
  const cache = readCache();
  let enabled = cache.enabled !== false;
  let lastDark = cache.dark === true;
  let cachedLines = Array.isArray(cache.lines) ? cache.lines : [];

  // localStorage is per origin, so each region (us-east-1, eu-west-1 …) would
  // start empty. Extension storage is shared by all of them: it seeds a new
  // origin's cache and collects rules from every console page visited.
  const SHARED_KEY = "awsBlueDark.shared.v2";
  try { chrome.storage.local.remove("awsBlueDark.shared"); } catch { /* extension reloaded */ }
  // Lines from `extra` that `base` lacks go first; `base` keeps the last word.
  const mergeLines = (extra, base) => {
    const have = new Set(base);
    const merged = extra.filter((l) => !have.has(l)).concat(base);
    return merged.join("\n").length > CACHE_MAX_CHARS ? base : merged;
  };

  // ---------- selector helpers ----------

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

  // ---------- per-sheet scan (cached, so rebuilds are cheap) ----------

  // sheet -> { n: rule count at scan time, part }
  const scanned = new WeakMap();

  function scanRules(rules, part) {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { scanRules(r.cssRules, part); continue; }
      const sel = r.selectorText;
      if (!sel || !r.style) continue;

      const vals = [];
      for (const p of r.style) if (p.startsWith("--color-")) vals.push([p, r.style.getPropertyValue(p).trim()]);
      if (!vals.length) continue;

      if (sel.includes("awsui-visual-refresh")) {
        if (!sel.includes(":not(.awsui-one-theme)")) continue;
        for (const [p] of vals) part.restored.push(p);
        part.legacy.push({ sel: retarget(sel), vals });
      } else if (hasOneTheme(sel)) {
        part.oneTheme.push({ sel, vals });
      } else {
        part.base.push({ key: norm(sel), dark: sel.includes("polaris-dark-mode"), vals });
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
      try {
        chrome.runtime.sendMessage({ type: "fetch-css", href }, (res) => {
          if (res && res.text) { fetchedText.set(href, res.text); refresh(); }
        });
      } catch { /* extension reloaded */ }
      return null;
    }
  }

  // Returns parts for all sheets; `changed` is true if any sheet is new or grew.
  function scanAll() {
    const parts = [];
    let changed = false;
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID) continue;
      const rules = sheetRules(sheet);
      if (!rules) continue;
      const prev = scanned.get(sheet);
      if (prev && prev.n === rules.length) { parts.push(prev.part); continue; }
      const part = { legacy: [], restored: [], oneTheme: [], base: [] };
      scanRules(rules, part);
      scanned.set(sheet, { n: rules.length, part });
      parts.push(part);
      changed = true;
    }
    return { parts, changed };
  }

  function build(parts) {
    const legacy = [];
    const restored = new Set();
    const oneTheme = [];
    const base = new Map();
    const darkProps = new Set();
    const knownProps = new Set();
    for (const part of parts) {
      legacy.push(...part.legacy);
      for (const p of part.restored) restored.add(p);
      oneTheme.push(...part.oneTheme);
      for (const { key, dark, vals } of part.base) {
        let m = base.get(key);
        if (!m) base.set(key, (m = new Map()));
        for (const [p, v] of vals) {
          m.set(p, v);
          knownProps.add(p);
          if (dark) darkProps.add(p);
        }
      }
    }

    // What the old theme resolved token `p` to on the element matched by `key`.
    const resolve = (key, p) => {
      const exact = base.get(key);
      if (exact && exact.has(p)) return exact.get(p);
      // No dark-specific rule: the light base rule on the same element applied.
      const light = lightKey(key);
      const lb = light !== key && base.get(light);
      if (lb && lb.has(p)) return lb.get(p);
      // No rule on this element at all: the token simply inherited (custom
      // properties inherit by default). Not on body, where there's no parent.
      if (light !== "body" && knownProps.has(p)) return "inherit";
      return null;
    };

    // Rules to emit, in order: undo (strategy B) first, then legacy (A).
    const emit = [];
    for (const { sel, vals } of oneTheme) {
      const key = norm(sel);
      // A light-mode one-theme rule must not force a light base value over a
      // dark-mode base rule on the same element; the dark one-theme rule (if
      // any) handles that token instead.
      const lightRule = !sel.includes("polaris-dark-mode");
      const decls = [];
      for (const [p] of vals) {
        if (restored.has(p)) continue;
        if (lightRule && darkProps.has(p)) continue;
        const v = resolve(key, p);
        if (v !== null) decls.push([p, v]);
      }
      if (decls.length) emit.push({ sel, decls });
    }
    for (const { sel, vals } of legacy) emit.push({ sel, decls: vals });

    // Drop tokens the new theme already sets to the same thing. A token is
    // dropped only if, for every selector the new theme sets it on, we'd
    // restore the identical value on the same selector (and nowhere else),
    // so the page resolves the same with or without our rule. Most semantic
    // tokens qualify (e.g. both point at var(--color-neutral-850-…)) once the
    // palette itself is restored.
    const CONFLICT = Symbol("conflict");
    const byProp = (rules, keyOf, entriesOf) => {
      const out = new Map();
      for (const r of rules) {
        const key = keyOf(r);
        for (const [p, v] of entriesOf(r)) {
          let m = out.get(p);
          if (!m) out.set(p, (m = new Map()));
          const prev = m.get(key);
          m.set(key, prev === undefined || prev === v ? v : CONFLICT);
        }
      }
      return out;
    };
    const ours = byProp(emit, (r) => norm(r.sel), (r) => r.decls);
    const theirs = byProp(oneTheme, (r) => norm(r.sel), (r) => r.vals);
    const same = (p) => {
      const a = ours.get(p);
      const b = theirs.get(p);
      if (!a || !b || a.size !== b.size) return false;
      for (const [k, v] of a) if (v === CONFLICT || b.get(k) !== v) return false;
      return true;
    };
    const dropped = new Set();
    for (const p of ours.keys()) if (same(p)) dropped.add(p);

    const lines = [];
    for (const { sel, decls } of emit) {
      const kept = decls.filter(([p]) => !dropped.has(p)).map(([p, v]) => `${p}:${v} !important`);
      if (kept.length) lines.push(`${sel}{${kept.join(";")}}`);
    }
    // Several service bundles ship identical rules; dedupe the output,
    // keeping the last copy so cascade order is unchanged.
    return [...new Set(lines.reverse())].reverse();
  }

  // ---------- style element ----------

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

  const isDark = () => {
    if (!document.body) return lastDark; // before <body> exists, trust the cache
    return !!document.querySelector(".awsui-polaris-dark-mode");
  };

  // ---------- lifecycle ----------

  // When the extension is reloaded, the old copy of this script keeps running
  // in open tabs but can no longer talk to the extension. A fresh copy is
  // injected by the service worker; the old one must stop touching the page.
  let alive = true;
  const observers = [];
  function teardown() {
    if (!alive) return;
    alive = false;
    for (const o of observers) o.disconnect();
  }
  const orphaned = () => {
    try { return !chrome.runtime || !chrome.runtime.id; } catch { return true; }
  };
  const active = () => {
    if (alive && orphaned()) teardown();
    return alive;
  };

  // Cheap: only flips the <style> on/off. Runs on dark-mode toggles.
  function updateToggle() {
    if (!active()) return;
    const el = document.getElementById(STYLE_ID);
    const dark = isDark();
    // Only touch dark mode; light mode stays exactly as AWS ships it.
    if (el) el.disabled = !(enabled && dark);
    if (document.body && dark !== lastDark) { lastDark = dark; persist(); }
  }

  let currentCss = "";
  function setCss(lines) {
    const css = lines.join("\n");
    if (css === currentCss) return;
    currentCss = css;
    styleEl().textContent = css;
  }

  function persist() {
    writeCache({ enabled, dark: lastDark, lines: cachedLines });
  }

  // Push this page's rules into the shared cache (debounced; merges so other
  // tabs' rules aren't lost).
  let sharedTimer = 0;
  function persistShared() {
    clearTimeout(sharedTimer);
    sharedTimer = setTimeout(() => {
      if (!active()) return;
      chrome.storage.local.get(SHARED_KEY, (v) => {
        const shared = (v && v[SHARED_KEY]) || {};
        const lines = mergeLines(Array.isArray(shared.lines) ? shared.lines : [], cachedLines);
        chrome.storage.local.set({ [SHARED_KEY]: { dark: lastDark, lines } });
      });
    }, 1000);
  }

  // ---------- refresh ----------

  function refresh() {
    if (!active()) return;
    const { parts, changed } = scanAll();
    if (changed) {
      const fresh = build(parts);
      // Keep rules for bundles seen on other pages so their first paint is
      // already blue; current-page rules go last so they win.
      const merged = mergeLines(cachedLines, fresh);
      const grew = merged.length !== cachedLines.length || merged.some((l, i) => l !== cachedLines[i]);
      cachedLines = merged;
      setCss(merged);
      if (grew) { persist(); persistShared(); }
    } else {
      styleEl();
    }
    updateToggle();
  }

  // Coalesce bursts of mutations into one refresh per microtask.
  let queued = false;
  function queueRefresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; refresh(); });
  }

  // ---------- boot ----------

  // 0) Tell any older copy in this frame to stand down, then listen for the
  //    next one. Dispatching first means this copy doesn't stop itself.
  document.dispatchEvent(new Event("aws-blue-dark:takeover"));
  document.addEventListener("aws-blue-dark:takeover", teardown);

  // 1) Paint from cache immediately.
  if (cachedLines.length) setCss(cachedLines);
  updateToggle();

  // 2) Pull in rules other regions have seen. On a first visit to a region
  //    this is what paints the page blue before its stylesheets are scanned.
  try {
    chrome.storage.local.get(SHARED_KEY, (v) => {
      const shared = v && v[SHARED_KEY];
      if (!active() || !shared || !Array.isArray(shared.lines)) return;
      const firstVisit = cachedLines.length === 0;
      const merged = mergeLines(shared.lines, cachedLines);
      if (merged.length === cachedLines.length) return;
      cachedLines = merged;
      if (firstVisit && !document.body) lastDark = shared.dark === true;
      setCss(merged);
      persist();
      updateToggle();
    });
  } catch { /* extension reloaded */ }

  // 3) Sync the on/off switch with extension storage.
  try {
    chrome.storage.sync.get({ enabled: true }, (v) => {
      if (v.enabled !== enabled) { enabled = v.enabled; persist(); }
      updateToggle();
    });
    chrome.storage.onChanged.addListener((c) => {
      if (c.enabled) { enabled = c.enabled.newValue; persist(); updateToggle(); }
    });
    // Let the popup theme itself after the console (light / dark).
    if (window === window.top) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === "get-state") sendResponse({ dark: isDark(), enabled });
      });
    }
  } catch { /* extension reloaded */ }

  // 4) Dark-mode class lives on <html> or <body>; watch only those two.
  const classObserver = new MutationObserver(updateToggle);
  observers.push(classObserver);
  const watchClasses = (node) => node && classObserver.observe(node, { attributes: true, attributeFilter: ["class"] });
  watchClasses(document.documentElement);
  watchClasses(document.body);

  // 5) Refresh as stylesheets arrive (SPA route changes, lazy service bundles).
  const sheetObserver = new MutationObserver((muts) => {
    let changed = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeName === "BODY") { watchClasses(n); changed = true; }
        else if (n.nodeName === "LINK") { n.addEventListener("load", refresh, { once: true }); changed = true; }
        else if (n.nodeName === "STYLE" && n.id !== STYLE_ID) changed = true;
      }
    }
    if (changed) queueRefresh();
  });
  sheetObserver.observe(document.documentElement, { childList: true, subtree: true });
  observers.push(sheetObserver);

  document.addEventListener("DOMContentLoaded", refresh, { once: true });
  window.addEventListener("load", refresh, { once: true });
  queueRefresh();
})();
