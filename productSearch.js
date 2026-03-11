require('dotenv').config();
const axios = require('axios');

const SERP_API_KEY = process.env.SERP_API_KEY;

/**
 * Search for skincare products using SerpAPI Google Shopping
 * @param {string} productType - e.g. "gentle gel cleanser for acne"
 * @param {string} budget - "low" / "medium" / "high"
 * @param {string} country - e.g. "Pakistan", "USA", "UK"
 * @param {string} skinConcern - e.g. "acne", "dryness"
 * @param {string} city - e.g. "Karachi", "New York"
 * @returns {Promise<Array>} Array of product objects
 */
async function searchProducts(productType, budget = 'medium', country = 'USA', skinConcern = '', city = '') {
    try {
        if (!SERP_API_KEY || SERP_API_KEY === 'your_serpapi_key_here') {
            console.warn('SERP_API_KEY not configured');
            return [];
        }

        // Build location string
        const locationStr = city ? `${city} ${country}` : country;

        // Build search query
        const searchQuery = `best ${productType} for ${skinConcern} available in ${locationStr} buy online`.trim();

        // Map country names to gl codes for SerpAPI
        const countryToGl = {
            'USA': 'us',
            'United States': 'us',
            'UK': 'uk',
            'United Kingdom': 'uk',
            'Pakistan': 'pk',
            'India': 'in',
            'Canada': 'ca',
            'Australia': 'au',
            'Germany': 'de',
            'France': 'fr',
            'UAE': 'ae',
            'United Arab Emirates': 'ae',
            'Saudi Arabia': 'sa',
            'Singapore': 'sg',
            'Malaysia': 'my'
        };
        const glCode = countryToGl[country] || 'us';

        // Call SerpAPI Google Shopping endpoint
        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                engine: 'google_shopping',
                q: searchQuery,
                api_key: SERP_API_KEY,
                num: 5,
                gl: glCode
            }
        });

        const shoppingResults = response.data.shopping_results || [];

        // Parse price from string to number
        const parsePrice = (priceStr) => {
            if (!priceStr) return null;
            const match = priceStr.match(/[\d,]+\.?\d*/);
            if (match) {
                return parseFloat(match[0].replace(',', ''));
            }
            return null;
        };

        // Filter by budget
        const filterByBudget = (products) => {
            return products.filter(product => {
                const price = parsePrice(product.price);
                if (price === null) return true; // Include if price unknown

                switch (budget.toLowerCase()) {
                    case 'low':
                        return price < 15;
                    case 'medium':
                        return price >= 15 && price <= 50;
                    case 'high':
                        return true; // No filter for high budget
                    default:
                        return true;
                }
            });
        };

        // Map results to standardized format
        const mappedResults = shoppingResults.map(item => ({
            name: item.title || 'Unknown Product',
            price: item.price || 'Price not available',
            rating: item.rating || null,
            reviews: item.reviews || null,
            link: item.link || item.product_link || null,
            source: item.source || 'Unknown Store',
            thumbnail: item.thumbnail || null
        }));

        // Filter by budget and limit to 5 results
        const filteredResults = filterByBudget(mappedResults).slice(0, 5);

        return filteredResults;

    } catch (error) {
        console.error('Product search error:', error.message);
        return [];
    }
}

module.exports = { searchProducts };
