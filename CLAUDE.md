# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Extension called "Phrase Filter" that filters auction listing cards on specific auction sites (BidFTA and GovDeals) based on user-defined include/exclude phrases. The extension uses Manifest V3 and implements a content script architecture.

## Development Commands

### Extension Development Workflow
```bash
# Load extension for development:
# 1. Open chrome://extensions
# 2. Enable Developer mode  
# 3. Click "Load unpacked"
# 4. Select: /Users/rob/work/auction_ext/extension

# Test extension on supported sites:
# - https://www.bidfta.com/*
# - https://www.govdeals.com/*

# Debug: Check browser console for [PhraseFilter] logs
```

### Git Commands
```bash
# Standard git workflow (currently on main branch)
git status
git add .
git commit -m "message"
```

**Note**: This project has no npm dependencies, build scripts, or test frameworks. It's pure vanilla JavaScript for Chrome extension development.

## Architecture

### Core Components

**Content Script** (`extension/content.js`)
- Main filtering engine that runs on auction sites
- Hard-coded selectors per domain in `ITEM_SELECTOR_BY_DOMAIN` and `TITLE_SELECTOR_BY_DOMAIN`
- Phrase matching against listing titles (both text content and title attributes)
- Visual feedback: golden highlighting for "interested" phrases, blue overlay for "exclude" phrases
- Real-time filtering with MutationObserver
- Storage sync via Chrome Storage API

**Popup Interface** (`extension/popup.html`, `extension/popup.js`, `extension/popup.css`) 
- Tabbed interface for managing phrase filters (Add, Interested, Not Interested)
- Per-hostname rule management
- Real-time rule addition/removal with instant visual feedback

**Visual Styling** (`extension/styles.css`)
- `.phrase-filter-highlight`: Golden outline for matching "interested" phrases
- `.phrase-filter-excluded`: Blue overlay for "exclude" phrases (maintains clickability)

### Storage Format

Rules stored in `chrome.storage.sync` under key `phraseFilterRulesByHost`:
```json
{
  "phraseFilterRulesByHost": {
    "www.bidfta.com": {
      "includePhrases": ["dewalt", "milwaukee"],
      "excludePhrases": ["broken", "parts only"]
    }
  }
}
```

### Supported Sites

**BidFTA** (`bidfta.com`)
- Item selector: `div[role="button"][aria-label="Click to navigate to item details"]`
- Title selector: `h4`

**GovDeals** (`govdeals.com`) 
- Item selector: `div.card.card-search`
- Title selector: `.card-title a`

## Adding New Auction Sites

To support a new auction site:

1. **Update manifest permissions** in `extension/manifest.json`:
   ```json
   "host_permissions": ["https://newsite.com/*"],
   "content_scripts": [{"matches": ["https://newsite.com/*"]}]
   ```

2. **Add selectors** in `extension/content.js`:
   ```javascript
   const ITEM_SELECTOR_BY_DOMAIN = {
     "newsite.com": "selector-for-listing-cards"
   };
   
   const TITLE_SELECTOR_BY_DOMAIN = {
     "newsite.com": "selector-for-title-within-card" 
   };
   ```

3. **Test**: Visit the new site, open DevTools Console, and verify `[PhraseFilter]` logs show correct card detection.

## Key Implementation Details

- **Domain matching**: Uses registrable domain (e.g., `bidfta.com`) to match subdomains
- **Title text extraction**: Prioritizes `title` attribute over visible text for better matching
- **Accessibility**: Maintains ARIA attributes and keyboard navigation
- **Performance**: Uses MutationObserver for efficient DOM change detection
- **Visual feedback**: Highlighting doesn't hide elements, ensures clickability is preserved

## Debugging

- Browser console logs prefixed with `[PhraseFilter]`
- Check extension status in `chrome://extensions`
- Reload extension after code changes
- Use browser DevTools on target auction sites for testing