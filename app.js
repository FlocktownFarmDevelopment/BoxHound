/**
 * Add-On Item Checker — Flocktown Farm
 *
 * Parses Farmigo Labels CSV to let packing employees quickly find
 * which boxes contain a specific add-on store item.
 */

// =============================================
// Constants & Category Definitions
// =============================================

/** Add-on item category tags found in Farmigo CSV */
const ADDON_CATEGORIES = {
  CHEESE:  { label: 'Cheese',    css: 'cat-cheese',  color: '#fbbf24' },
  COLD:    { label: 'Cold',      css: 'cat-cold',    color: '#60a5fa' },
  DRY:     { label: 'Dry',       css: 'cat-dry',     color: '#a78bfa' },
  FRUIT:   { label: 'Fruit',     css: 'cat-fruit',   color: '#fb923c' },
  MEAT:    { label: 'Meat',      css: 'cat-meat',    color: '#f87171' },
  SHROOMS: { label: 'Mushrooms', css: 'cat-shrooms', color: '#c084fc' },
  HATS:    { label: 'Hats/Merch',css: 'cat-hats',    color: '#f472b6' },
  MERCH:   { label: 'Merch',     css: 'cat-hats',    color: '#f472b6' },
  OTHER:   { label: 'Other',     css: 'cat-other',   color: '#94a3b8' },
};

/**
 * Non-add-on item patterns — these are CSA produce swap selections
 * and recurring subscription items, NOT add-on store purchases.
 */
const PRODUCE_SWAP_PREFIXES = [
  '[E ', '[E-', '[F ', '[F-', '[G ', '[G-', '[H ', '[H-',
  '[I ', '[I-', '[J ', '[J-', '[K ', '[K-', '[L ', '[L-',
  '[M ', '[M-', '[N ', '[N-',
];

const SHARE_PATTERNS = [
  /\d+\s+(Small|Half|Full|Large|Family)\s+Share/i,
  /Balthazar Bread Share/i,
  /Gallon Milk Share/i,
  /Dozen Egg Share/i,
];

// =============================================
// State
// =============================================
let parsedData = [];        // Array of member objects
let addonIndex = new Map(); // itemName → [{ member, qty, category }]
let allAddonItems = [];     // Sorted unique addon item names
let activeItem = null;      // Currently selected item
let currentSort = 'route';
let pinnedItems = [];       // Array of { itemName, boxes: [{member, qty}] }

// Manifest Generator State
let manifestData = new Map();   // routeName → { members: [], date: string }
let currentRoute = 'all';       // Currently selected route
let currentMode = 'addon';      // 'addon', 'manifest', or 'labels'

// Label Maker State
let labelMembers = [];                   // Parsed members for label generation
let swapZoneAssignments = new Map();     // englishName → { letter, spanishName }

// =============================================
// DOM References
// =============================================
const dom = {
  uploadSection:    () => document.getElementById('uploadSection'),
  uploadZone:       () => document.getElementById('uploadZone'),
  fileInput:        () => document.getElementById('fileInput'),
  uploadBtn:        () => document.getElementById('uploadBtn'),
  searchSection:    () => document.getElementById('searchSection'),
  searchInput:      () => document.getElementById('searchInput'),
  clearSearch:      () => document.getElementById('clearSearch'),
  autocompleteDropdown: () => document.getElementById('autocompleteDropdown'),
  itemChips:        () => document.getElementById('itemChips'),
  categoryTabs:     () => document.getElementById('categoryTabs'),
  resultsArea:      () => document.getElementById('resultsArea'),
  resultsPlaceholder: () => document.getElementById('resultsPlaceholder'),
  resultsHeader:    () => document.getElementById('resultsHeader'),
  resultTitle:      () => document.getElementById('resultTitle'),
  resultCount:      () => document.getElementById('resultCount'),
  resultsList:      () => document.getElementById('resultsList'),
  sortSelect:       () => document.getElementById('sortSelect'),
  headerStats:      () => document.getElementById('headerStats'),
  statMembers:      () => document.getElementById('statMembers'),
  statAddons:       () => document.getElementById('statAddons'),
  statBoxes:        () => document.getElementById('statBoxes'),
  fileInfoBar:      () => document.getElementById('fileInfoBar'),
  fileName:         () => document.getElementById('fileName'),
  fileDate:         () => document.getElementById('fileDate'),
  changeFileBtn:    () => document.getElementById('changeFileBtn'),
  pinBtn:           () => document.getElementById('pinBtn'),
  pinnedBar:        () => document.getElementById('pinnedBar'),
  pinnedChips:      () => document.getElementById('pinnedChips'),
  pinnedCount:      () => document.getElementById('pinnedCount'),
  pinnedClearBtn:   () => document.getElementById('pinnedClearBtn'),
  pinnedExportBtn:  () => document.getElementById('pinnedExportBtn'),
  // Manifest mode
  manifestUploadZone:  () => document.getElementById('manifestUploadZone'),
  manifestFileInput:   () => document.getElementById('manifestFileInput'),
  manifestUploadBtn:   () => document.getElementById('manifestUploadBtn'),
  manifestSection:     () => document.getElementById('manifestSection'),
  manifestUploadSection: () => document.getElementById('manifestUploadSection'),
  manifestFileInfoBar: () => document.getElementById('manifestFileInfoBar'),
  manifestFileName:    () => document.getElementById('manifestFileName'),
  manifestFileDate:    () => document.getElementById('manifestFileDate'),
  manifestChangeFileBtn: () => document.getElementById('manifestChangeFileBtn'),
  routeSelect:         () => document.getElementById('routeSelect'),
  manifestTableContainer: () => document.getElementById('manifestTableContainer'),
  downloadManifestBtn: () => document.getElementById('downloadManifestBtn'),
  downloadAllBtn:      () => document.getElementById('downloadAllBtn'),
  exportPdfBtn:       () => document.getElementById('exportPdfBtn'),
  exportAllPdfsBtn:   () => document.getElementById('exportAllPdfsBtn'),
  manifestStatsContainer: () => document.getElementById('manifestStatsContainer'),
  // Label Maker mode
  labelUploadZone:      () => document.getElementById('labelUploadZone'),
  labelFileInput:       () => document.getElementById('labelFileInput'),
  labelUploadBtn:       () => document.getElementById('labelUploadBtn'),
  labelSection:         () => document.getElementById('labelSection'),
  labelUploadSection:   () => document.getElementById('labelUploadSection'),
  labelFileInfoBar:     () => document.getElementById('labelFileInfoBar'),
  labelFileName:        () => document.getElementById('labelFileName'),
  labelFileDate:        () => document.getElementById('labelFileDate'),
  labelChangeFileBtn:   () => document.getElementById('labelChangeFileBtn'),
  labelStatsContainer:  () => document.getElementById('labelStatsContainer'),
  labelPreviewContainer:() => document.getElementById('labelPreviewContainer'),
  printLabelsBtn:       () => document.getElementById('printLabelsBtn'),
  zoneModal:            () => document.getElementById('zoneModal'),
  zoneModalClose:       () => document.getElementById('zoneModalClose'),
  zoneItemsList:        () => document.getElementById('zoneItemsList'),
  zoneApplyBtn:         () => document.getElementById('zoneApplyBtn'),
};

// =============================================
// CSV Parsing
// =============================================

/**
 * Parse a Farmigo labels CSV string into structured member data.
 * Handles quoted fields with internal commas and newlines.
 */
function parseCSV(csvText) {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  const firstNameIdx   = headers.indexOf('First Name');
  const lastNameIdx    = headers.indexOf('Last Name');
  const itemsIdx       = headers.indexOf('Items');
  const routeIdx       = headers.indexOf('Route');
  const pickupSiteIdx  = headers.indexOf('Pickup Site');
  const dateIdx        = headers.indexOf('Date');
  const addr1Idx       = headers.indexOf('Address Line 1');
  const addr2Idx       = headers.indexOf('Address Line 2');
  const cityIdx        = headers.indexOf('City');
  const stateIdx       = headers.indexOf('State');
  const zipIdx         = headers.indexOf('Zip Code');
  const phoneIdx       = headers.indexOf('Primary Phone');
  const emailIdx       = headers.indexOf('Email');
  const commentsIdx    = headers.indexOf('Comments');

  const members = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const firstName = (row[firstNameIdx] || '').trim();
    const lastName  = (row[lastNameIdx] || '').trim();
    if (!firstName && !lastName) continue;

    const rawItems = (row[itemsIdx] || '').trim();
    const items = parseItems(rawItems);

    members.push({
      firstName,
      lastName,
      email:      (row[emailIdx] || '').trim(),
      items,
      route:      (row[routeIdx] || '').trim(),
      pickupSite: (row[pickupSiteIdx] || '').trim(),
      date:       (row[dateIdx] || '').trim(),
      address1:   (row[addr1Idx] || '').trim(),
      address2:   (row[addr2Idx] || '').trim(),
      city:       (row[cityIdx] || '').trim(),
      state:      (row[stateIdx] || '').trim(),
      zip:        (row[zipIdx] || '').trim(),
      phone:      (row[phoneIdx] || '').trim(),
      comments:   (row[commentsIdx] || '').trim(),
      boxNumber:  0, // assigned after parsing
    });
  }

  // Assign box numbers per route
  assignBoxNumbers(members);

  return members;
}

/**
 * Assign sequential box numbers within each delivery route.
 *
 * Farm Pick-up routes get #1 for all members (shared on-farm pickup).
 * Delivery routes (Friday 01, Friday 02, etc.) get sequential numbers
 * starting at #1, matching the physical label print order from Farmigo.
 *
 * Members at the same pickup site (community drop site) share the same
 * box number, since they're all in one stack at the same delivery stop.
 */
function assignBoxNumbers(members) {
  // Track per-route: a counter and a map of pickupSite → assigned box number
  const routeState = {};

  for (const member of members) {
    const route = member.route;

    // Farm pick-up members all get box #1
    if (/farm pick-?up/i.test(route)) {
      member.boxNumber = 1;
      member.isFarmPickup = true;
      continue;
    }

    member.isFarmPickup = false;

    // Initialize route tracking if needed
    if (!routeState[route]) {
      routeState[route] = { counter: 0, siteNumbers: {} };
    }

    const state = routeState[route];
    const site = member.pickupSite;

    // If this pickup site already has a box number, reuse it
    if (state.siteNumbers[site] != null) {
      member.boxNumber = state.siteNumbers[site];
    } else {
      // New stop — assign next sequential number
      state.counter++;
      state.siteNumbers[site] = state.counter;
      member.boxNumber = state.counter;
    }
  }
}

/**
 * RFC 4180-ish CSV row parser.
 * Handles quoted fields containing commas, newlines, and escaped quotes.
 */
function parseCSVRows(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        current.push(field);
        field = '';
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        i++;
        if (current.some(f => f.trim())) rows.push(current);
        current = [];
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  current.push(field);
  if (current.some(f => f.trim())) rows.push(current);

  return rows;
}

/**
 * Parse the Items column from a Farmigo label.
 * Items are separated by @@@ and can contain various prefixes:
 *   - [CHEESE], [COLD], [DRY], [FRUIT], [MEAT], [SHROOMS], [HATS] → Add-on store items
 *   - [E-...], [F-...], etc.  → CSA produce swap selections
 *   - ###XXXXXX[...]           → Color-coded subscriptions (eggs)
 *   - ___                      → Quantity multiplier prefix
 *   - "1 Small Share", etc.    → Share type
 */
function parseItems(rawItems) {
  // Split on @@@ separator
  const parts = rawItems.split('@@@').map(s => s.trim()).filter(Boolean);
  const items = [];

  for (const part of parts) {
    const parsed = parseSingleItem(part);
    if (parsed) items.push(parsed);
  }

  return items;
}

/**
 * Parse a single item string and classify it.
 */
function parseSingleItem(raw) {
  if (!raw) return null;

  // Strip leading ___ (quantity indicator in Farmigo)
  let cleaned = raw.replace(/^___+/, '').trim();

  // Strip color codes like ###FF00FF
  cleaned = cleaned.replace(/^###[0-9A-Fa-f]{6}/, '').trim();

  // Extract quantity — first number in the string
  let qty = 1;
  const qtyMatch = cleaned.match(/^(\d+)\s+/);
  if (qtyMatch) {
    qty = parseInt(qtyMatch[1], 10);
  }

  // Determine category
  const category = identifyCategory(cleaned);

  // Clean up the item name
  let name = cleaned;

  // Remove [CATEGORY] prefix for add-on items
  for (const cat of Object.keys(ADDON_CATEGORIES)) {
    const bracketPrefix = `[${cat}]`;
    if (name.toUpperCase().includes(bracketPrefix)) {
      name = name.replace(new RegExp(`\\[${cat}\\]`, 'i'), '').trim();
      break;
    }
  }

  // Remove leading quantity
  name = name.replace(/^\d+\s+/, '').trim();

  // For produce swaps, extract the English name after ']'
  if (category === 'produce') {
    const bracketEnd = name.indexOf(']');
    if (bracketEnd !== -1) {
      name = name.substring(bracketEnd + 1).trim();
      // Remove leading quantity again
      name = name.replace(/^\d+\s+/, '').trim();
    }
  }

  // Remove produce bracket prefix for display
  if (category === 'produce') {
    const m = cleaned.match(/\]\s*\d*\s*(.*)/);
    if (m) name = m[1].trim();
  }

  return {
    raw,
    name,
    qty,
    category, // 'CHEESE', 'COLD', etc., or 'produce', 'share', 'subscription'
  };
}

/**
 * Identify what category an item belongs to.
 */
function identifyCategory(itemStr) {
  const upper = itemStr.toUpperCase();

  // Check add-on store categories (whitespace-tolerant inside brackets)
  for (const cat of Object.keys(ADDON_CATEGORIES)) {
    const pattern = new RegExp(`\\[\\s*${cat}\\s*\\]`, 'i');
    if (pattern.test(upper)) return cat;
  }

  // Check if it's a produce swap (letter-prefix bracket)
  for (const prefix of PRODUCE_SWAP_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) return 'produce';
  }

  // Check if it starts with a produce-style bracket (e.g. [F-DOCENA...)
  if (/^\[/.test(itemStr)) {
    // If it matches a known produce pattern, call it produce
    // Otherwise check if the bracket content matches an add-on cat
    return 'produce';
  }

  // Check subscription/share items
  for (const pat of SHARE_PATTERNS) {
    if (pat.test(itemStr)) return 'share';
  }

  // Remaining items that start with a number (like "1 Balthazar Bread Share")
  if (/^\d/.test(itemStr)) {
    // Check if it's a subscription
    if (/bread share|milk share|egg share/i.test(itemStr)) return 'subscription';
    return 'share';
  }

  return 'other';
}

// =============================================
// Data Indexing
// =============================================

/**
 * Build an index of add-on store items → member boxes.
 */
function buildAddonIndex(members) {
  const index = new Map();

  for (const member of members) {
    for (const item of member.items) {
      // Only index add-on store items
      if (!ADDON_CATEGORIES[item.category]) continue;

      const key = item.name;
      if (!index.has(key)) {
        index.set(key, {
          category: item.category,
          members: [],
        });
      }
      index.get(key).members.push({
        member,
        qty: item.qty,
      });
    }
  }

  return index;
}

/**
 * Get sorted unique add-on item names.
 */
function getSortedAddonItems(index) {
  return Array.from(index.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

// =============================================
// UI Rendering
// =============================================

/**
 * Render stats in the header.
 */
function renderStats() {
  const membersWithAddons = new Set();
  for (const [, data] of addonIndex) {
    for (const { member } of data.members) {
      membersWithAddons.add(member.email || `${member.firstName} ${member.lastName}`);
    }
  }

  const blanks = findBlankLabels();

  dom.statMembers().textContent = parsedData.length;
  dom.statAddons().textContent = allAddonItems.length;
  dom.statBoxes().textContent = membersWithAddons.size;
  document.getElementById('statBlanks').textContent = blanks.length;
  dom.headerStats().style.display = 'flex';
}

/**
 * Find members with "blank" labels — no produce swaps and no add-on store items.
 * Their label only shows a share size and/or subscription shares (eggs, milk, bread).
 */
function findBlankLabels() {
  return parsedData.filter(member => {
    return member.items.every(item =>
      item.category === 'share' || item.category === 'subscription'
    );
  });
}

/**
 * Toggle the blank labels view in the results area.
 */
function toggleBlankLabels() {
  const btn = document.getElementById('blankLabelsBtn');
  const isActive = btn.classList.contains('active');

  if (isActive) {
    // Deactivate — restore previous view
    btn.classList.remove('active');
    dom.resultsHeader().style.display = 'none';
    dom.resultsList().innerHTML = '';
    dom.resultsPlaceholder().style.display = 'flex';
    return;
  }

  // Activate — show blank labels
  btn.classList.add('active');

  // Clear any active item selection
  activeItem = null;
  dom.searchInput().value = '';
  dom.clearSearch().style.display = 'none';
  document.querySelectorAll('.item-chip').forEach(c => c.classList.remove('active'));
  hideAutocomplete();

  const blanks = findBlankLabels();

  // Sort by route, then box number
  blanks.sort((a, b) => {
    const rA = a.isFarmPickup ? 0 : parseRouteNumber(a.route);
    const rB = b.isFarmPickup ? 0 : parseRouteNumber(b.route);
    if (rA !== rB) return rA - rB;
    return (a.boxNumber || 0) - (b.boxNumber || 0);
  });

  // Update header
  dom.resultsPlaceholder().style.display = 'none';
  dom.resultsHeader().style.display = 'flex';
  dom.resultTitle().textContent = 'Blank Labels';
  dom.resultCount().textContent = `${blanks.length} member${blanks.length !== 1 ? 's' : ''} with no swaps or add-ons`;
  dom.pinBtn().style.display = 'none';

  // Render cards
  const list = dom.resultsList();
  list.innerHTML = '';

  for (const member of blanks) {
    const card = document.createElement('div');
    card.className = 'result-card';

    const boxLabel = member.isFarmPickup
      ? '<span class="card-box-number farm-pickup">Farm Pickup</span>'
      : `<span class="card-box-number">#${member.boxNumber}</span>`;

    const shareItems = member.items
      .filter(it => it.category === 'share' || it.category === 'subscription')
      .map(it => `<span class="card-item-tag"><span>${escapeHtml(it.name)}</span></span>`)
      .join('');

    card.innerHTML = `
      <div class="card-main">
        <div class="card-name-row">
          ${boxLabel}
          <span class="card-name">${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</span>
        </div>
        <div class="card-address">${escapeHtml(member.address1)}${member.city ? ', ' + escapeHtml(member.city) : ''}</div>
        <div class="card-items">${shareItems || '<span class="card-item-tag" style="font-style:italic;">No items</span>'}</div>
      </div>
      <div class="card-right">
        <span class="card-route">${escapeHtml(member.route)}</span>
      </div>
    `;

    list.appendChild(card);
  }
}

/**
 * Render add-on item chips for quick selection.
 */
function renderItemChips(filterCat = 'all') {
  const container = dom.itemChips();
  container.innerHTML = '';

  const filtered = filterCat === 'all'
    ? allAddonItems
    : allAddonItems.filter(name => addonIndex.get(name).category === filterCat);

  for (const itemName of filtered) {
    const data = addonIndex.get(itemName);
    const catInfo = ADDON_CATEGORIES[data.category] || {};
    const count = data.members.length;

    const chip = document.createElement('button');
    chip.className = 'item-chip' + (activeItem === itemName ? ' active' : '');
    chip.innerHTML = `
      <span class="chip-dot ${catInfo.css || 'cat-other'}"></span>
      <span>${escapeHtml(itemName)}</span>
      <span class="chip-count">${count}</span>
    `;
    chip.addEventListener('click', () => selectItem(itemName));
    container.appendChild(chip);
  }
}

/**
 * Render category filter tabs.
 */
function renderCategoryTabs() {
  const tabsContainer = dom.categoryTabs();
  tabsContainer.innerHTML = '';
  tabsContainer.style.display = 'flex';

  // Collect which categories actually have items
  const activeCats = new Set();
  for (const [, data] of addonIndex) {
    activeCats.add(data.category);
  }

  // "All" tab
  const allTab = document.createElement('button');
  allTab.className = 'cat-tab active';
  allTab.dataset.cat = 'all';
  allTab.textContent = `All (${allAddonItems.length})`;
  allTab.addEventListener('click', () => filterByCategory('all'));
  tabsContainer.appendChild(allTab);

  // Category tabs
  for (const [cat, info] of Object.entries(ADDON_CATEGORIES)) {
    if (!activeCats.has(cat)) continue;

    const count = allAddonItems.filter(n => addonIndex.get(n).category === cat).length;
    const tab = document.createElement('button');
    tab.className = 'cat-tab';
    tab.dataset.cat = cat;
    tab.textContent = `${info.label} (${count})`;
    tab.addEventListener('click', () => filterByCategory(cat));
    tabsContainer.appendChild(tab);
  }
}

/**
 * Filter item chips by category.
 */
function filterByCategory(cat) {
  // Update active tab
  document.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });

  renderItemChips(cat);
}

/**
 * Select an item and show matching boxes.
 */
function selectItem(itemName) {
  activeItem = itemName;

  // Deactivate blank labels view if active
  document.getElementById('blankLabelsBtn').classList.remove('active');

  // Update search input
  dom.searchInput().value = itemName;
  dom.clearSearch().style.display = 'block';

  // Update chip highlighting
  document.querySelectorAll('.item-chip').forEach(chip => {
    const chipText = chip.querySelector('span:nth-child(2)').textContent;
    chip.classList.toggle('active', chipText === itemName);
  });

  renderResults(itemName);
  updatePinButtonState();
}

/**
 * Render results for a given item search.
 */
function renderResults(searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    dom.resultsPlaceholder().style.display = 'flex';
    dom.resultsHeader().style.display = 'none';
    dom.resultsList().innerHTML = '';
    activeItem = null;
    document.querySelectorAll('.item-chip').forEach(c => c.classList.remove('active'));
    return;
  }

  const query = searchTerm.trim().toLowerCase();

  // Find all matching add-on items (fuzzy match on item name)
  const matchingItems = [];
  for (const [itemName, data] of addonIndex) {
    if (itemName.toLowerCase().includes(query)) {
      matchingItems.push({ itemName, ...data });
    }
  }

  // Collect all unique members who have any matching item
  const memberMap = new Map(); // key → { member, matchedItems: [{name, qty, category}] }

  for (const match of matchingItems) {
    for (const { member, qty } of match.members) {
      const key = member.email || `${member.firstName} ${member.lastName}`;
      if (!memberMap.has(key)) {
        memberMap.set(key, { member, matchedItems: [] });
      }
      memberMap.get(key).matchedItems.push({
        name: match.itemName,
        qty,
        category: match.category,
      });
    }
  }

  let results = Array.from(memberMap.values());

  // Sort
  results = sortResults(results, currentSort);

  // Update header
  dom.resultsPlaceholder().style.display = 'none';
  dom.resultsHeader().style.display = 'flex';

  const matchLabel = matchingItems.length === 1
    ? `"${matchingItems[0].itemName}"`
    : `${matchingItems.length} items matching "${escapeHtml(searchTerm)}"`;

  dom.resultTitle().innerHTML = `Boxes containing ${matchLabel}`;
  dom.resultCount().textContent = `${results.length} box${results.length !== 1 ? 'es' : ''}`;

  // Render cards
  const list = dom.resultsList();
  list.innerHTML = '';

  if (results.length === 0) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">📦</div>
        <h3>No boxes found</h3>
        <p>No boxes contain an add-on item matching "${escapeHtml(searchTerm)}"</p>
      </div>
    `;
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const { member, matchedItems } = results[i];
    const card = createResultCard(member, matchedItems, i);
    list.appendChild(card);
  }
}

/**
 * Create a result card DOM element.
 */
function createResultCard(member, matchedItems, index) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

  // Get all add-on items for this member (not just matched)
  const allMemberAddons = member.items.filter(
    it => ADDON_CATEGORIES[it.category]
  );

  // Build item tags
  const matchedNames = new Set(matchedItems.map(m => m.name));
  let tagsHtml = '';

  for (const addon of allMemberAddons) {
    const isMatch = matchedNames.has(addon.name);
    const catInfo = ADDON_CATEGORIES[addon.category] || {};
    tagsHtml += `
      <span class="card-item-tag ${isMatch ? 'matched' : ''}">
        ${addon.qty > 1 ? `<span class="card-item-qty">${addon.qty}×</span>` : ''}
        ${escapeHtml(addon.name)}
      </span>
    `;
  }

  // Determine share type
  const share = member.items.find(it => it.category === 'share');
  const shareText = share ? share.raw.replace(/^___+/, '').replace(/^###[0-9A-Fa-f]{6}/, '').trim() : '';

  // Address
  const addrParts = [member.address1, member.address2, member.city, member.state, member.zip]
    .filter(Boolean);
  const address = addrParts.join(', ');

  // Box number display — the key identifier for the packing employee
  const boxNum = member.boxNumber || 0;
  const boxLabel = member.isFarmPickup
    ? 'Farm Pickup'
    : `#${boxNum}`;

  card.innerHTML = `
    <div class="card-main">
      <div class="card-name-row">
        <span class="card-box-number${member.isFarmPickup ? ' farm-pickup' : ''}">${boxLabel}</span>
        <span class="card-name">${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</span>
      </div>
      <div class="card-address">${escapeHtml(address)}</div>
      <div class="card-items">${tagsHtml}</div>
    </div>
    <div class="card-right">
      <span class="card-route">
        ${escapeHtml(member.route)}
      </span>
      ${shareText ? `<span class="card-share">${escapeHtml(shareText)}</span>` : ''}
    </div>
  `;

  return card;
}

/**
 * Sort results array.
 */
function sortResults(results, sortBy) {
  return results.sort((a, b) => {
    switch (sortBy) {
      case 'route': {
        // Farm pickups sort first (route number 0)
        const rA = a.member.isFarmPickup ? 0 : parseRouteNumber(a.member.route);
        const rB = b.member.isFarmPickup ? 0 : parseRouteNumber(b.member.route);
        if (rA !== rB) return rA - rB;
        // Within same route, sort by box number
        const bA = a.member.boxNumber || 0;
        const bB = b.member.boxNumber || 0;
        if (bA !== bB) return bA - bB;
        return a.member.lastName.localeCompare(b.member.lastName);
      }
      case 'name':
        return (a.member.lastName + a.member.firstName)
          .localeCompare(b.member.lastName + b.member.firstName);
      case 'city':
        return (a.member.city || '').localeCompare(b.member.city || '');
      default:
        return 0;
    }
  });
}

/**
 * Extract numeric route number for sorting.
 */
function parseRouteNumber(route) {
  const m = route.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

/**
 * HTML-escape a string for safe insertion.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================
// Pinned Items
// =============================================

/**
 * Pin the currently selected item's results for later export.
 */
function pinCurrentItem() {
  if (!activeItem) return;

  // Don't pin duplicates
  if (pinnedItems.some(p => p.itemName === activeItem)) return;

  // Get boxes for this item
  const data = addonIndex.get(activeItem);
  if (!data) return;

  pinnedItems.push({
    itemName: activeItem,
    boxes: data.members.map(({ member, qty }) => ({ member, qty })),
  });

  renderPinnedBar();
  updatePinButtonState();
}

/**
 * Unpin a specific item.
 */
function unpinItem(itemName) {
  pinnedItems = pinnedItems.filter(p => p.itemName !== itemName);
  renderPinnedBar();
  updatePinButtonState();
}

/**
 * Clear all pinned items.
 */
function clearAllPinned() {
  pinnedItems = [];
  renderPinnedBar();
  updatePinButtonState();
}

/**
 * Render the pinned items bar.
 */
function renderPinnedBar() {
  const bar = dom.pinnedBar();
  const chipsContainer = dom.pinnedChips();

  if (pinnedItems.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'block';
  dom.pinnedCount().textContent = pinnedItems.length;

  let html = '';
  for (const pin of pinnedItems) {
    html += `
      <div class="pinned-chip" data-item="${escapeHtml(pin.itemName)}">
        <span>${escapeHtml(pin.itemName)}</span>
        <span class="pinned-chip-count">${pin.boxes.length}</span>
        <button class="pinned-chip-remove" data-item="${escapeHtml(pin.itemName)}" title="Remove">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;
  }

  chipsContainer.innerHTML = html;

  // Attach remove handlers
  chipsContainer.querySelectorAll('.pinned-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      unpinItem(btn.dataset.item);
    });
  });
}

/**
 * Update the pin button to reflect whether the current item is already pinned.
 */
function updatePinButtonState() {
  const btn = dom.pinBtn();
  if (!btn) return;

  const isPinned = activeItem && pinnedItems.some(p => p.itemName === activeItem);

  if (isPinned) {
    btn.classList.add('pinned');
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M9.5 1.5L14.5 6.5L8 13L3 13L3 8L9.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="currentColor" opacity="0.3"/>
        <path d="M3 13L6.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Pinned
    `;
  } else {
    btn.classList.remove('pinned');
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M9.5 1.5L14.5 6.5L8 13L3 13L3 8L9.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M3 13L6.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Pin
    `;
  }
}

/**
 * Export all pinned items as a CSV file.
 *
 * Format matches the original Numbers spreadsheet:
 *   - Row 0: Header with item names
 *   - Each column lists boxes for that item
 *   - Box format: "Route #BoxNum LastName, FirstName"
 */
function exportPinnedCSV() {
  if (pinnedItems.length === 0) return;

  // Build sorted box lists for each pinned item
  const columns = pinnedItems.map(pin => {
    const sorted = [...pin.boxes].sort((a, b) => {
      const rA = a.member.isFarmPickup ? 0 : parseRouteNumber(a.member.route);
      const rB = b.member.isFarmPickup ? 0 : parseRouteNumber(b.member.route);
      if (rA !== rB) return rA - rB;
      return (a.member.boxNumber || 0) - (b.member.boxNumber || 0);
    });

    return {
      header: pin.itemName,
      rows: sorted.map(({ member, qty }) => {
        const label = member.isFarmPickup
          ? `Farm Pickup #1 ${member.lastName}, ${member.firstName}`
          : `${member.route} #${member.boxNumber} ${member.lastName}, ${member.firstName}`;
        return qty > 1 ? `${label} (x${qty})` : label;
      }),
    };
  });

  // Find the max number of rows across all columns
  const maxRows = Math.max(...columns.map(c => c.rows.length));

  // Build CSV content
  let csv = '';

  // Header row
  csv += columns.map(c => csvEscape(c.header)).join(',') + '\n';

  // Data rows
  for (let i = 0; i < maxRows; i++) {
    const row = columns.map(c => csvEscape(c.rows[i] || ''));
    csv += row.join(',') + '\n';
  }

  // Build filename
  const dateStr = parsedData[0]?.date || 'export';
  const cleanDate = dateStr.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const filename = `addon_items_check_${cleanDate}.csv`;

  // Chrome: use File System Access API (async, shows Save dialog)
  if (window.showSaveFilePicker) {
    (async () => {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'CSV file',
            accept: { 'text/csv': ['.csv'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write('\ufeff' + csv);
        await writable.close();
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Export failed:', err);
        }
      }
    })();
    return;
  }

  // Safari / Firefox fallback
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Escape a value for CSV output.
 */
function csvEscape(val) {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// =============================================
// Autocomplete / Typeahead Search
// =============================================

let searchDebounceTimer = null;
let acActiveIndex = -1;       // Currently highlighted suggestion index
let acFilteredItems = [];     // Current suggestion list

/**
 * Handle typing in the search input — show autocomplete suggestions.
 * Results are only rendered when a specific item is selected.
 */
function handleSearchInput(e) {
  const val = e.target.value;
  dom.clearSearch().style.display = val ? 'block' : 'none';

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (!val.trim()) {
      hideAutocomplete();
      renderResults('');
      activeItem = null;
      document.querySelectorAll('.item-chip').forEach(c => c.classList.remove('active'));
      return;
    }

    showAutocompleteSuggestions(val.trim());
  }, 80);
}

/**
 * Show autocomplete suggestions matching the typed query.
 */
function showAutocompleteSuggestions(query) {
  const dropdown = dom.autocompleteDropdown();
  const lowerQuery = query.toLowerCase();

  // Filter matching items
  acFilteredItems = allAddonItems.filter(name =>
    name.toLowerCase().includes(lowerQuery)
  );

  acActiveIndex = -1;

  if (acFilteredItems.length === 0) {
    dropdown.innerHTML = `<div class="ac-empty">No add-on items matching "${escapeHtml(query)}"</div>`;
    dropdown.classList.add('visible');
    return;
  }

  // Build suggestion rows
  let html = '';
  for (let i = 0; i < acFilteredItems.length; i++) {
    const itemName = acFilteredItems[i];
    const data = addonIndex.get(itemName);
    const catInfo = ADDON_CATEGORIES[data.category] || {};
    const catLabel = catInfo.label || 'Other';
    const count = data.members.length;

    // Highlight the matching portion of the name
    const highlighted = highlightMatch(itemName, lowerQuery);

    html += `
      <div class="ac-item" data-index="${i}" data-item="${escapeHtml(itemName)}">
        <span class="ac-dot ${catInfo.css || 'cat-other'}"></span>
        <span class="ac-name">${highlighted}</span>
        <span class="ac-cat">${catLabel}</span>
        <span class="ac-count">${count} box${count !== 1 ? 'es' : ''}</span>
      </div>
    `;
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('visible');

  // Attach click handlers to each suggestion
  dropdown.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('click', () => {
      commitSelection(el.dataset.item);
    });
  });
}

/**
 * Highlight the query portion within a string, preserving original casing.
 */
function highlightMatch(text, lowerQuery) {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return escapeHtml(text);

  const before = text.substring(0, idx);
  const match = text.substring(idx, idx + lowerQuery.length);
  const after = text.substring(idx + lowerQuery.length);

  return escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

/**
 * Commit a selected item — update the search input, hide dropdown, show results.
 */
function commitSelection(itemName) {
  dom.searchInput().value = itemName;
  dom.clearSearch().style.display = 'block';
  hideAutocomplete();
  selectItem(itemName);
}

/**
 * Hide the autocomplete dropdown.
 */
function hideAutocomplete() {
  const dropdown = dom.autocompleteDropdown();
  dropdown.classList.remove('visible');
  dropdown.innerHTML = '';
  acActiveIndex = -1;
  acFilteredItems = [];
}

/**
 * Handle keyboard navigation within the autocomplete dropdown.
 */
function handleSearchKeydown(e) {
  const dropdown = dom.autocompleteDropdown();
  if (!dropdown.classList.contains('visible') || acFilteredItems.length === 0) {
    // Escape still clears
    if (e.key === 'Escape') {
      dom.searchInput().value = '';
      dom.clearSearch().style.display = 'none';
      hideAutocomplete();
      renderResults('');
      activeItem = null;
      document.querySelectorAll('.item-chip').forEach(c => c.classList.remove('active'));
    }
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      acActiveIndex = Math.min(acActiveIndex + 1, acFilteredItems.length - 1);
      updateActiveAcItem();
      break;

    case 'ArrowUp':
      e.preventDefault();
      acActiveIndex = Math.max(acActiveIndex - 1, 0);
      updateActiveAcItem();
      break;

    case 'Enter':
      e.preventDefault();
      if (acActiveIndex >= 0 && acActiveIndex < acFilteredItems.length) {
        commitSelection(acFilteredItems[acActiveIndex]);
      } else if (acFilteredItems.length === 1) {
        // Auto-select if only one match
        commitSelection(acFilteredItems[0]);
      }
      break;

    case 'Escape':
      e.preventDefault();
      hideAutocomplete();
      break;

    case 'Tab':
      // Tab selects highlighted item or first item
      if (acFilteredItems.length > 0) {
        e.preventDefault();
        const idx = acActiveIndex >= 0 ? acActiveIndex : 0;
        commitSelection(acFilteredItems[idx]);
      }
      break;
  }
}

/**
 * Update visual highlighting of the active autocomplete item.
 */
function updateActiveAcItem() {
  const dropdown = dom.autocompleteDropdown();
  dropdown.querySelectorAll('.ac-item').forEach((el, i) => {
    el.classList.toggle('ac-active', i === acActiveIndex);
  });

  // Scroll active item into view
  const activeEl = dropdown.querySelector('.ac-item.ac-active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

// =============================================
// File Handling
// =============================================

function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    alert('Please select a CSV file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parsedData = parseCSV(text);

    if (parsedData.length === 0) {
      alert('No data found in the CSV. Make sure it\'s a Farmigo Labels report.');
      return;
    }

    addonIndex = buildAddonIndex(parsedData);
    allAddonItems = getSortedAddonItems(addonIndex);

    // Update UI
    dom.uploadSection().style.display = 'none';
    dom.searchSection().style.display = 'block';

    // File info
    dom.fileName().textContent = file.name;
    const dateStr = parsedData[0]?.date || '';
    dom.fileDate().textContent = dateStr;

    renderStats();
    renderCategoryTabs();
    renderItemChips();

    // Focus search
    setTimeout(() => dom.searchInput().focus(), 300);
  };

  reader.readAsText(file);
}

// =============================================
// Manifest Generator
// =============================================

/**
 * Switch between Add-On Checker and Manifest Generator modes.
 */
function switchMode(mode) {
  currentMode = mode;
  const addonMode = document.getElementById('addonMode');
  const manifestMode = document.getElementById('manifestMode');
  const labelMode = document.getElementById('labelMode');

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  addonMode.style.display = mode === 'addon' ? '' : 'none';
  manifestMode.style.display = mode === 'manifest' ? '' : 'none';
  labelMode.style.display = mode === 'labels' ? '' : 'none';
}

/**
 * Parse a Farmigo Distribution CSV into route-grouped manifest data.
 *
 * Fixed columns (0-14):
 *   Location, Route, Last Name, First Name, Primary Phone, Secondary Phone,
 *   Email, Delivery Date, Address, City, State, Zip Code,
 *   Pickup Site Instructions, Comments, Modified
 *
 * After column 14, subscription data comes in triplets:
 *   [quantity, unit, name] repeating
 */
function parseDistributionCSV(csvText) {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) return new Map();

  const headers = rows[0].map(h => h.trim());
  const routeIdx = headers.indexOf('Route');
  const lastNameIdx = headers.indexOf('Last Name');
  const firstNameIdx = headers.indexOf('First Name');
  const phoneIdx = headers.indexOf('Primary Phone');
  const dateIdx = headers.indexOf('Delivery Date');
  const addressIdx = headers.indexOf('Address');
  const cityIdx = headers.indexOf('City');
  const stateIdx = headers.indexOf('State');
  const zipIdx = headers.indexOf('Zip Code');
  const instructionsIdx = headers.indexOf('Pickup Site Instructions');
  const locationIdx = headers.indexOf('Location');
  const modifiedIdx = headers.indexOf('Modified');

  // Subscription triplets start after 'Modified'
  const subsStartIdx = modifiedIdx + 1;

  const routeMap = new Map();
  const routeOrder = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const route = (row[routeIdx] || '').trim();
    const lastName = (row[lastNameIdx] || '').trim();
    const firstName = (row[firstNameIdx] || '').trim();

    // Skip empty rows (route separators)
    if (!route && !lastName && !firstName) continue;
    if (!lastName && !firstName) continue;

    // Skip Farm Pick-up — no manifest needed for on-farm pickup
    if (/farm pick-?up/i.test(route)) continue;

    const rawDate = (row[dateIdx] || '').trim();
    const deliveryDate = parseDeliveryDate(rawDate);

    const subs = extractSubscriptions(row, subsStartIdx);

    const member = {
      lastName,
      firstName,
      phone: (row[phoneIdx] || '').trim(),
      address: (row[addressIdx] || '').trim(),
      city: (row[cityIdx] || '').trim(),
      state: (row[stateIdx] || '').trim(),
      zip: (row[zipIdx] || '').trim(),
      instructions: (row[instructionsIdx] || '').trim(),
      location: (row[locationIdx] || '').trim(),
      milk: subs.milk,
      bread: subs.bread,
    };

    if (!routeMap.has(route)) {
      routeMap.set(route, { members: [], date: deliveryDate });
      routeOrder.push(route);
    }
    routeMap.get(route).members.push(member);
  }

  // Assign box numbers within each route.
  // Members at the same Location (community drop site) share a box number.
  for (const [, data] of routeMap) {
    let counter = 0;
    const locationNumbers = {};
    data.members.forEach(m => {
      const loc = m.location;
      if (loc && locationNumbers[loc] != null) {
        // Same drop site as a previous member — reuse their box number
        m.boxNumber = locationNumbers[loc];
      } else {
        counter++;
        m.boxNumber = counter;
        if (loc) locationNumbers[loc] = counter;
      }
    });
  }

  // Return in order of first appearance
  const orderedMap = new Map();
  for (const route of routeOrder) {
    orderedMap.set(route, routeMap.get(route));
  }
  return orderedMap;
}

/**
 * Parse "Tuesday, June 9, 2026" → "6/9"
 */
function parseDeliveryDate(dateStr) {
  if (!dateStr) return '';
  const match = dateStr.match(/(\w+),?\s+(\w+)\s+(\d+),?\s+(\d+)/);
  if (match) {
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    const monthIdx = monthNames.indexOf(match[2]);
    if (monthIdx !== -1) {
      return `${monthIdx + 1}/${parseInt(match[3], 10)}`;
    }
  }
  return dateStr;
}

/**
 * Extract milk and bread subscription counts from triplet columns.
 * Eggs intentionally omitted (packed into delivery boxes).
 */
function extractSubscriptions(row, startIdx) {
  let milk = 0;
  let bread = 0;

  for (let i = startIdx; i + 2 < row.length; i += 3) {
    const qty = parseInt(row[i], 10);
    const name = (row[i + 2] || '').trim();

    if (isNaN(qty) || qty === 0 || !name) continue;

    if (/1\/2 Gallon Milk Share/i.test(name)) {
      milk += qty;
    } else if (/Balthazar Bread Share/i.test(name)) {
      bread += qty;
    }
  }

  return { milk, bread };
}

/**
 * Populate the route dropdown.
 */
function renderRouteDropdown(routeMap) {
  const select = dom.routeSelect();
  select.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = `All Routes (${routeMap.size})`;
  select.appendChild(allOpt);

  for (const [routeName, data] of routeMap) {
    const opt = document.createElement('option');
    opt.value = routeName;
    opt.textContent = `${routeName} (${data.members.length} stops)`;
    select.appendChild(opt);
  }

  currentRoute = 'all';
}

/**
 * Render manifest table(s) for the selected route(s).
 */
function renderManifestView() {
  const container = dom.manifestTableContainer();
  container.innerHTML = '';

  if (currentRoute === 'all') {
    for (const [routeName, data] of manifestData) {
      container.appendChild(buildManifestTableEl(routeName, data));
    }
  } else {
    const data = manifestData.get(currentRoute);
    if (data) {
      container.appendChild(buildManifestTableEl(currentRoute, data));
    }
  }

  renderManifestStats();
}

/**
 * Build an HTML table for a single route manifest.
 */
function buildManifestTableEl(routeName, routeData) {
  const wrapper = document.createElement('div');
  wrapper.className = 'manifest-table-wrapper';

  const title = document.createElement('div');
  title.className = 'manifest-title';
  title.textContent = `${routeName.toUpperCase()}  ${routeData.date}`;
  wrapper.appendChild(title);

  const table = document.createElement('table');
  table.className = 'manifest-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const columns = [
    { label: 'BOX #', cls: 'col-box' },
    { label: 'Last Name', cls: '' },
    { label: 'First Name', cls: '' },
    { label: 'Primary Phone', cls: 'col-phone' },
    { label: 'Address', cls: '' },
    { label: 'City', cls: '' },
    { label: 'State', cls: '' },
    { label: 'Zip Code', cls: '' },
    { label: 'Pickup Site Instructions', cls: 'col-instructions' },
    { label: '1/2 Gallon Milk Share', cls: 'col-subscription' },
    { label: 'Balthazar Bread Share', cls: 'col-subscription' },
    { label: 'Cooler', cls: 'col-empty' },
    { label: '# of returned boxes', cls: 'col-empty' },
  ];

  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.cls) th.className = col.cls;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  let totalMilk = 0;
  let totalBread = 0;

  routeData.members.forEach(member => {
    const tr = document.createElement('tr');
    const cells = [
      { val: member.boxNumber, cls: 'col-box' },
      { val: member.lastName, cls: '' },
      { val: member.firstName, cls: '' },
      { val: member.phone, cls: 'col-phone' },
      { val: member.address, cls: '' },
      { val: member.city, cls: '' },
      { val: member.state, cls: '' },
      { val: member.zip, cls: '' },
      { val: member.instructions, cls: 'col-instructions' },
      { val: member.milk ? `${member.milk} Milk` : '', cls: 'col-subscription' },
      { val: member.bread ? `${member.bread} Bread` : '', cls: 'col-subscription' },
      { val: '', cls: 'col-empty' },
      { val: '', cls: 'col-empty' },
    ];

    cells.forEach(cell => {
      const td = document.createElement('td');
      td.textContent = cell.val;
      if (cell.cls) td.className = cell.cls;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
    totalMilk += member.milk || 0;
    totalBread += member.bread || 0;
  });

  // Totals row
  const totalsRow = document.createElement('tr');
  totalsRow.className = 'totals-row';
  const totalCells = [
    { val: '', cls: 'col-box' },
    { val: '', cls: '' }, { val: '', cls: '' }, { val: '', cls: '' },
    { val: '', cls: '' }, { val: '', cls: '' }, { val: '', cls: '' },
    { val: '', cls: '' },
    { val: 'TOTALS', cls: 'col-instructions' },
    { val: totalMilk ? `${totalMilk} Milk` : '', cls: 'col-subscription' },
    { val: totalBread ? `${totalBread} Bread` : '', cls: 'col-subscription' },
    { val: '', cls: 'col-empty' },
    { val: '', cls: 'col-empty' },
  ];
  totalCells.forEach(cell => {
    const td = document.createElement('td');
    td.textContent = cell.val;
    if (cell.cls) td.className = cell.cls;
    totalsRow.appendChild(td);
  });
  tbody.appendChild(totalsRow);

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

/**
 * Render stats chips for the loaded distribution data.
 */
function renderManifestStats() {
  const container = dom.manifestStatsContainer();
  if (!container) return;

  let totalMembers = 0, totalMilk = 0, totalBread = 0;
  let routeCount = manifestData.size;

  if (currentRoute !== 'all' && manifestData.has(currentRoute)) {
    const data = manifestData.get(currentRoute);
    totalMembers = data.members.length;
    routeCount = 1;
    data.members.forEach(m => {
      totalMilk += m.milk || 0;
      totalBread += m.bread || 0;
    });
  } else {
    for (const [, data] of manifestData) {
      totalMembers += data.members.length;
      data.members.forEach(m => {
        totalMilk += m.milk || 0;
        totalBread += m.bread || 0;
      });
    }
  }

  container.innerHTML = `
    <div class="manifest-stat-chip">
      <span class="stat-number">${routeCount}</span>
      <span>Route${routeCount !== 1 ? 's' : ''}</span>
    </div>
    <div class="manifest-stat-chip">
      <span class="stat-number">${totalMembers}</span>
      <span>Members</span>
    </div>
    <div class="manifest-stat-chip">
      <span class="stat-number">${totalMilk}</span>
      <span>Milk Shares</span>
    </div>
    <div class="manifest-stat-chip">
      <span class="stat-number">${totalBread}</span>
      <span>Bread Shares</span>
    </div>
  `;
}

/**
 * Generate CSV string for a single route manifest.
 */
function generateManifestCSV(routeName, routeData) {
  const headers = [
    'BOX #', 'Last Name', 'First Name', 'Primary Phone',
    'Address', 'City', 'State', 'Zip Code',
    'Pickup Site Instructions', '1/2 Gallon Milk Share',
    'Balthazar Bread Share', 'Cooler', '# of returned boxes'
  ];

  const escapeCSV = (val) => {
    const str = String(val == null ? '' : val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [];
  lines.push(escapeCSV(`${routeName.toUpperCase()}  ${routeData.date}`));
  lines.push(headers.map(escapeCSV).join(','));

  routeData.members.forEach(m => {
    lines.push([
      m.boxNumber, m.lastName, m.firstName, m.phone,
      m.address, m.city, m.state, m.zip,
      m.instructions, m.milk ? `${m.milk} Milk` : '', m.bread ? `${m.bread} Bread` : '', '', ''
    ].map(escapeCSV).join(','));
  });

  // Totals row
  let totalMilk = 0, totalBread = 0;
  routeData.members.forEach(m => {
    totalMilk += m.milk || 0;
    totalBread += m.bread || 0;
  });
  lines.push([
    '', '', '', '', '', '', '', '', 'TOTALS',
    totalMilk ? `${totalMilk} Milk` : '', totalBread ? `${totalBread} Bread` : '', '', ''
  ].map(escapeCSV).join(','));

  return lines.join('\n');
}

/**
 * Download a single route manifest as CSV.
 */
async function downloadManifestCSV() {
  if (currentRoute === 'all') {
    await downloadAllManifestCSVs();
    return;
  }

  const data = manifestData.get(currentRoute);
  if (!data) return;

  const csv = generateManifestCSV(currentRoute, data);
  const safeRoute = currentRoute.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `manifest_${safeRoute}_${data.date.replace('/', '-')}.csv`;
  downloadBlobFile(csv, filename, 'text/csv');
}

/**
 * Download all route manifests as individual CSV files.
 */
async function downloadAllManifestCSVs() {
  for (const [routeName, data] of manifestData) {
    const csv = generateManifestCSV(routeName, data);
    const safeRoute = routeName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `manifest_${safeRoute}_${data.date.replace('/', '-')}.csv`;
    downloadBlobFile(csv, filename, 'text/csv');
    // Small delay between downloads to avoid browser blocking
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

/**
 * Generic Blob file download helper.
 */
function downloadBlobFile(content, filename, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export manifest(s) as a formatted PDF using jsPDF + AutoTable.
 * Landscape, 12pt font, alternating rows, repeating headers, one route per page.
 */
async function exportManifestPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });

  const routes = currentRoute === 'all'
    ? [...manifestData.entries()]
    : [[currentRoute, manifestData.get(currentRoute)]];

  const headers = [
    'BOX #', 'Last Name', 'First Name', 'Phone',
    'Address', 'City', 'St', 'Zip',
    'Pickup Instructions', 'Milk', 'Bread', 'Cooler', '# Returned'
  ];

  routes.forEach(([routeName, routeData], idx) => {
    if (idx > 0) doc.addPage();

    // Route title
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    const pageW = doc.internal.pageSize.getWidth();
    doc.text(`${routeName.toUpperCase()}  ${routeData.date}`, pageW / 2, 30, { align: 'center' });

    // Build body rows.
    // For community drop sites: hide home addresses (driver doesn't need them),
    // and only show instructions on the first and last member at each site.
    const members = routeData.members;
    const dropSiteRows = new Set();
    const body = members.map((m, i) => {
      let showInstructions = true;
      let isDropSite = false;
      if (m.location) {
        const samesite = members.filter(x => x.location === m.location);
        if (samesite.length > 1) {
          isDropSite = true;
          if (samesite.length > 2) {
            const first = members.indexOf(samesite[0]);
            const last = members.indexOf(samesite[samesite.length - 1]);
            if (i !== first && i !== last) showInstructions = false;
          }
        }
      }
      return [
        m.boxNumber, m.lastName, m.firstName, m.phone,
        isDropSite ? 'Drop Site!' : m.address,
        isDropSite ? '' : m.city,
        isDropSite ? '' : m.state,
        isDropSite ? '' : m.zip,
        showInstructions ? m.instructions : '',
        m.milk ? `${m.milk} Milk` : '', m.bread ? `${m.bread} Bread` : '', '', ''
      ];
    });
    // Build set of drop site row indices for bold styling
    members.forEach((m, i) => {
      if (m.location) {
        const samesite = members.filter(x => x.location === m.location);
        if (samesite.length > 1) dropSiteRows.add(i);
      }
    });

    // Totals row
    let totalMilk = 0, totalBread = 0;
    routeData.members.forEach(m => {
      totalMilk += m.milk || 0;
      totalBread += m.bread || 0;
    });
    body.push([
      '', '', '', '', '', '', '', '', 'TOTALS',
      totalMilk ? `${totalMilk} Milk` : '', totalBread ? `${totalBread} Bread` : '', '', ''
    ]);

    let isFirstPageOfRoute = true;
    doc.autoTable({
      head: [headers],
      body: body,
      startY: 42,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 3,
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [60, 60, 60],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [235, 235, 235],
      },
      bodyStyles: {
        fillColor: [255, 255, 255],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 35 },   // BOX #
        1: { cellWidth: 70 },                       // Last Name
        2: { cellWidth: 65 },                       // First Name
        3: { cellWidth: 72 },                       // Phone
        4: { cellWidth: 'auto' },                   // Address
        5: { cellWidth: 55 },                       // City
        6: { halign: 'center', cellWidth: 22 },     // State
        7: { halign: 'center', cellWidth: 38 },     // Zip
        8: { cellWidth: 'auto' },                   // Instructions
        9: { halign: 'center', cellWidth: 35 },     // Milk
        10: { halign: 'center', cellWidth: 38 },    // Bread
        11: { halign: 'center', cellWidth: 40 },    // Cooler
        12: { halign: 'center', cellWidth: 50 },    // Returned
      },
      // Style the totals row and bold "Drop Site!" labels
      didParseCell: function(data) {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [200, 200, 200];
          data.cell.styles.fontSize = 9;
        }
        // Bold the "Drop Site!" address cell
        if (data.section === 'body' && data.column.index === 4 && dropSiteRows.has(data.row.index)) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      // Repeat title on continuation pages of the same route
      didDrawPage: function(data) {
        if (!isFirstPageOfRoute) {
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(
            `${routeName.toUpperCase()}  ${routeData.date} (cont.)`,
            pageW / 2, 20, { align: 'center' }
          );
        }
        isFirstPageOfRoute = false;
      },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      margin: { top: 42, left: 20, right: 20, bottom: 20 },
    });

    // For double-sided printing: if this route ends on an odd page,
    // insert a blank page so the next route starts on a fresh sheet.
    const pageCount = doc.internal.getNumberOfPages();
    if (pageCount % 2 === 1) {
      doc.addPage();
    }
  });

  // Generate filename
  const dateStr = routes[0][1].date.replace('/', '-');
  const routeLabel = currentRoute === 'all' ? 'all_routes' : currentRoute.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`manifest_${routeLabel}_${dateStr}.pdf`);
}

/**
 * Export each route as its own individual PDF file.
 * Temporarily overrides currentRoute, calls exportManifestPDF for each,
 * then restores the original selection.
 */
async function exportAllManifestPDFs() {
  if (manifestData.size === 0) return;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const savedRoute = currentRoute;
  for (const [routeName] of manifestData) {
    currentRoute = routeName;
    await exportManifestPDF();
    await delay(500); // Prevent browser from blocking rapid downloads
  }
  currentRoute = savedRoute;
}

/**
 * Handle a Distribution CSV file upload in manifest mode.
 */
function handleManifestFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.csv')) {
    alert('Please upload a CSV file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const csvText = e.target.result;
    manifestData = parseDistributionCSV(csvText);

    if (manifestData.size === 0) {
      alert('No routes found in this CSV. Make sure it\'s a Farmigo Distribution report.');
      return;
    }

    dom.manifestUploadSection().style.display = 'none';
    dom.manifestSection().style.display = '';
    dom.manifestFileName().textContent = file.name;

    // Get delivery date from first route
    const firstRoute = manifestData.values().next().value;
    dom.manifestFileDate().textContent = firstRoute.date ? `Delivery: ${firstRoute.date}` : '';

    renderRouteDropdown(manifestData);
    renderManifestView();
  };
  reader.readAsText(file);
}

// =============================================
// Label Maker
// =============================================

/**
 * Parse a single item string for label display.
 * Unlike parseSingleItem(), this preserves:
 *   - colorCode: hex color string (e.g. 'FF00FF') or null
 *   - spanishName: the text inside brackets for produce swaps (e.g. 'Espinacas 5oz')
 *   - fullBracket: the full bracket text for display (e.g. '[D - Espinacas 5oz]')
 */
function parseSingleItemForLabel(raw) {
  if (!raw) return null;

  // Strip leading ___ (quantity indicator in Farmigo)
  let cleaned = raw.replace(/^___+/, '').trim();

  // Extract color code before stripping
  let colorCode = null;
  const colorMatch = cleaned.match(/^###([0-9A-Fa-f]{6})/);
  if (colorMatch) {
    colorCode = colorMatch[1];
    cleaned = cleaned.replace(/^###[0-9A-Fa-f]{6}/, '').trim();
  }

  // Determine category
  const category = identifyCategory(cleaned);

  // Extract quantity — look for number before or after bracket
  let qty = 1;
  let afterBracket = cleaned;

  if (category === 'produce' || category === 'subscription') {
    // For produce: qty might be before bracket or after bracket
    // e.g. "[E - Zanahorias] 1 Orange Carrots (bunch)"
    const bracketEnd = cleaned.indexOf(']');
    if (bracketEnd !== -1) {
      afterBracket = cleaned.substring(bracketEnd + 1).trim();
      const qtyMatch = afterBracket.match(/^(\d+)\s+/);
      if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
    }
  } else {
    const qtyMatch = cleaned.match(/^(\d+)\s+/);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
  }

  // Extract Spanish name from bracket for produce swaps
  let spanishName = '';
  let bracketPrefix = '';
  let existingLetter = '';
  if (category === 'produce') {
    const bracketMatch = cleaned.match(/^\[([^\]]+)\]/);
    if (bracketMatch) {
      bracketPrefix = bracketMatch[0]; // e.g. "[E - Zanahorias]"
      const inner = bracketMatch[1].trim(); // e.g. "E - Zanahorias"
      // Extract existing zone letter (single letter at start)
      const letterMatch = inner.match(/^([A-Za-z])\s*[-–]\s*(.*)/);
      if (letterMatch) {
        existingLetter = letterMatch[1].toUpperCase();
        spanishName = letterMatch[2].trim();
      } else {
        // No letter prefix, whole thing is Spanish name
        spanishName = inner;
      }
    }
  }

  // Extract English name
  let englishName = '';
  if (category === 'produce') {
    const bracketEnd = cleaned.indexOf(']');
    if (bracketEnd !== -1) {
      let after = cleaned.substring(bracketEnd + 1).trim();
      after = after.replace(/^\d+\s+/, '').trim();
      englishName = after;
    }
  } else if (category === 'share' || category === 'subscription') {
    englishName = cleaned.replace(/^\d+\s+/, '').trim();
  } else {
    // Add-on: remove [CATEGORY] prefix (whitespace-tolerant)
    let name = cleaned;
    for (const cat of Object.keys(ADDON_CATEGORIES)) {
      const pattern = new RegExp(`\\[\\s*${cat}\\s*\\]`, 'i');
      if (pattern.test(name)) {
        name = name.replace(pattern, '').trim();
        break;
      }
    }
    englishName = name.replace(/^\d+\s+/, '').trim();
  }

  return {
    raw,
    englishName,
    spanishName,
    existingLetter,
    bracketPrefix,
    qty,
    category,
    colorCode,
  };
}

/**
 * Handle a Labels CSV file upload in label maker mode.
 * Parses the CSV, collects unique swap items, and shows the zone assignment modal.
 */
function handleLabelFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.csv')) {
    alert('Please upload a CSV file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const csvText = e.target.result;

    // Reuse the existing parseCSV to get members with box numbers
    const members = parseCSV(csvText);
    if (members.length === 0) {
      alert('No members found. Make sure this is a Farmigo Labels CSV.');
      return;
    }

    // Re-parse items with the label-aware parser to preserve colors and Spanish names
    for (const member of members) {
      const rawItems = member.items.map(i => i.raw);
      // Re-parse from raw strings
      const rawItemStr = (member._rawItems || '');
      member.labelItems = [];
      for (const item of member.items) {
        const labelItem = parseSingleItemForLabel(item.raw);
        if (labelItem) member.labelItems.push(labelItem);
      }
    }

    labelMembers = members;

    // Show file info
    dom.labelUploadSection().style.display = 'none';
    dom.labelSection().style.display = '';
    dom.labelFileName().textContent = file.name;

    // Get date from first member
    const firstDate = members[0]?.date || '';
    dom.labelFileDate().textContent = firstDate ? `Delivery: ${firstDate}` : '';

    // Show member count
    const memberCountEl = document.getElementById('labelMemberCount');
    if (memberCountEl) {
      memberCountEl.innerHTML = `
        <div class="manifest-stat-chip">
          <span class="stat-number">${members.length}</span> Members
        </div>
      `;
    }

    // Collect unique swap items and show zone assignment modal
    const swapItems = collectUniqueSwapItems(members);
    if (swapItems.length > 0) {
      showZoneAssignmentModal(swapItems);
    } else {
      generateLabels();
    }
  };
  reader.readAsText(file);
}

/**
 * Collect unique produce swap items across all members.
 * Returns array of { englishName, spanishName, existingLetter }
 */
function collectUniqueSwapItems(members) {
  const seen = new Map(); // englishName → { spanishName, existingLetter }

  for (const member of members) {
    for (const item of member.labelItems) {
      if (item.category === 'produce' && item.englishName) {
        if (!seen.has(item.englishName)) {
          seen.set(item.englishName, {
            spanishName: item.spanishName,
            existingLetter: item.existingLetter,
          });
        }
      }
    }
  }

  // Sort alphabetically by English name
  return Array.from(seen.entries())
    .map(([englishName, data]) => ({
      englishName,
      spanishName: data.spanishName,
      existingLetter: data.existingLetter,
    }))
    .sort((a, b) => a.englishName.localeCompare(b.englishName));
}

/**
 * Render the zone assignment modal with produce swap items.
 */
function showZoneAssignmentModal(swapItems) {
  const list = dom.zoneItemsList();
  list.innerHTML = '';

  for (const item of swapItems) {
    const row = document.createElement('div');
    row.className = 'zone-item-row';

    // Pre-populate from previous assignments or CSV letter
    const savedLetter = swapZoneAssignments.get(item.englishName)?.letter || item.existingLetter || '';

    row.innerHTML = `
      <input type="text" class="zone-item-letter" maxlength="1"
             data-english="${item.englishName.replace(/"/g, '&quot;')}"
             value="${savedLetter}" autocomplete="off">
      <div class="zone-item-names">
        <div class="zone-item-spanish">${item.spanishName || '—'}</div>
        <div class="zone-item-english">${item.englishName}</div>
      </div>
    `;

    list.appendChild(row);
  }

  dom.zoneModal().classList.add('visible');
}

/**
 * Read zone letter assignments from the modal and generate labels.
 */
function applyZoneAssignments() {
  const inputs = dom.zoneItemsList().querySelectorAll('.zone-item-letter');
  swapZoneAssignments.clear();

  for (const input of inputs) {
    const englishName = input.dataset.english;
    const letter = input.value.trim().toUpperCase();
    if (letter) {
      // Find the Spanish name from the same row
      const row = input.closest('.zone-item-row');
      const spanishName = row.querySelector('.zone-item-spanish').textContent;
      swapZoneAssignments.set(englishName, { letter, spanishName: spanishName === '—' ? '' : spanishName });
    }
  }

  dom.zoneModal().classList.remove('visible');
  generateLabels();
}

/**
 * Tally all items across all members and render totals on screen.
 */
function renderItemTotals() {
  const totals = new Map(); // itemKey → { name, qty, category, color }

  for (const member of labelMembers) {
    for (const item of member.labelItems) {
      // Build a display name based on category
      let displayName = '';
      if (item.category === 'produce') {
        const assignment = swapZoneAssignments.get(item.englishName);
        const letter = assignment?.letter || item.existingLetter || '?';
        displayName = `[${letter}] ${item.englishName}`;
      } else if (item.category === 'share' || item.category === 'subscription') {
        displayName = item.englishName;
      } else {
        const zoneName = ADDON_CATEGORIES[item.category]?.label?.toUpperCase() || item.category.toUpperCase();
        displayName = `[${zoneName}] ${item.englishName}`;
      }

      const key = displayName;
      if (totals.has(key)) {
        totals.get(key).qty += item.qty;
      } else {
        totals.set(key, {
          name: displayName,
          qty: item.qty,
          category: item.category,
          colorCode: item.colorCode,
        });
      }
    }
  }

  // Only tally produce swap items
  const produceItems = [];
  for (const entry of totals.values()) {
    if (entry.category === 'produce') {
      produceItems.push(entry);
    }
  }

  // Sort alphabetically
  produceItems.sort((a, b) => a.name.localeCompare(b.name));

  // Member count chip in the controls bar
  const memberCountEl = document.getElementById('labelMemberCount');
  if (memberCountEl) {
    memberCountEl.innerHTML = `
      <div class="manifest-stat-chip">
        <span class="stat-number">${labelMembers.length}</span> Members
      </div>
    `;
  }

  // Build totals table in sidebar
  const statsEl = dom.labelStatsContainer();
  let html = `
    <div class="label-totals-table">
      <h3 class="label-totals-title">Produce Swap Totals</h3>
      <table class="label-totals">
        <thead><tr><th>Qty</th><th>Item</th></tr></thead>
        <tbody>
  `;

  for (const item of produceItems) {
    let style = '';
    if (item.colorCode) {
      style = `style="color:#${item.colorCode}"`;
    }
    const highlight = item.qty >= 2 ? ' class="label-total-highlight"' : '';
    html += `<tr${highlight}><td class="label-total-qty">${item.qty}</td><td ${style}>${item.name}</td></tr>`;
  }

  html += `</tbody></table></div>`;
  statsEl.innerHTML = html;
}

/**
 * Generate the packing label grid from parsed members.
 */
function generateLabels() {
  const container = dom.labelPreviewContainer();
  container.innerHTML = '';

  for (const member of labelMembers) {
    const card = document.createElement('div');
    card.className = 'label-card';

    // Determine if customized (Comments contains a comma)
    const isCustomized = member.comments && member.comments.includes(',');
    const asterisk = isCustomized ? '*' : '';

    // Header: #BoxNum - FirstName LastName*
    const header = document.createElement('div');
    header.className = 'label-header';
    header.textContent = `#${member.boxNumber} - ${member.firstName} ${member.lastName}${asterisk}`;
    card.appendChild(header);

    // Sub-header: Route - Street Address
    const subHeader = document.createElement('div');
    subHeader.className = 'label-subheader';
    subHeader.textContent = `${member.route} - ${member.address1 || ''}`;
    card.appendChild(subHeader);

    // Items container
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'label-items';

    // Use the same buildLabelLines logic for consistent ordering and colors
    const itemLines = buildLabelLines(member);
    for (const lineData of itemLines) {
      const line = document.createElement('div');
      line.className = 'label-item';

      if (lineData.text === '') {
        // Blank separator line
        line.style.height = '6px';
      } else {
        line.textContent = lineData.text;
        line.style.color = `rgb(${lineData.color[0]}, ${lineData.color[1]}, ${lineData.color[2]})`;

        if (lineData.underline) {
          line.style.textDecoration = 'underline';
        }
        if (lineData.highlight) {
          line.style.backgroundColor = '#fef9c3';
        }
      }

      itemsDiv.appendChild(line);
    }

    card.appendChild(itemsDiv);

    container.appendChild(card);
  }

  // Show item totals summary
  renderItemTotals();
}

/**
 * Build the sorted item lines for a single member's label.
 * Order: Bread/Milk → Produce Shares → Eggs → [gap] → CSA Swaps → [gap] → Add-ons
 * Returns array of { text, color, underline, highlight } objects.
 */
function buildLabelLines(member) {
  const lines = [];

  const breadMilk = [];   // bread & milk shares (top)
  const shares = [];      // produce shares (Half Share, etc.)
  const eggs = [];        // egg shares
  const produceSwaps = [];
  const addons = [];

  for (const item of member.labelItems) {
    const lower = item.englishName.toLowerCase();
    const isBread = /bread/i.test(lower);
    const isMilk = /milk/i.test(lower);
    const isEgg = /egg/i.test(lower);

    switch (item.category) {
      case 'share':
      case 'subscription':
        if (isBread) {
          breadMilk.push({ ...item, _subType: 'bread' });
        } else if (isMilk) {
          breadMilk.push({ ...item, _subType: 'milk' });
        } else if (isEgg) {
          eggs.push(item);
        } else {
          shares.push(item);
        }
        break;
      case 'produce':
        produceSwaps.push(item);
        break;
      default:
        addons.push(item);
    }
  }

  // 1. Bread & Milk shares (orange for bread, blue for milk)
  for (const item of breadMilk) {
    const text = `${item.qty} ${item.englishName}`;
    const color = item._subType === 'bread' ? [234, 138, 30] : [59, 130, 246]; // orange / blue
    lines.push({ text, color, underline: item.qty >= 2, highlight: item.qty >= 2 });
  }

  // 2. Produce shares (Half Share, Full Share, etc.)
  for (const item of shares) {
    lines.push({ text: `${item.qty} ${item.englishName}`, color: [0, 0, 0], underline: false, highlight: item.qty >= 2 });
  }

  // 3. Egg shares
  for (const item of eggs) {
    let text = `${item.qty} ${item.englishName}`;
    let color = [0, 0, 0];
    if (item.colorCode) {
      const r = parseInt(item.colorCode.substring(0, 2), 16);
      const g = parseInt(item.colorCode.substring(2, 4), 16);
      const b = parseInt(item.colorCode.substring(4, 6), 16);
      color = [r, g, b];
    }
    lines.push({ text, color, underline: item.qty >= 2, highlight: item.qty >= 2 });
  }

  // 4. Blank line before CSA swaps (if there are swaps)
  if (produceSwaps.length > 0) {
    lines.push({ text: '', color: [0, 0, 0], underline: false, highlight: false });
  }

  // 5. Produce swaps — sorted by zone letter
  const sortedSwaps = [...produceSwaps].sort((a, b) => {
    const letterA = swapZoneAssignments.get(a.englishName)?.letter || a.existingLetter || 'Z';
    const letterB = swapZoneAssignments.get(b.englishName)?.letter || b.existingLetter || 'Z';
    if (letterA !== letterB) return letterA.localeCompare(letterB);
    return a.englishName.localeCompare(b.englishName);
  });

  for (const item of sortedSwaps) {
    const assignment = swapZoneAssignments.get(item.englishName);
    const letter = assignment?.letter || item.existingLetter || '?';
    const spanish = assignment?.spanishName || item.spanishName || '';
    const bracketText = spanish ? `[${letter} -${spanish}]` : `[${letter}]`;
    const text = `${bracketText} ${item.qty} ${item.englishName}`;

    let color = [0, 0, 0];
    if (item.colorCode) {
      const r = parseInt(item.colorCode.substring(0, 2), 16);
      const g = parseInt(item.colorCode.substring(2, 4), 16);
      const b = parseInt(item.colorCode.substring(4, 6), 16);
      color = [r, g, b];
    }
    lines.push({ text, color, underline: item.qty >= 2, highlight: item.qty >= 2 });
  }

  // 6. Blank line before add-ons (if there are add-ons)
  if (addons.length > 0) {
    lines.push({ text: '', color: [0, 0, 0], underline: false, highlight: false });
  }

  // 7. Add-ons — sorted by packing zone, then alphabetically
  const ADDON_ZONE_ORDER = ['MEAT', 'COLD', 'CHEESE', 'FRUIT', 'DRY', 'SHROOMS'];
  const sortedAddons = [...addons].sort((a, b) => {
    const idxA = ADDON_ZONE_ORDER.indexOf(a.category);
    const idxB = ADDON_ZONE_ORDER.indexOf(b.category);
    const orderA = idxA >= 0 ? idxA : ADDON_ZONE_ORDER.length;
    const orderB = idxB >= 0 ? idxB : ADDON_ZONE_ORDER.length;
    if (orderA !== orderB) return orderA - orderB;
    return a.englishName.localeCompare(b.englishName);
  });

  for (const item of sortedAddons) {
    const zoneName = ADDON_CATEGORIES[item.category]?.label?.toUpperCase() || item.category.toUpperCase();
    lines.push({
      text: `[${zoneName}] ${item.qty} ${item.englishName}`,
      color: [22, 163, 74], // green
      underline: item.qty >= 2,
      highlight: item.qty >= 2,
    });
  }

  return lines;
}

/**
 * Export packing labels as a PDF using jsPDF.
 * Avery 5164: 6 labels per page (2 columns × 3 rows).
 * Label: 4" × 3.33", top margin 0.5", side margin ~0.156", gutter ~0.188".
 */
function exportLabelsPDF() {
  if (labelMembers.length === 0) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });

  // Avery 5164 layout constants (inches)
  const PAGE_W = 8.5;
  const LABEL_W = 4.0;
  const LABEL_H = 3.3333;
  const MARGIN_TOP = 0.5;
  const MARGIN_LEFT = 0.15625;
  const GUTTER = (PAGE_W - 2 * MARGIN_LEFT - 2 * LABEL_W);
  const COLS = 2;
  const ROWS = 3;
  const LABELS_PER_PAGE = COLS * ROWS;

  // Text layout within a label (internal padding)
  const PAD_X = 0.25;
  const PAD_TOP = 0.15;
  const TEXT_W = LABEL_W - 2 * PAD_X;

  const HEADER_SIZE = 16; // pt
  const SUBHEADER_SIZE = 9; // pt
  const BODY_SIZE = 12;   // pt
  const MIN_BODY_SIZE = 8;

  // Line height = text height + 10% gap (minimum)
  // fontSize / 72 = text height in inches, × 1.1 for 10% inter-line gap
  const LINE_H = (BODY_SIZE / 72) * 1.1;
  const MIN_LINE_H = (MIN_BODY_SIZE / 72) * 1.1;

  // Available height for items (label height minus header+subheader space and bottom pad)
  // Header space = top pad + header offset + sub-header gap + line gap
  const HEADER_OFFSET = 0.24;
  const HEADER_SPACE = PAD_TOP + HEADER_OFFSET + 0.18 + LINE_H;
  const AVAIL_H = LABEL_H - HEADER_SPACE - PAD_TOP; // bottom pad instead of footer

  // Calculate max lines that fit at minimum font size
  const maxLinesPerLabel = Math.floor(AVAIL_H / MIN_LINE_H);

  // --- Pre-build label slots (splitting overflows) ---
  const labelSlots = []; // { member, lines, isCont, isOverflow }

  for (const member of labelMembers) {
    const allLines = buildLabelLines(member);

    if (allLines.length <= maxLinesPerLabel) {
      // Fits on one label (may shrink but won't go below min)
      labelSlots.push({
        member,
        lines: allLines,
        isCont: false,
        isOverflow: false,
      });
    } else {
      // Split across multiple labels — red header
      let remaining = [...allLines];
      let first = true;
      while (remaining.length > 0) {
        const chunk = remaining.splice(0, maxLinesPerLabel);
        labelSlots.push({
          member,
          lines: chunk,
          isCont: !first,
          isOverflow: true, // red header
        });
        first = false;
      }
    }
  }

  // --- Render all label slots ---
  for (let i = 0; i < labelSlots.length; i++) {
    const slot = labelSlots[i];
    const { member, lines, isCont, isOverflow } = slot;
    const posOnPage = i % LABELS_PER_PAGE;
    const col = posOnPage % COLS;
    const row = Math.floor(posOnPage / COLS);

    if (i > 0 && posOnPage === 0) doc.addPage();

    // Label origin
    const labelX = MARGIN_LEFT + col * (LABEL_W + GUTTER);
    const labelY = MARGIN_TOP + row * LABEL_H;
    const textX = labelX + PAD_X;
    let curY = labelY + PAD_TOP;

    // --- HEADER ---
    const isCustomized = member.comments && member.comments.includes(',');
    const asterisk = isCustomized ? '*' : '';
    let headerText = `#${member.boxNumber} - ${member.firstName} ${member.lastName}${asterisk}`;
    if (isCont) headerText += ' (cont.)';

    doc.setFontSize(HEADER_SIZE);
    doc.setFont(undefined, 'bold');
    // Red header for overflow members, black otherwise
    if (isOverflow) {
      doc.setTextColor(220, 38, 38);
    } else {
      doc.setTextColor(0, 0, 0);
    }
    curY += HEADER_OFFSET;
    doc.text(headerText, labelX + LABEL_W / 2, curY, { align: 'center' });
    curY += 0.18;

    // --- SUB-HEADER: Route - Address ---
    doc.setFontSize(SUBHEADER_SIZE);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    const subText = `${member.route} - ${member.address1 || ''}`;
    let displaySub = subText;
    if (doc.getTextWidth(displaySub) > TEXT_W) {
      while (displaySub.length > 0 && doc.getTextWidth(displaySub + '...') > TEXT_W) {
        displaySub = displaySub.slice(0, -1);
      }
      displaySub += '...';
    }
    doc.text(displaySub, labelX + LABEL_W / 2, curY, { align: 'center' });
    curY += LINE_H; // gap after sub-header

    // --- ITEM LINES (auto-shrink within this slot) ---
    const maxItemY = labelY + LABEL_H - PAD_TOP; // use full label, no footer
    const availableH = maxItemY - curY;

    let bodySize = BODY_SIZE;
    let lineH = LINE_H;
    const neededH = lines.length * LINE_H;
    if (neededH > availableH && lines.length > 0) {
      const scale = availableH / neededH;
      bodySize = Math.max(BODY_SIZE * scale, MIN_BODY_SIZE);
      // Enforce minimum line spacing: at least 10% gap at the shrunken size
      const minLineHAtSize = (bodySize / 72) * 1.1;
      lineH = Math.max(availableH / lines.length, minLineHAtSize);
    }

    doc.setFontSize(bodySize);

    for (const line of lines) {
      if (curY > maxItemY) break;

      if (line.highlight) {
        doc.setFillColor(255, 255, 0);
        const textWidth = Math.min(doc.getTextWidth(line.text), TEXT_W);
        const ascent = (bodySize / 72) * 0.75; // font ascent in inches
        doc.rect(textX - 0.02, curY - ascent, textWidth + 0.04, lineH, 'F');
      }

      doc.setTextColor(line.color[0], line.color[1], line.color[2]);
      doc.setFont(undefined, 'normal');

      // Truncate text that overflows the label width (clip, don't wrap)
      let displayText = line.text;
      if (doc.getTextWidth(displayText) > TEXT_W) {
        while (displayText.length > 0 && doc.getTextWidth(displayText + '...') > TEXT_W) {
          displayText = displayText.slice(0, -1);
        }
        displayText += '...';
      }
      doc.text(displayText, textX, curY);

      if (line.underline) {
        const textWidth = Math.min(doc.getTextWidth(displayText), TEXT_W);
        doc.setDrawColor(line.color[0], line.color[1], line.color[2]);
        doc.setLineWidth(0.005);
        doc.line(textX, curY + 0.02, textX + textWidth, curY + 0.02);
      }
      curY += lineH;
    }
  }

  // Build filename from date
  const firstDate = labelMembers[0]?.date || 'labels';
  const safeName = firstDate.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`Packing_Labels_${safeName}.pdf`);
}

// =============================================
// Event Bindings
// =============================================

document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = dom.uploadZone();
  const fileInput = dom.fileInput();

  // Click to upload
  dom.uploadBtn().addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  uploadZone.addEventListener('click', () => fileInput.click());

  // File selected
  fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
  });

  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });

  // Search — autocomplete typeahead
  dom.searchInput().addEventListener('input', handleSearchInput);
  dom.searchInput().addEventListener('keydown', handleSearchKeydown);

  // Dismiss autocomplete when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.search-input-wrap');
    if (wrap && !wrap.contains(e.target)) {
      hideAutocomplete();
    }
  });

  dom.clearSearch().addEventListener('click', () => {
    dom.searchInput().value = '';
    dom.clearSearch().style.display = 'none';
    hideAutocomplete();
    renderResults('');
    activeItem = null;
    document.querySelectorAll('.item-chip').forEach(c => c.classList.remove('active'));
    dom.searchInput().focus();
  });

  // Sort
  dom.sortSelect().addEventListener('change', (e) => {
    currentSort = e.target.value;
    const val = dom.searchInput().value;
    if (val) renderResults(val);
  });

  // Pin button
  dom.pinBtn().addEventListener('click', () => {
    pinCurrentItem();
  });

  // Pinned bar actions
  dom.pinnedClearBtn().addEventListener('click', clearAllPinned);
  dom.pinnedExportBtn().addEventListener('click', exportPinnedCSV);

  // Blank labels button
  document.getElementById('blankLabelsBtn').addEventListener('click', toggleBlankLabels);

  // Change file
  dom.changeFileBtn().addEventListener('click', () => {
    // Reset state
    parsedData = [];
    addonIndex = new Map();
    allAddonItems = [];
    activeItem = null;
    pinnedItems = [];

    dom.searchSection().style.display = 'none';
    dom.uploadSection().style.display = 'flex';
    dom.headerStats().style.display = 'none';
    dom.searchInput().value = '';
    dom.clearSearch().style.display = 'none';
    dom.resultsPlaceholder().style.display = 'flex';
    dom.resultsHeader().style.display = 'none';
    dom.resultsList().innerHTML = '';
    dom.pinnedBar().style.display = 'none';
    dom.pinnedChips().innerHTML = '';

    fileInput.value = '';
  });

  // Cmd/Ctrl+K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      dom.searchInput().focus();
      dom.searchInput().select();
    }
  });

  // Help modal
  const helpModal = document.getElementById('helpModal');
  document.getElementById('helpBtn').addEventListener('click', () => {
    helpModal.classList.add('visible');
  });
  document.getElementById('helpModalClose').addEventListener('click', () => {
    helpModal.classList.remove('visible');
  });
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.remove('visible');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal.classList.contains('visible')) {
      helpModal.classList.remove('visible');
    }
  });

  // =============================================
  // Manifest Mode Event Bindings
  // =============================================

  // Mode tab switching
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // Manifest file upload — drag & drop
  const mUploadZone = dom.manifestUploadZone();
  if (mUploadZone) {
    mUploadZone.addEventListener('click', () => dom.manifestFileInput().click());
    mUploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      mUploadZone.classList.add('drag-over');
    });
    mUploadZone.addEventListener('dragleave', () => {
      mUploadZone.classList.remove('drag-over');
    });
    mUploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      mUploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleManifestFile(e.dataTransfer.files[0]);
    });
  }

  // Manifest file input change
  const mFileInput = dom.manifestFileInput();
  if (mFileInput) {
    mFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleManifestFile(e.target.files[0]);
    });
  }

  // Manifest upload button
  const mUploadBtn = dom.manifestUploadBtn();
  if (mUploadBtn) {
    mUploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.manifestFileInput().click();
    });
  }

  // Route select change
  const routeSel = dom.routeSelect();
  if (routeSel) {
    routeSel.addEventListener('change', (e) => {
      currentRoute = e.target.value;
      renderManifestView();
    });
  }

  // Download CSV
  const dlBtn = dom.downloadManifestBtn();
  if (dlBtn) dlBtn.addEventListener('click', downloadManifestCSV);

  // Download All
  const dlAllBtn = dom.downloadAllBtn();
  if (dlAllBtn) dlAllBtn.addEventListener('click', downloadAllManifestCSVs);

  // Export PDF
  const pdfBtn = dom.exportPdfBtn();
  if (pdfBtn) pdfBtn.addEventListener('click', exportManifestPDF);

  // Export All PDFs
  const allPdfsBtn = dom.exportAllPdfsBtn();
  if (allPdfsBtn) allPdfsBtn.addEventListener('click', exportAllManifestPDFs);

  // Manifest change file
  const mChangeBtn = dom.manifestChangeFileBtn();
  if (mChangeBtn) {
    mChangeBtn.addEventListener('click', () => {
      manifestData = new Map();
      currentRoute = 'all';
      dom.manifestSection().style.display = 'none';
      dom.manifestUploadSection().style.display = 'flex';
      dom.manifestTableContainer().innerHTML = '';
      dom.manifestStatsContainer().innerHTML = '';
      dom.manifestFileInput().value = '';
    });
  }

  // ============================
  // Label Maker Event Wiring
  // ============================

  // Label file upload — drag & drop
  const labelZone = dom.labelUploadZone();
  const labelInput = dom.labelFileInput();

  if (labelZone) {
    labelZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      labelZone.classList.add('dragover');
    });
    labelZone.addEventListener('dragleave', () => {
      labelZone.classList.remove('dragover');
    });
    labelZone.addEventListener('drop', (e) => {
      e.preventDefault();
      labelZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      handleLabelFile(file);
    });
    labelZone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') labelInput.click();
    });
  }
  if (labelInput) {
    labelInput.addEventListener('change', (e) => {
      handleLabelFile(e.target.files[0]);
    });
  }
  const labelUpBtn = dom.labelUploadBtn();
  if (labelUpBtn) {
    labelUpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      labelInput.click();
    });
  }

  // Print labels
  const printBtn = dom.printLabelsBtn();
  if (printBtn) printBtn.addEventListener('click', exportLabelsPDF);

  // Zone modal
  const zoneClose = dom.zoneModalClose();
  if (zoneClose) {
    zoneClose.addEventListener('click', () => {
      dom.zoneModal().classList.remove('visible');
    });
  }
  const zoneApply = dom.zoneApplyBtn();
  if (zoneApply) zoneApply.addEventListener('click', applyZoneAssignments);

  // Label change file
  const lChangeBtn = dom.labelChangeFileBtn();
  if (lChangeBtn) {
    lChangeBtn.addEventListener('click', () => {
      labelMembers = [];
      swapZoneAssignments.clear();
      dom.labelSection().style.display = 'none';
      dom.labelUploadSection().style.display = 'flex';
      dom.labelPreviewContainer().innerHTML = '';
      dom.labelStatsContainer().innerHTML = '';
      dom.labelFileInput().value = '';
    });
  }
});
