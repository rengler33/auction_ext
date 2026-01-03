// Content script.
// Loads per-host rules from chrome.storage.sync and stays in sync as they change.
// Applies include/exclude phrase filtering based on each item's <h4> text:
// - include phrase match => highlight the card
// - exclude phrase match => hide the card entirely
//
// Item card selection is hard-coded per host (no user-provided selectors).

const STORAGE_KEY = "phraseFilterRulesByHost";

const HIGHLIGHT_ATTR = "data-phrasefilter-highlight";
const HIDDEN_ATTR = "data-phrasefilter-hidden";

/**
 * Hard-coded per-host item selectors.
 *
 * Notes:
 * - Keys are registrable domains (e.g. "bidfta.com"), and matching supports subdomains.
 * - Values must select the listing/card root elements (the "cards") that contain the title.
 *
 * Add/adjust selectors here as new auction sites are supported.
 */
const ITEM_SELECTOR_BY_DOMAIN = {
  // BidFTA: card container has role="button" and a stable aria-label in our observed DOM.
  "bidfta.com":
    'div[role="button"][aria-label="Click to navigate to item details"]',

  // GovDeals: listing card root is a Bootstrap-ish card used in search results.
  // Your provided sample outer element: <div class="card card-search card-search-minh ...">...</div>
  "govdeals.com": "div.card.card-search",
};

const DEFAULT_ITEM_SELECTOR =
  'div[role="button"][aria-label="Click to navigate to item details"]';

/**
 * Hard-coded per-host title selectors.
 *
 * Values must select an element within the card whose text (or title attr) contains the listing title.
 */
const TITLE_SELECTOR_BY_DOMAIN = {
  // BidFTA: title is inside an <h4 ...>Title</h4> within the card.
  "bidfta.com": "h4",

  // GovDeals: title is inside <p class=\"card-title\"><a ...>Title</a></p>.
  "govdeals.com": ".card-title a, .card-title",
};

/**
 * @typedef {Object} SiteRules
 * @property {string[]} [includePhrases]
 * @property {string[]} [excludePhrases]
 */

/**
 * @returns {SiteRules}
 */
function defaultSiteRules() {
  return {
    includePhrases: [],
    excludePhrases: [],
  };
}

function safeHostFromLocation() {
  try {
    return window.location.host || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} host
 * @param {string} domain
 */
function hostMatchesDomain(host, domain) {
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Get the hard-coded item selector for a host (supports subdomains).
 * Falls back to DEFAULT_ITEM_SELECTOR if no mapping exists or the mapping is blank.
 * @param {string} host
 */
function getItemSelectorForHost(host) {
  for (const [domain, selector] of Object.entries(ITEM_SELECTOR_BY_DOMAIN)) {
    if (!hostMatchesDomain(host, domain)) continue;
    const trimmed = (selector || "").trim();
    if (trimmed) return trimmed;
    break;
  }
  return DEFAULT_ITEM_SELECTOR;
}

/**
 * Get the hard-coded title selector for a host (supports subdomains).
 * Returns "" if no mapping exists or the mapping is blank.
 * @param {string} host
 */
function getTitleSelectorForHost(host) {
  for (const [domain, selector] of Object.entries(TITLE_SELECTOR_BY_DOMAIN)) {
    if (!hostMatchesDomain(host, domain)) continue;
    return (selector || "").trim();
  }
  return "";
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
 * Attempt to find the title element inside a card for the current host.
 * This is strict-by-host (no cross-site fallback).
 * @param {string} host
 * @param {Element} card
 * @returns {HTMLElement|null}
 */
function findTitleElementForHost(host, card) {
  const titleSelector = getTitleSelectorForHost(host);
  if (!titleSelector) return null;

  const el = card.querySelector(titleSelector);
  if (!el) return null;

  return /** @type {HTMLElement} */ (el);
}

function getTitleTextFromCard(card) {
  const titleEl = findTitleElementForHost(currentHost, card);
  if (!titleEl) return "";
  // Prefer visible text; fall back to title attribute.
  return (titleEl.textContent || titleEl.getAttribute("title") || "").trim();
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

  const effectiveSelector = getItemSelectorForHost(currentHost);

  const cards = Array.from(document.querySelectorAll(effectiveSelector));
  for (const card of cards) applyRulesToCard(card, rules);

  log("Applied rules", {
    host: currentHost,
    effectiveSelector,
    cardsSeen: cards.length,
    includeCount: (rules.includePhrases || []).length,
    excludeCount: (rules.excludePhrases || []).length,
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
    subtree: true,
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
      changed.newValue && typeof changed.newValue === "object"
        ? changed.newValue
        : {};

    const nextSiteRules = nextRulesByHost[currentHost] || null;
    currentRules = { ...defaultSiteRules(), ...(nextSiteRules || {}) };

    onRulesReady();
  });
}

init();
