// productSearch.js
// Primary:  Curated product database (data/curated-products.json) — always reliable
// Fallback: DuckDuckGo HTML search — no API key needed

const path = require('path');
let curatedDB = {};
try {
    curatedDB = require(path.join(__dirname, 'data', 'curated-products.json'));
} catch (e) {
    console.warn('[productSearch] curated-products.json not found:', e.message);
}

// ── Budget filter ─────────────────────────────────────────────
const BUDGET_MAP = {
    'Under €20 — drugstore only':   ['budget'],
    '€20–60 — mid-range brands':    ['budget', 'mid-range'],
    '€60–150 — premium brands':     ['budget', 'mid-range', 'premium'],
    'No limit — recommend the best':['budget', 'mid-range', 'premium', 'luxury'],
    // legacy values
    low:    ['budget'],
    medium: ['budget', 'mid-range'],
    high:   ['budget', 'mid-range', 'premium', 'luxury']
};

function filterByBudget(products, budget) {
    const allowed = BUDGET_MAP[budget] || BUDGET_MAP['medium'];
    const filtered = products.filter(p => allowed.includes(p.priceRange));
    return filtered.length > 0 ? filtered : products;
}

// ── Alias map for common ingredient/step names ───────────────
const INGREDIENT_ALIASES = {
    'cleanser': ['face wash', 'Cleanser'],
    'face wash': ['Cleanser', 'face wash'],
    'gentle cleanser': ['face wash', 'Cleanser'],
    'gel cleanser': ['face wash', 'Cleanser'],
    'foaming cleanser': ['Cleanser', 'face wash'],
    'cream cleanser': ['face wash', 'Cleanser'],
    'spf': ['SPF Sunscreen', 'Zinc Oxide'],
    'sunscreen': ['SPF Sunscreen', 'Zinc Oxide'],
    'sun protection': ['SPF Sunscreen', 'Zinc Oxide'],
    'broad spectrum': ['SPF Sunscreen', 'Zinc Oxide'],
    'uv protection': ['SPF Sunscreen', 'Zinc Oxide'],
    'moisturizer': ['Hyaluronic Acid', 'Ceramides'],
    'moisturiser': ['Hyaluronic Acid', 'Ceramides'],
};

// ── Curated DB lookup ─────────────────────────────────────────
function getCuratedProducts(ingredient, budget, skinType) {
    const keys = Object.keys(curatedDB);
    const needle = (ingredient || '').toLowerCase();

    // 1. Exact match
    let products = curatedDB[ingredient] || [];

    // 2. Fuzzy match (substring in either direction)
    if (!products.length) {
        const key = keys.find(k =>
            k.toLowerCase().includes(needle) ||
            needle.includes(k.toLowerCase())
        );
        products = curatedDB[key] || [];
    }

    // 3. Alias lookup — map common names to curated DB keys
    if (!products.length) {
        for (const [alias, dbKeys] of Object.entries(INGREDIENT_ALIASES)) {
            if (needle.includes(alias)) {
                for (const dk of dbKeys) {
                    products = curatedDB[dk] || [];
                    if (products.length) break;
                }
                if (products.length) break;
            }
        }
    }

    // 3. Filter by skin type if provided (skip if "all" or no match found)
    if (skinType && products.length > 0) {
        const st = skinType.toLowerCase();
        const skinFiltered = products.filter(p =>
            !p.bestFor || p.bestFor.some(b => b === 'all_types' || b === 'all' || b.toLowerCase() === st)
        );
        if (skinFiltered.length > 0) products = skinFiltered;
    }

    // 4. Filter by budget
    if (budget) products = filterByBudget(products, budget);

    // Sort by rating descending, cap at 3
    return [...products]
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 3);
}

// ── Extract ingredient keyword from a freeform query ──────────
function extractIngredient(query) {
    if (!query) return '';
    const keys = Object.keys(curatedDB);
    // Check longest match first to avoid "Acid" matching "Glycolic Acid" prematurely
    const sortedKeys = keys.slice().sort((a, b) => b.length - a.length);
    const match = sortedKeys.find(k => query.toLowerCase().includes(k.toLowerCase()));
    return match || query.split(' ').slice(0, 3).join(' ');
}

// ── DuckDuckGo fallback ───────────────────────────────────────
function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function parseDDGResults(html) {
    const results = [];
    const titleRe   = /class="result__title"[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    const snippetRe = /class="result__snippet"[^>]*>([^<]+)/g;
    const titles = [], snippets = [];
    let m;
    while ((m = titleRe.exec(html))   !== null) titles.push({ url: m[1], title: m[2].trim() });
    while ((m = snippetRe.exec(html)) !== null) snippets.push(m[1].trim());
    titles.forEach((t, i) => {
        if (t.url && t.title) {
            results.push({ name: t.title, url: t.url, description: snippets[i] || '', source: extractDomain(t.url) });
        }
    });
    return results;
}

async function searchDDG(query) {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query + ' skincare product buy');
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GlowGuide/1.0)', 'Accept': 'text/html' }
    });
    const html = await res.text();
    return parseDDGResults(html);
}

// ── Main export ───────────────────────────────────────────────
/**
 * @param {string} productType  - e.g. "gentle gel cleanser with Salicylic Acid"
 * @param {string} budget       - budget tier or intake Q5 answer string
 * @param {string} country      - e.g. "USA", "Germany"
 * @param {string} skinConcern  - e.g. "acne", "oily"
 * @param {string} city         - e.g. "New York"
 * @returns {Promise<Array>}
 */
async function searchProducts(productType, budget = 'medium', country = 'USA', skinConcern = '', city = '') {
    // 1. Try curated database first (always fast + reliable)
    const ingredient = extractIngredient(productType);
    const curated = getCuratedProducts(ingredient, budget, skinConcern);
    if (curated.length > 0) return curated;

    // 2. DuckDuckGo fallback
    try {
        const locationStr = city ? `${city}, ${country}` : country;
        const query = ['best', productType, skinConcern ? 'for ' + skinConcern : '', locationStr ? 'in ' + locationStr : '']
            .filter(Boolean).join(' ');
        const ddgResults = await searchDDG(query);
        if (ddgResults.length > 0) return ddgResults.slice(0, 4);
    } catch (e) {
        console.warn('[productSearch] DDG fallback failed:', e.message);
    }

    return [];
}

module.exports = { searchProducts, getCuratedProducts, filterByBudget };
