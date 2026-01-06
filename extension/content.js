// Content script.
// Loads per-host rules from chrome.storage.sync and stays in sync as they change.
// Applies include/exclude phrase filtering based on selector:
// - include phrase match => highlight the card
// - exclude phrase match => apply a blue overlay (dim) the card (still clickable)
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
  "govdeals.com": "div.card.card-search",
};

/**
 * Hard-coded per-host title selectors.
 *
 * Values must select an element within the card whose text (or title attr) contains the listing title.
 */
const TITLE_SELECTOR_BY_DOMAIN = {
  // BidFTA: title is inside an <h4 ...>Title</h4> within the card.
  "bidfta.com": "h4",

  // GovDeals: title is inside <p class=\"card-title\"><a ...>Title</a></p>.
  "govdeals.com": ".card-title a",
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
 * @param {string} host
 */
function getItemSelectorForHost(host) {
  for (const [domain, selector] of Object.entries(ITEM_SELECTOR_BY_DOMAIN)) {
    if (!hostMatchesDomain(host, domain)) continue;
    const trimmed = (selector || "").trim();
    if (trimmed) return trimmed;
    break;
  }
  // NOTE: return not handled if selector not found
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

    /* Excluded cards: blue overlay, but keep content legible and clickable. */
    [${HIDDEN_ATTR}="1"] {
      position: relative !important;
    }

    [${HIDDEN_ATTR}="1"]::after {
      content: "" !important;
      position: absolute !important;
      inset: 0 !important;
      background: rgba(29, 78, 216, 0.75) !important;
      box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0.45) !important;
      pointer-events: none !important;
      border-radius: inherit !important;
    }
  `.trim();
  document.head.appendChild(style);
}

/**
 * Attempt to find the title element inside a card for the current host.
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
  // Prefer element title; fall back to visible text (sometimes visible text is shortened).
  // NOTE: this may eventually need to be more customizeable for a given host
  return (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
}

function setHidden(card, shouldHide) {
  // We no longer hide cards; we mark them as excluded so CSS can overlay them.
  // Overlay uses pointer-events: none so the card remains clickable.
  if (shouldHide) {
    card.setAttribute(HIDDEN_ATTR, "1");
  } else {
    card.removeAttribute(HIDDEN_ATTR);
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
 * Calculate true total cost for a bid including buyer's premium, freight, and sales tax.
 * @param {number} bidAmount - The bid amount in dollars
 * @returns {number} Total cost after all fees and taxes
 */
function calculateTrueBidTotal(bidAmount) {
  // Add 17.5% buyer's premium
  const afterPremium = bidAmount * 1.175;

  // Add freight charge: $0.25 if $5 or less, otherwise $1
  const freightCharge = bidAmount <= 5 ? 0.25 : 1.00;
  const subtotal = afterPremium + freightCharge;

  // Apply 9.5% sales tax
  const total = subtotal * 1.095;

  return total;
}

/**
 * Enhance bid buttons on BidFTA by adding true total cost in parentheses.
 * @param {Element} button
 */
function enhanceBidButton(button) {
  // Skip if already enhanced
  if (button.hasAttribute('data-phrasefilter-enhanced')) return;

  const bidAmount = parseFloat(button.getAttribute('data-bid'));
  if (isNaN(bidAmount)) return;

  const trueTotal = calculateTrueBidTotal(bidAmount);
  const originalText = button.textContent.trim();

  // Add true total in parentheses
  button.textContent = `${originalText} ($${trueTotal.toFixed(2)} total)`;
  button.setAttribute('data-phrasefilter-enhanced', '1');
}

/**
 * Find and enhance all bid buttons on the page (BidFTA only).
 */
function enhanceBidButtons() {
  // Only run on BidFTA
  if (!hostMatchesDomain(currentHost, 'bidfta.com')) return;

  const bidButtons = document.querySelectorAll('button[data-bid]');
  for (const button of bidButtons) {
    enhanceBidButton(button);
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

  // Also enhance bid buttons
  enhanceBidButtons();

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
