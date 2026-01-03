# Phrase Filter (Chrome Extension) — Scaffold

This directory contains a minimal Chrome Extension (Manifest V3) scaffold for storing per-site phrase lists. The actual logic to hide/highlight listing cards is intentionally not implemented yet.

## What’s included

- `manifest.json`: MV3 manifest configured for `https://www.bidfta.com/*`
- `popup.html` / `popup.js`: Popup UI to manage phrase lists **per hostname**
- `content.js`: Content script scaffold that loads rules for the current hostname and logs them
- `styles.css`: CSS classes (`.phrase-filter-hidden`, `.phrase-filter-highlight`, etc.) to be applied later
- `icons/`: Placeholder directory for extension icons (you’ll need to add PNGs)

## Storage format (per site)

Rules are stored in `chrome.storage.sync` under the key `phraseFilterRulesByHost`.

Conceptually:

```/dev/null/example-storage.json#L1-17
{
  "phraseFilterRulesByHost": {
    "www.bidfta.com": {
      "includePhrases": ["dewalt", "milwaukee"],
      "excludePhrases": ["broken", "parts only"],
      "itemSelector": ""
    }
  }
}
```

## Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `auction_ext/extension`

Then:
- Visit `https://www.bidfta.com/items`
- Click the extension icon to open the popup
- Add phrases to the Include/Exclude lists

## Notes / troubleshooting

- **Icons:** The manifest references:
  - `icons/icon16.png`
  - `icons/icon32.png`
  - `icons/icon48.png`
  - `icons/icon128.png`

  If these files don’t exist yet, Chrome may warn. Either add simple placeholder PNGs or remove the `icons` block from `manifest.json`.

- **Current behavior:** The content script only logs loaded rules (open DevTools → Console on the page to see `[PhraseFilter]` logs). No DOM modifications happen yet.

## Next step (when you’re ready)

Once we inspect BidFTA’s listing card DOM:
- Set a stable per-site `itemSelector`
- Implement scanning + matching + applying `.phrase-filter-hidden` / `.phrase-filter-highlight` classes
