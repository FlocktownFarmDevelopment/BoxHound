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
let currentMode = 'addon';      // 'addon' or 'manifest'

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
  exportExcelBtn:     () => document.getElementById('exportExcelBtn'),
  manifestStatsContainer: () => document.getElementById('manifestStatsContainer'),
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

  // Check add-on store categories
  for (const cat of Object.keys(ADDON_CATEGORIES)) {
    if (upper.includes(`[${cat}]`)) return cat;
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

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  if (mode === 'addon') {
    addonMode.style.display = '';
    manifestMode.style.display = 'none';
  } else {
    addonMode.style.display = 'none';
    manifestMode.style.display = '';
  }
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

    // Build body rows
    const body = routeData.members.map(m => [
      m.boxNumber, m.lastName, m.firstName, m.phone,
      m.address, m.city, m.state, m.zip,
      m.instructions, m.milk ? `${m.milk} Milk` : '', m.bread ? `${m.bread} Bread` : '', '', ''
    ]);

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
      // Style the totals row (last row)
      didParseCell: function(data) {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [200, 200, 200];
          data.cell.styles.fontSize = 9;
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
  });

  // Generate filename
  const dateStr = routes[0][1].date.replace('/', '-');
  const routeLabel = currentRoute === 'all' ? 'all_routes' : currentRoute.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`manifest_${routeLabel}_${dateStr}.pdf`);
}

/**
 * Export manifest(s) as a formatted Excel file using ExcelJS.
 * Each route gets its own worksheet with styling, alternating rows, and print setup.
 */
async function exportManifestExcel() {
  const workbook = new ExcelJS.Workbook();

  const routes = currentRoute === 'all'
    ? [...manifestData.entries()]
    : [[currentRoute, manifestData.get(currentRoute)]];

  const colHeaders = [
    'BOX #', 'Last Name', 'First Name', 'Primary Phone',
    'Address', 'City', 'State', 'Zip Code',
    'Pickup Site Instructions', '1/2 Gallon Milk Share',
    'Balthazar Bread Share', 'Cooler', '# of returned boxes'
  ];

  const colWidths = [7, 16, 14, 15, 28, 14, 7, 9, 28, 12, 12, 9, 12];

  const darkFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
  const stripeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  const totalsFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
  const thinBorder = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };

  for (const [routeName, routeData] of routes) {
    // Sheet name max 31 chars, no special chars
    const sheetName = routeName.replace(/[\\\/*?\[\]:]/g, '').substring(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    // Page setup for printing from Numbers/Excel
    sheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 1,  // Letter
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:2',  // Repeat title + headers on every printed page
    };

    // Set column widths
    sheet.columns = colWidths.map(w => ({ width: w }));

    // Row 1: Route title (merged across all columns)
    const titleRow = sheet.addRow([`${routeName.toUpperCase()}  ${routeData.date}`]);
    sheet.mergeCells(1, 1, 1, 13);
    titleRow.height = 28;
    titleRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.eachCell(cell => {
      cell.fill = darkFill;
      cell.border = thinBorder;
    });

    // Row 2: Column headers
    const hdrRow = sheet.addRow(colHeaders);
    hdrRow.font = { bold: true, size: 10 };
    hdrRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    hdrRow.height = 30;
    hdrRow.eachCell(cell => {
      cell.fill = headerFill;
      cell.border = thinBorder;
    });

    // Data rows
    let totalMilk = 0, totalBread = 0;
    routeData.members.forEach((m, idx) => {
      const row = sheet.addRow([
        m.boxNumber, m.lastName, m.firstName, m.phone,
        m.address, m.city, m.state, m.zip,
        m.instructions, m.milk ? `${m.milk} Milk` : '', m.bread ? `${m.bread} Bread` : '', '', ''
      ]);
      row.font = { size: 12 };
      row.eachCell(cell => {
        cell.border = thinBorder;
        if (idx % 2 === 1) cell.fill = stripeFill;
      });
      // Center BOX #, State, Zip, Milk, Bread, Cooler, Returned
      [1, 7, 8, 10, 11, 12, 13].forEach(c => {
        row.getCell(c).alignment = { horizontal: 'center' };
      });
      // Preserve leading zeros on phone and zip
      row.getCell(4).numFmt = '@';
      row.getCell(8).numFmt = '@';
      totalMilk += m.milk || 0;
      totalBread += m.bread || 0;
    });

    // Totals row
    const totRow = sheet.addRow([
      '', '', '', '', '', '', '', '', 'TOTALS',
      totalMilk ? `${totalMilk} Milk` : '', totalBread ? `${totalBread} Bread` : '', '', ''
    ]);
    totRow.font = { bold: true, size: 12 };
    totRow.eachCell(cell => {
      cell.fill = totalsFill;
      cell.border = thinBorder;
    });
    totRow.getCell(9).alignment = { horizontal: 'right' };
    [10, 11, 12, 13].forEach(c => {
      totRow.getCell(c).alignment = { horizontal: 'center' };
    });
  }

  // Write and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const dateStr = routes[0][1].date.replace('/', '-');
  const routeLabel = currentRoute === 'all' ? 'all_routes' : currentRoute.replace(/[^a-zA-Z0-9]/g, '_');
  downloadBlobFile(blob, `manifest_${routeLabel}_${dateStr}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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

  // Export Excel
  const excelBtn = dom.exportExcelBtn();
  if (excelBtn) excelBtn.addEventListener('click', exportManifestExcel);

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
});
