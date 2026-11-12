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
