const STORAGE_KEY = "phraseFilterRulesByHost";

function normalizePhrase(s) {
  return (s || "").trim();
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function setActiveTab(tabId) {
  const tabIds = ["tabMain", "tabInterested", "tabNotInterested"];
  const panelIds = ["panelMain", "panelInterested", "panelNotInterested"];

  for (const id of tabIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute("aria-selected", id === tabId ? "true" : "false");
  }

  for (const id of panelIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden =
      id !== document.getElementById(tabId)?.getAttribute("aria-controls");
  }
}

async function getActiveTabHost() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const url = tab?.url || "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function loadAllRules() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const rulesByHost = result[STORAGE_KEY];
  if (rulesByHost && typeof rulesByHost === "object") return rulesByHost;
  return {};
}

async function saveAllRules(rulesByHost) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: rulesByHost });
}

function defaultSiteRules() {
  return {
    includePhrases: [],
    excludePhrases: [],
  };
}

function setStatus(text) {
  const el = document.getElementById("statusLabel");
  if (!el) return;
  el.textContent = text || "";
}

function renderPhraseList({ ul, phrases, onRemove }) {
  ul.innerHTML = "";
  if (!phrases.length) return;

  for (const phrase of phrases) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.className = "phrase";
    span.textContent = phrase;
    span.title = phrase;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => onRemove(phrase));

    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function refreshUI(host) {
  const hostLabel = document.getElementById("hostLabel");
  hostLabel.textContent = host || "(no active tab)";
  hostLabel.title = host || "";

  const rulesByHost = await loadAllRules();
  const siteRules = rulesByHost[host] || defaultSiteRules();

  renderPhraseList({
    ul: document.getElementById("includeList"),
    phrases: siteRules.includePhrases || [],
    onRemove: async (phrase) => {
      const all = await loadAllRules();
      const current = all[host] || defaultSiteRules();
      current.includePhrases = (current.includePhrases || []).filter(
        (p) => p !== phrase,
      );
      all[host] = current;
      await saveAllRules(all);
      setStatus("Updated include list");
      await refreshUI(host);
    },
  });

  renderPhraseList({
    ul: document.getElementById("excludeList"),
    phrases: siteRules.excludePhrases || [],
    onRemove: async (phrase) => {
      const all = await loadAllRules();
      const current = all[host] || defaultSiteRules();
      current.excludePhrases = (current.excludePhrases || []).filter(
        (p) => p !== phrase,
      );
      all[host] = current;
      await saveAllRules(all);
      setStatus("Updated exclude list");
      await refreshUI(host);
    },
  });

  const includeCount = (siteRules.includePhrases || []).length;
  const excludeCount = (siteRules.excludePhrases || []).length;
  if (host)
    setStatus(
      `Saved for ${host}: ${includeCount} include, ${excludeCount} exclude`,
    );
}

async function addPhrase({ host, kind, inputIdOverride }) {
  const inputId =
    inputIdOverride || (kind === "include" ? "includeInput" : "excludeInput");
  const input = document.getElementById(inputId);

  if (!input) {
    setStatus(`Missing input: ${inputId}`);
    return;
  }

  const phrase = normalizePhrase(input.value);
  if (!host) {
    setStatus("No active tab hostname found");
    return;
  }
  if (!phrase) return;

  const rulesByHost = await loadAllRules();
  const siteRules = rulesByHost[host] || defaultSiteRules();

  if (kind === "include") {
    siteRules.includePhrases = uniq([
      ...(siteRules.includePhrases || []),
      phrase,
    ]);
  } else {
    siteRules.excludePhrases = uniq([
      ...(siteRules.excludePhrases || []),
      phrase,
    ]);
  }

  rulesByHost[host] = siteRules;
  await saveAllRules(rulesByHost);

  input.value = "";
  setStatus(`Added to ${kind} list`);
  await refreshUI(host);
}

async function resetSite({ host }) {
  if (!host) {
    setStatus("No active tab hostname found");
    return;
  }

  const rulesByHost = await loadAllRules();
  if (rulesByHost[host]) {
    delete rulesByHost[host];
    await saveAllRules(rulesByHost);
  }
  setStatus("Reset site rules");
  await refreshUI(host);
}

document.addEventListener("DOMContentLoaded", async () => {
  const host = await getActiveTabHost();
  await refreshUI(host);

  const tabMain = document.getElementById("tabMain");
  const tabInterested = document.getElementById("tabInterested");
  const tabNotInterested = document.getElementById("tabNotInterested");

  if (tabMain) tabMain.addEventListener("click", () => setActiveTab("tabMain"));
  if (tabInterested)
    tabInterested.addEventListener("click", () =>
      setActiveTab("tabInterested"),
    );
  if (tabNotInterested)
    tabNotInterested.addEventListener("click", () =>
      setActiveTab("tabNotInterested"),
    );

  setActiveTab("tabMain");

  document.getElementById("addIncludeBtn").addEventListener("click", () => {
    addPhrase({ host, kind: "include" });
  });
  document.getElementById("addExcludeBtn").addEventListener("click", () => {
    addPhrase({ host, kind: "exclude" });
  });

  document.getElementById("includeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPhrase({ host, kind: "include" });
  });
  document.getElementById("excludeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPhrase({ host, kind: "exclude" });
  });

  const addIncludeBtnTab = document.getElementById("addIncludeBtnTab");
  if (addIncludeBtnTab) {
    addIncludeBtnTab.addEventListener("click", () => {
      addPhrase({ host, kind: "include", inputIdOverride: "includeInputTab" });
    });
  }

  const addExcludeBtnTab = document.getElementById("addExcludeBtnTab");
  if (addExcludeBtnTab) {
    addExcludeBtnTab.addEventListener("click", () => {
      addPhrase({ host, kind: "exclude", inputIdOverride: "excludeInputTab" });
    });
  }

  const includeInputTab = document.getElementById("includeInputTab");
  if (includeInputTab) {
    includeInputTab.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        addPhrase({ host, kind: "include", inputIdOverride: "includeInputTab" });
    });
  }

  const excludeInputTab = document.getElementById("excludeInputTab");
  if (excludeInputTab) {
    excludeInputTab.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        addPhrase({ host, kind: "exclude", inputIdOverride: "excludeInputTab" });
    });
  }

  document.getElementById("resetSiteBtn").addEventListener("click", () => {
    resetSite({ host });
  });

  // If rules change (e.g., another popup instance), keep UI in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!changes[STORAGE_KEY]) return;
    refreshUI(host);
  });
});
