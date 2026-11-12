// Fetches cross-origin console stylesheets (e.g. *.awsstatic.com) that the
// content script cannot read via cssRules. Only AWS static hosts are allowed.
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(awsstatic\.com|console\.aws\.amazon\.com|console\.aws)\//;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "fetch-css" || !ALLOWED.test(msg.href)) return;
  fetch(msg.href, { credentials: "omit" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => sendResponse({ text }))
    .catch(() => sendResponse({ text: "" }));
  return true; // async response
});

// Toolbar icon reflects the on/off switch: full colour when on, grey when off.
function syncIcon(enabled) {
  const suffix = enabled ? "" : "-off";
  chrome.action.setIcon({
    path: { 16: `icons/icon16${suffix}.png`, 32: `icons/icon32${suffix}.png` },
  });
  chrome.action.setTitle({ title: `AWS Blue Dark Mode (${enabled ? "on" : "off"})` });
}
const loadIcon = () => chrome.storage.sync.get({ enabled: true }, (v) => syncIcon(v.enabled));
chrome.runtime.onStartup.addListener(loadIcon);
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.enabled) syncIcon(c.enabled.newValue);
});

// Keyboard shortcut (default Alt+Shift+D / ⌥⇧D; rebind at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-restore") return;
  chrome.storage.sync.get({ enabled: true }, (v) => chrome.storage.sync.set({ enabled: !v.enabled }));
});

// Chrome doesn't re-run content scripts in tabs that were already open when
// the extension is installed or reloaded, so those tabs would keep the old
// version (or none). Inject the current one; it takes over from any old copy.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  loadIcon();
  if (reason !== "install" && reason !== "update") return;
  const { matches } = chrome.runtime.getManifest().content_scripts[0];
  const tabs = await chrome.tabs.query({ url: matches });
  for (const tab of tabs) {
    if (tab.id == null || tab.discarded) continue;
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] })
      .catch(() => { /* tab closed or not scriptable */ });
  }
});
