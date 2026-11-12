const toggle = document.getElementById("toggle");
const note = document.getElementById("note");
const noteText = document.getElementById("note-text");

// aws: active tab is an AWS console page; dark: console is in dark mode.
const state = { enabled: true, aws: false, dark: false };

function render() {
  const theme = state.aws && !state.dark ? "light" : state.enabled ? "blue" : "black";
  document.body.dataset.theme = theme;
  toggle.setAttribute("aria-checked", String(state.enabled));

  if (state.aws && !state.dark) {
    noteText.textContent = "AWS is currently set to light mode. This only applies in dark mode.";
    note.hidden = false;
  } else if (!state.aws) {
    noteText.textContent = "Open the AWS Console to see it in action.";
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

toggle.addEventListener("click", () => {
  state.enabled = !state.enabled;
  render();
  chrome.storage.sync.set({ enabled: state.enabled });
});

// Resolve both pieces of state before showing anything, so the popup never
// flashes the wrong theme.
const enabledReady = new Promise((resolve) =>
  chrome.storage.sync.get({ enabled: true }, (v) => { state.enabled = v.enabled; resolve(); })
);

const tabReady = new Promise((resolve) => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || tab.id == null) return resolve();
    chrome.tabs.sendMessage(tab.id, { type: "get-state" }, { frameId: 0 }, (res) => {
      // lastError means no content script here, i.e. not an AWS console tab.
      if (!chrome.runtime.lastError && res) {
        state.aws = true;
        state.dark = res.dark;
      }
      resolve();
    });
  });
});

// Show the keyboard shortcut, if one is bound (users can rebind or clear it).
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === "toggle-restore");
  if (!cmd || !cmd.shortcut) return;
  document.getElementById("shortcut").textContent = cmd.shortcut;
  document.getElementById("hint").hidden = false;
});

// Keep the switch in sync if the shortcut is used while the popup is open.
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.enabled) { state.enabled = c.enabled.newValue; render(); }
});

const show = () => { render(); document.body.classList.add("ready"); };
Promise.all([enabledReady, tabReady]).then(show);
setTimeout(show, 300); // never stay hidden if the tab doesn't answer
