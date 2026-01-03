// Content script.
// Loads per-host rules from chrome.storage.sync and stays in sync as they change.
// Applies include/exclude phrase filtering based on each item's <h4> text:
// - include phrase match => highlight the card
// - exclude phrase match => hide the card entirely

const STORAGE_KEY = "phraseFilterRulesByHost";

const HIGHLIGHT_ATTR = "data-phrasefilter-highlight";
const HIDDEN_ATTR = "data-phrasefilter-hidden";

/**
 * @typedef {Object} SiteRules
 * @property {string[]} [includePhrases]
 * @property {string[]} [excludePhrases]
 * @property {string}   [itemSelector]
 */

/**
 * @returns {SiteRules}
 */
function defaultSiteRules() {
  return {
    includePhrases: [],
    excludePhrases: [],
    itemSelector: ""
  };
}

function safeHostFromLocation() {
  try {
    return window.location.host || "";
  } catch {
    return "";
  }
}

async function loadRulesByHost() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const rulesByHost = result?.[STORAGE_KEY];
  return rulesByHost && typeof rulesByHost === "object" ? rulesByHost : {};
}

/**
 * Load rules for the current host.
 * @param {string} host
 * @returns {Promise<SiteRules>}
 */
async function loadSiteRules(host) {
  const rulesByHost = await loadRulesByHost();
  const siteRules = rulesByHost[host];
  return { ...defaultSiteRules(), ...(siteRules || {}) };
}

/**
 * Minimal logging helper. Keep logs easy to grep and silence later if desired.
 * @param {string} msg
 * @param {any} [extra]
 */
function log(msg, extra) {
  // eslint-disable-next-line no-console
  console.debug(`[PhraseFilter] ${msg}`, extra ?? "");
}

function normalizeText(s) {
  return (s || "").toString().trim().toLowerCase();
}

function normalizePhrases(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map(normalizeText).filter(Boolean);
}

function hasAnyPhrase(haystackLower, phrasesLower) {
  if (!haystackLower) return false;
  if (!phrasesLower || !phrasesLower.length) return false;
  return phrasesLower.some((p) => p && haystackLower.includes(p));
}

function injectHighlightCssOnce() {
  const id = "phrasefilter-style";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    [${HIGHLIGHT_ATTR}="1"] {
      outline: 3px solid #f59e0b !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25) !important;
    }
  `.trim();
  document.head.appendChild(style);
}

/**
 * Attempt to find the title element inside a card.
 * For bidfta cards, the title is in a <h4 ... title="...">...</h4>.
 * @param {Element} card
 * @returns {HTMLHeadingElement|null}
 */
function findTitleH4(card) {
  const h4 = card.querySelector("h4");
  if (!h4) return null;
  return /** @type {HTMLHeadingElement} */ (h4);
}

function getTitleTextFromCard(card) {
  const h4 = findTitleH4(card);
  if (!h4) return "";
  // Prefer visible text; fall back to title attribute.
  return (h4.textContent || h4.getAttribute("title") || "").trim();
}

function setHidden(card, shouldHide) {
  if (shouldHide) {
    card.style.display = "none";
    card.setAttribute(HIDDEN_ATTR, "1");
  } else {
    if (card.getAttribute(HIDDEN_ATTR) === "1") {
      card.style.display = "";
      card.removeAttribute(HIDDEN_ATTR);
    }
  }
}

function setHighlighted(card, shouldHighlight) {
  if (shouldHighlight) {
    card.setAttribute(HIGHLIGHT_ATTR, "1");
  } else {
    card.removeAttribute(HIGHLIGHT_ATTR);
  }
}

/**
 * Apply include/exclude rules to a single card.
 * Exclude wins over include (hide beats highlight).
 * @param {Element} card
 * @param {SiteRules} rules
 */
function applyRulesToCard(card, rules) {
  const titleLower = normalizeText(getTitleTextFromCard(card));
  if (!titleLower) {
    // If we can't determine a title, leave it alone.
    setHidden(card, false);
    setHighlighted(card, false);
    return;
  }

  const includePhrasesLower = normalizePhrases(rules.includePhrases);
  const excludePhrasesLower = normalizePhrases(rules.excludePhrases);

  const isExcluded = hasAnyPhrase(titleLower, excludePhrasesLower);
  if (isExcluded) {
    setHighlighted(card, false);
    setHidden(card, true);
    return;
  }

  const isIncluded = hasAnyPhrase(titleLower, includePhrasesLower);
  setHidden(card, false);
  setHighlighted(card, isIncluded);
}

/**
 * Apply rules to all items currently in the DOM.
 * @param {SiteRules} rules
 */
function applyRulesToPage(rules) {
  injectHighlightCssOnce();

  const selector = (rules.itemSelector || "").trim();

  // If no selector is configured, attempt a reasonable default for bidfta-like cards:
  // The card container in the example has role="button" and aria-label="Click to navigate to item details".
  const effectiveSelector =
    selector ||
    'div[role="button"][aria-label="Click to navigate to item details"]';

  const cards = Array.from(document.querySelectorAll(effectiveSelector));
  for (const card of cards) applyRulesToCard(card, rules);

  log("Applied rules", {
    host: currentHost,
    itemSelector: effectiveSelector,
    cardsSeen: cards.length,
    includeCount: (rules.includePhrases || []).length,
    excludeCount: (rules.excludePhrases || []).length
  });
}

/**
 * Observe DOM changes so newly loaded cards are filtered/highlighted.
 * @param {SiteRules} rules
 */
function startObserver(rules) {
  const observer = new MutationObserver((mutations) => {
    // Micro-optimization: only re-scan if nodes were added.
    let added = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        added = true;
        break;
      }
    }
    if (!added) return;

    applyRulesToPage(rules);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  return observer;
}

let currentHost = "";
let currentRules = defaultSiteRules();
let observerHandle = null;

/**
 * Called whenever rules change or the script initializes.
 */
function onRulesReady() {
  // Reset observer to ensure it uses current rules.
  if (observerHandle) observerHandle.disconnect();
  observerHandle = startObserver(currentRules);

  applyRulesToPage(currentRules);
}

async function init() {
  currentHost = safeHostFromLocation();
  if (!currentHost) {
    log("No host detected; skipping");
    return;
  }

  currentRules = await loadSiteRules(currentHost);
  onRulesReady();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    const changed = changes?.[STORAGE_KEY];
    if (!changed) return;

    const nextRulesByHost =
      changed.newValue && typeof changed.newValue === "object" ? changed.newValue : {};

    const nextSiteRules = nextRulesByHost[currentHost] || null;
    currentRules = { ...defaultSiteRules(), ...(nextSiteRules || {}) };

    onRulesReady();
  });
}

init();
