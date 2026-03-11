require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';

// Initialize AI clients
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

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

        let responseText;

        if (AI_PROVIDER === 'anthropic') {
            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-6-20250514',
                max_tokens: 2048,
                messages: [
                    {
                        role: 'user',
                        content: extractionPrompt
                    }
                ]
            });
            responseText = response.content[0].text;
        } else if (AI_PROVIDER === 'openai') {
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
            responseText = response.choices[0].message.content;
        } else {
            console.error('Invalid AI_PROVIDER');
            return [];
        }

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
