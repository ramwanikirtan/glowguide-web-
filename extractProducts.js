require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Extract product steps from a skincare routine using AI
 * @param {string} routineText - The full routine GlowGuide generated
 * @param {string} skinConcern - e.g. "acne", "dryness"
 * @param {string} budget - "low" / "medium" / "high"
 * @returns {Promise<Array>} Array of product step objects
 */
async function extractProductSteps(routineText, skinConcern = '', budget = 'medium') {
    try {
        if (!routineText) {
            return [];
        }

        const extractionPrompt = `Extract every product type from this skincare routine.
Return ONLY a valid JSON array, no other text.
Each object must have:
- step: step name e.g. 'Morning Cleanser'
- productType: specific searchable description e.g. 'gentle gel cleanser oily acne prone skin'
- timeOfDay: 'morning', 'evening', or 'both'
Example output:
[{"step":"Morning Cleanser","productType":"gentle gel cleanser oily skin","timeOfDay":"morning"}]

Skincare routine to extract from:
${routineText}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: extractionPrompt
                }
            ]
        });

        let responseText = response.choices[0].message.content;

        // Strip markdown formatting if present
        let cleanedResponse = responseText.trim();

        // Remove markdown code blocks
        cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
        cleanedResponse = cleanedResponse.replace(/```\s*/gi, '');

        // Remove any text before the first [ and after the last ]
        const startIndex = cleanedResponse.indexOf('[');
        const endIndex = cleanedResponse.lastIndexOf(']');

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            cleanedResponse = cleanedResponse.substring(startIndex, endIndex + 1);
        }

        // Parse JSON
        const products = JSON.parse(cleanedResponse);

        // Validate it's an array
        if (!Array.isArray(products)) {
            console.error('Extracted data is not an array');
            return [];
        }

        return products;

    } catch (error) {
        console.error('Extract products error:', error.message);
        return [];
    }
}

module.exports = { extractProductSteps };
