require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const { systemPrompt } = require('./prompt');
const { searchProducts } = require('./productSearch');
const { extractProductSteps } = require('./extractProducts');

const app = express();
const PORT = process.env.PORT || 3000;
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';

// Initialize AI clients
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Conversation history storage
let conversationHistory = [];

// No markdown formatting instruction
const noMarkdownInstruction = 'Never respond with markdown formatting like ### headers or **bold**. You MAY use bullet points (with - or numbers) for listing questions or options. Write routine advice in natural flowing paragraphs, not as bullet lists.';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Firebase config endpoint (serves env vars to frontend safely)
app.get('/firebase-config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || ''
    });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, image, pdfContent } = req.body;

        if (!message && !image && !pdfContent) {
            return res.status(400).json({ error: 'Message, image, or PDF content is required' });
        }

        // Build the prompt with optional PDF content
        let fullMessage = message || '';
        if (pdfContent) {
            fullMessage = `The user has shared this medical/skincare report: ${pdfContent}. Please factor relevant information into your skincare advice.\n\n${fullMessage}`;
        }

        // Add skin analysis instruction if image is present
        if (image) {
            const skinAnalysisInstruction = 'Please analyze this skin photo carefully. Look for: acne, oiliness, redness, dryness, texture issues, dark spots, enlarged pores. Factor your findings into your response.';
            fullMessage = fullMessage ? `${skinAnalysisInstruction}\n\n${fullMessage}` : skinAnalysisInstruction;
        }

        let response;

        if (AI_PROVIDER === 'anthropic') {
            response = await handleAnthropicChat(fullMessage, image);
        } else if (AI_PROVIDER === 'openai') {
            response = await handleOpenAIChat(fullMessage, image);
        } else {
            return res.status(400).json({ error: 'Invalid AI_PROVIDER in .env' });
        }

        // Add assistant response to history
        conversationHistory.push({
            role: 'assistant',
            content: response
        });

        res.json({ response });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error.message || 'An error occurred while processing your request' });
    }
});

// Anthropic (Claude) handler
async function handleAnthropicChat(message, image) {
    const userContent = [];

    if (image) {
        // Extract base64 data and media type
        const matches = image.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
            userContent.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: matches[1],
                    data: matches[2]
                }
            });
        }
    }

    if (message) {
        userContent.push({
            type: 'text',
            text: message
        });
    }

    // Add current user message to history
    conversationHistory.push({
        role: 'user',
        content: userContent
    });

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 4096,
        system: `${systemPrompt}\n\n${noMarkdownInstruction}`,
        messages: conversationHistory
    });

    return response.content[0].text;
}

// OpenAI (GPT-4o) handler
async function handleOpenAIChat(message, image) {
    const userContent = [];

    if (message) {
        userContent.push({
            type: 'text',
            text: message
        });
    }

    if (image) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: image
            }
        });
    }

    // Add current user message to history
    conversationHistory.push({
        role: 'user',
        content: userContent
    });

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'system',
                content: noMarkdownInstruction
            },
            ...conversationHistory
        ]
    });

    return response.choices[0].message.content;
}

// API endpoint to get current AI provider
app.get('/api/provider', (req, res) => {
    const providerName = AI_PROVIDER === 'anthropic' ? 'Claude' : 'GPT-4o';
    res.json({ provider: AI_PROVIDER, name: providerName });
});

// Reset conversation history
app.post('/api/reset', (req, res) => {
    conversationHistory = [];
    res.json({ success: true, message: 'Conversation history cleared' });
});

// PDF parsing endpoint
app.post('/api/parse-pdf', async (req, res) => {
    try {
        const { pdfBase64 } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No PDF data provided' });
        }

        // Convert base64 to buffer
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');

        // Parse PDF
        const pdfData = await pdfParse(pdfBuffer);
        const extractedText = pdfData.text.trim();

        if (!extractedText) {
            return res.json({
                success: true,
                text: '[PDF contained no readable text]',
                message: 'Report uploaded but no text could be extracted'
            });
        }

        res.json({
            success: true,
            text: extractedText,
            message: 'Report uploaded and ready'
        });
    } catch (error) {
        console.error('PDF parsing error:', error);
        res.status(500).json({
            error: 'Failed to parse PDF. Please ensure the file is a valid PDF document.',
            message: 'Could not read the PDF file'
        });
    }
});

// Product search endpoint
app.post('/api/products', async (req, res) => {
    try {
        const { routineText, skinConcern, budget, country, city } = req.body;

        if (!routineText) {
            return res.status(400).json({ error: 'Routine text is required' });
        }

        // Extract product steps from routine
        const productSteps = await extractProductSteps(routineText, skinConcern, budget);

        if (productSteps.length === 0) {
            return res.json({ products: [] });
        }

        console.log(`Found ${productSteps.length} product groups to search`);

        // Search for all products simultaneously
        const searchPromises = productSteps.map(async (step) => {
            try {
                const products = await searchProducts(
                    step.productType,
                    budget || 'medium',
                    country || 'USA',
                    skinConcern || '',
                    city || ''
                );
                return {
                    step: step.step,
                    productType: step.productType,
                    timeOfDay: step.timeOfDay,
                    products: products
                };
            } catch (error) {
                console.error(`Search failed for ${step.step}:`, error.message);
                return {
                    step: step.step,
                    productType: step.productType,
                    timeOfDay: step.timeOfDay,
                    products: []
                };
            }
        });

        const results = await Promise.all(searchPromises);

        res.json({ products: results });
    } catch (error) {
        console.error('Product search error:', error);
        res.status(500).json({ error: 'Failed to search for products' });
    }
});

// Dermatologist search endpoint (Google Places API)
app.post('/api/dermatologists', async (req, res) => {
    try {
        const { city, country, lat, lng } = req.body;
        const apiKey = process.env.GOOGLE_PLACES_KEY;

        // Mock data fallback if no API key or if Google API fails
        const getMockDoctors = () => [
            {
                name: "Dr. Sarah Jenkins",
                rating: 4.8,
                reviewCount: 342,
                address: "124 Skin Health Blvd, Medical District",
                phone: "+1 (555) 019-2834",
                website: "https://example.com/dr-jenkins",
                googleMapsUrl: "https://maps.google.com",
                isOpenNow: true,
                openingHours: ["Monday: 9AM–5PM", "Tuesday: 9AM–5PM"],
                priceLevel: "$$",
                photoUrl: null,
                topReview: { text: "Best dermatologist I've ever visited. Very thorough.", rating: 5, author: "Jane D." }
            },
            {
                name: "Advanced Dermatology Center",
                rating: 4.6,
                reviewCount: 890,
                address: "892 Wellness Ave, Suite 300",
                phone: "+1 (555) 018-9922",
                website: "https://example.com/advanced-derm",
                googleMapsUrl: "https://maps.google.com",
                isOpenNow: false,
                openingHours: ["Monday: 8AM–6PM"],
                priceLevel: "$$$",
                photoUrl: null,
                topReview: { text: "State of the art facility, but expect a wait.", rating: 4, author: "Mark S." }
            },
            {
                name: "Dr. Emily Chen Dermatology",
                rating: 4.9,
                reviewCount: 156,
                address: "45 Plaza Way, Suite 12",
                phone: "+1 (555) 222-1144",
                website: null,
                googleMapsUrl: "https://maps.google.com",
                isOpenNow: true,
                openingHours: [],
                priceLevel: "$$",
                photoUrl: null,
                topReview: null
            }
        ];

        // 1. Check if we have an API key and location coordinates
        if (!apiKey || !lat || !lng) {
            console.log("Using dermatologist mock data (No API key or coordinates provided)");
            return res.json({ results: getMockDoctors() });
        }

        // 2. Call Google Places Nearby Search
        const searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=doctor&keyword=dermatologist%20skin%20doctor&key=${apiKey}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
            throw new Error(`Places API search failed: ${searchData.status}`);
        }

        if (searchData.status === 'ZERO_RESULTS' || !searchData.results.length) {
            return res.json({ results: [] });
        }

        // Take up to 6 results
        const topResults = searchData.results.slice(0, 6);

        // 3. For each result, get details via Places Details API
        const detailPromises = topResults.map(async (place) => {
            try {
                const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,price_level,reviews,url&key=${apiKey}`;
                const detailRes = await fetch(detailsUrl);
                const detailData = await detailRes.json();
                
                if (detailData.status !== 'OK') return null;
                const d = detailData.result;

                // Process price level
                let priceStr = null;
                if (d.price_level) priceStr = '$'.repeat(d.price_level);

                // Process photo
                let photoUrl = null;
                if (d.photos && d.photos.length > 0) {
                    photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${d.photos[0].photo_reference}&key=${apiKey}`;
                }

                // Process top review
                let topReview = null;
                if (d.reviews && d.reviews.length > 0) {
                    const best = d.reviews.sort((a,b) => b.rating - a.rating)[0];
                    topReview = {
                        text: best.text,
                        rating: best.rating,
                        author: best.author_name
                    };
                }

                return {
                    name: d.name,
                    rating: d.rating || 0,
                    reviewCount: d.user_ratings_total || 0,
                    address: d.formatted_address || place.vicinity,
                    phone: d.formatted_phone_number || null,
                    website: d.website || null,
                    googleMapsUrl: d.url || `https://www.google.com/maps/search/?api=1&query=${place.geometry.location.lat},${place.geometry.location.lng}&query_place_id=${place.place_id}`,
                    isOpenNow: d.opening_hours ? !!d.opening_hours.open_now : null,
                    openingHours: d.opening_hours?.weekday_text || [],
                    priceLevel: priceStr,
                    photoUrl: photoUrl,
                    topReview: topReview
                };
            } catch (err) {
                console.error(`Failed to get details for place ${place.place_id}`, err);
                return null;
            }
        });

        // 4. Return the mapped array
        const results = (await Promise.all(detailPromises)).filter(Boolean);
        
        // Return results (or fallback if somehow all details failed)
        if (results.length > 0) {
            res.json({ results });
        } else {
             res.json({ results: getMockDoctors() });
        }

    } catch (error) {
        console.error('Dermatologist search error:', error);
        // Fallback on error
        const mockFn = () => [
             {
                 name: "Generic Clinic Mock",
                 rating: 4.5,
                 reviewCount: 100,
                 address: "API Failed, Mock Address",
                 phone: null,
                 website: null,
                 googleMapsUrl: null,
                 isOpenNow: null,
                 openingHours: [],
                 priceLevel: null,
                 photoUrl: null,
                 topReview: null
             }
         ];
        res.status(200).json({ results: mockFn(), error: "Used offline fallback data" });
    }
});

// Start server
app.listen(PORT, () => {
    const providerName = AI_PROVIDER === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI (GPT-4o)';
    console.log(`GlowGuide running on port ${PORT}`);
    console.log(`Active AI Provider: ${providerName}`);
});
