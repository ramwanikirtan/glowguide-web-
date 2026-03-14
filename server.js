require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
// const Anthropic = require('@anthropic-ai/sdk');  // Disabled — use GPT-4o
const OpenAI = require('openai');
const axios = require('axios');

// ══════════════════════════════════════════════
// NATIVE HTTPS HELPERS  (bypass fetch/axios issues with Nominatim & Overpass)
// ══════════════════════════════════════════════
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'GlowGuide/1.0 (skincare-app)',
                'Accept': 'application/json',
                ...headers
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Non-JSON response from ' + urlObj.hostname + ': ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
        req.end();
    });
}

function httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const postData = body;
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'GlowGuide/1.0 (skincare-app)',
                'Accept': 'application/json',
                ...headers
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Non-JSON response from ' + urlObj.hostname + ': ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(45000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
        req.write(postData);
        req.end();
    });
}

// Simple in-memory cache for Overpass results (avoids rate-limits)
const dermCache = new Map();
const DERM_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const pdfParse = require('pdf-parse');
const { systemPrompt } = require('./prompt');
const { searchProducts, getCuratedProducts } = require('./productSearch');
const { extractProductSteps } = require('./extractProducts');
const { buildRecommendation, buildEvidenceSummary, ingredientsDb } = require('./clinical-engine');
const { getAdjustmentAdvice, computeExperienceProgression, buildProgressSummary } = require('./feedback-engine');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize AI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Conversation history storage
let conversationHistory = [];

// Intake state — tracks the 6 consultation questions. Reset when session resets.
let intakeState = {
    q1_concern: null,
    q2_skinType: null,
    q3_routine: null,
    q4_sensitivities: null,
    q5_budget: null,
    q6_extra: null,
    complete: false
};

// ── Universal product fallbacks per routine step ────────────────────────────
function getUniversalDefaultsForStep(step, budget, skinType) {
    try {
        const key = (step.stepKey || '').toLowerCase();
        const name = (step.stepName || '').toLowerCase();
        const skin = skinType || '';

        // Helper to merge multiple curated ingredient keys and dedupe by name
        const mergeFromIngredients = (ingredientKeys) => {
            const seen = new Set();
            const merged = [];
            for (const ing of ingredientKeys) {
                const list = getCuratedProducts(ing, budget, skin);
                for (const p of list) {
                    const id = (p.brand || '') + '::' + (p.name || '');
                    if (seen.has(id)) continue;
                    seen.add(id);
                    merged.push(p);
                }
            }
            return merged.slice(0, 3);
        };

        // Moisturizer: always safe trio
        if (key === 'moisturizer' || name.includes('moistur')) {
            // CeraVe Moisturizing Cream (Ceramides), Neutrogena Hydro Boost (Hyaluronic),
            // La Roche-Posay Toleriane Double Repair (Glycerin/Ceramides)
            return mergeFromIngredients(['Ceramides', 'Hyaluronic Acid', 'Glycerin']);
        }

        // Cleanser: gentle, non-stripping cleansers
        if (key === 'cleanser' || name.includes('cleanser') || name.includes('face wash')) {
            return mergeFromIngredients(['face wash', 'Cleanser']);
        }

        // SPF: broad-spectrum sunscreens
        if (key === 'spf' || name.includes('spf') || name.includes('sunscreen')) {
            return mergeFromIngredients(['SPF Sunscreen', 'Zinc Oxide']);
        }

        // Serums / treatment serums: use high-safety, broadly beneficial actives
        if (key === 'serum' || key === 'treatment_serum' || key === 'serum_or_moisturizer' || name.includes('serum')) {
            return mergeFromIngredients(['Niacinamide', 'Hyaluronic Acid', 'Vitamin C']);
        }

        // Exfoliant / toner: prefer gentle acids
        if (key === 'exfoliant_toner' || name.includes('exfoliate') || name.includes('toner')) {
            return mergeFromIngredients(['Glycolic Acid', 'Lactic Acid']);
        }

        // Eye cream: hydrating, barrier-supportive
        if (key === 'eye_cream' || name.includes('eye')) {
            return mergeFromIngredients(['Peptides', 'Ceramides']);
        }

        // Face oil: non-comedogenic base oils
        if (key === 'face_oil' || name.includes('oil')) {
            return mergeFromIngredients(['Squalane', 'Jojoba Oil']);
        }

        // Spot treatment: targeted acne-safe actives
        if (key === 'spot_treatment' || name.includes('spot')) {
            return mergeFromIngredients(['Salicylic Acid', 'Benzoyl Peroxide']);
        }

        // Fallback: if nothing matched, return a safe hydrating trio
        return mergeFromIngredients(['Hyaluronic Acid', 'Ceramides', 'Glycerin']);
    } catch (e) {
        console.error('[Products] Universal fallback error:', e.message);
        return [];
    }
}

const INTAKE_KEYS = ['q1_concern', 'q2_skinType', 'q3_routine', 'q4_sensitivities', 'q5_budget', 'q6_extra'];

// No markdown formatting instruction
const noMarkdownInstruction = 'Never respond with markdown formatting like ### headers or **bold**. Never use bullet points (- or •). Use only [OPTIONS], [CHAT], [ROUTINE], [ANALYSIS], or [INFO] format tags for all responses. No bullets ever.';

// ══════════════════════════════════════════════
// PERSISTENT PYTHON MODEL PROCESS (FIX 3)
// Keeps ML model loaded — eliminates 3-5s startup on every request
// ══════════════════════════════════════════════
let pythonProcess = null;
let pythonReady = false;
const pendingModelRequests = new Map();
let modelOutputBuffer = '';

function startPythonModel() {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const script = path.join(__dirname, 'ml_pipeline', 'inference_server.py');
    // If inference_server.py doesn't exist yet, skip gracefully
    if (!fs.existsSync(script)) {
        console.warn('[ML] inference_server.py not found — model will use legacy spawn fallback');
        return;
    }
    pythonProcess = spawn(py, [script]);
    modelOutputBuffer = '';

    pythonProcess.stdout.on('data', (data) => {
        modelOutputBuffer += data.toString();
        const lines = modelOutputBuffer.split('\n');
        modelOutputBuffer = lines.pop(); // keep incomplete line
        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line);
                if (msg.ready) { pythonReady = true; console.log('[ML] Model loaded and ready'); return; }
                if (msg.requestId) {
                    const cb = pendingModelRequests.get(msg.requestId);
                    if (cb) { pendingModelRequests.delete(msg.requestId); cb.resolve(msg.result || msg.error); }
                }
            } catch (_) {}
        });
    });

    pythonProcess.stderr.on('data', d => process.stderr.write('[ML] ' + d));

    pythonProcess.on('close', (code) => {
        console.warn('[ML] Python process exited (code ' + code + ') — restarting in 2s');
        pythonReady = false;
        pythonProcess = null;
        setTimeout(startPythonModel, 2000);
    });
}

// Start persistent model on server boot
startPythonModel();

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

// ══════════════════════════════════════════════
// STREAMING CHAT ENDPOINT (FIX 1)
// ══════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
    const { message, image, imageType, pdfContent, skinProfile, sessionHistory } = req.body;

    if (!message && !image && !pdfContent) {
        return res.status(400).json({ error: 'Message, image, or PDF content is required' });
    }

    // Set SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');
    const sendDone  = () => { res.write('data: [DONE]\n\n'); res.end(); };
    const sendError = (msg) => { res.write('data: [ERROR] ' + msg + '\n\n'); res.end(); };

    try {
        if (image) {
            await handleImageWithStreaming({ message, image, imageType, pdfContent, skinProfile, sessionHistory }, res, sendEvent, sendDone, sendError);
        } else {
            await handleTextWithStreaming({ message, pdfContent, skinProfile, sessionHistory }, res, sendEvent, sendDone, sendError);
        }
    } catch (e) {
        console.error('[stream] Unhandled error:', e.message);
        sendError(e.message);
    }
});

async function handleTextWithStreaming(body, res, sendEvent, sendDone, sendError) {
    const { message, pdfContent, skinProfile, sessionHistory } = body;

    let fullMessage = message || '';
    if (pdfContent) fullMessage = `The user has shared this medical/skincare report: ${pdfContent}. Please factor relevant information into your skincare advice.\n\n${fullMessage}`;

    const historySnapshot = Array.isArray(sessionHistory) && sessionHistory.length > 0
        ? sessionHistory.map(m => ({ role: m.role, content: m.content }))
        : [...conversationHistory];

    // Intake tracking
    if (!intakeState.complete) {
        const priorUserMessages = historySnapshot.filter(m => m.role === 'user').length;
        if (priorUserMessages >= 1 && priorUserMessages <= 6) {
            const key = INTAKE_KEYS[priorUserMessages - 1];
            if (intakeState[key] === null) intakeState[key] = fullMessage;
        }
        if (INTAKE_KEYS.every(k => intakeState[k] !== null)) intakeState.complete = true;
    }

    const extraSystemMessages = [];
    if (intakeState.complete) {
        extraSystemMessages.push({ role: 'system', content: `INTAKE COMPLETE. All 6 questions answered.\nUser answers: ${JSON.stringify(intakeState)}\nGenerate the [ROUTINE] block now. Do not ask any more questions.` });
    }
    extraSystemMessages.push({ role: 'system', content: 'REMINDER: No bullet points ever. Use [OPTIONS], [CHAT], [ROUTINE], [ANALYSIS], or [INFO] only. One question per message maximum. If intake complete — output [ROUTINE] now.' });

    // FIX 4 — use gpt-4o-mini for short, simple chat to save ~1s latency
    const isSimpleChat = fullMessage.length < 200 &&
        !fullMessage.toLowerCase().includes('routine') &&
        !fullMessage.toLowerCase().includes('analy') &&
        !fullMessage.toLowerCase().includes('recommend') &&
        !intakeState.complete;
    const model = isSimpleChat ? 'gpt-4o-mini' : 'gpt-4o';

    const activeSystemPrompt = buildSystemPrompt(skinProfile);

    const stream = await openai.chat.completions.create({
        model,
        max_tokens: isSimpleChat ? 600 : 1000,
        stream: true,
        messages: [
            { role: 'system', content: activeSystemPrompt || systemPrompt },
            { role: 'system', content: noMarkdownInstruction },
            ...historySnapshot,
            ...extraSystemMessages,
            { role: 'user', content: fullMessage }
        ]
    });

    let fullText = '';
    for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
            fullText += token;
            sendEvent({ token });
        }
    }

    // Update server-side history
    conversationHistory.push({ role: 'user', content: fullMessage });
    conversationHistory.push({ role: 'assistant', content: fullText });
    if (conversationHistory.length > 40) conversationHistory.splice(0, conversationHistory.length - 40);

    sendDone();
}

async function handleImageWithStreaming(body, res, sendEvent, sendDone, sendError) {
    const { message, image, imageType, pdfContent, skinProfile, sessionHistory } = body;

    const historySnapshot = Array.isArray(sessionHistory) && sessionHistory.length > 0
        ? sessionHistory.map(m => ({ role: m.role, content: m.content }))
        : [...conversationHistory];

    // Stage 1 — immediate acknowledgment
    sendEvent({ status: 'analyzing', stage: 1, message: 'Photo received — running analysis...' });

    const tempPath = path.join(os.tmpdir(), 'glowguide_' + Date.now() + '.jpg');
    try { fs.writeFileSync(tempPath, Buffer.from(image, 'base64')); } catch (e) { console.warn('[image] temp write failed:', e.message); }

    // Stage 2 — run model
    sendEvent({ status: 'analyzing', stage: 2, message: 'Running skin analysis model...' });

    const [modelResult, gptResult] = await Promise.allSettled([
        runCustomModel(tempPath),
        runGPTVision(image, imageType)
    ]);

    try { fs.unlinkSync(tempPath); } catch (_) {}

    if (modelResult.status === 'rejected') console.error('[GlowGuide] Custom model failed:', modelResult.reason?.message);
    if (gptResult.status === 'rejected')   console.error('[GlowGuide] GPT vision failed:',   gptResult.reason?.message);

    const combined = combineResults(
        modelResult.status === 'fulfilled' ? modelResult.value : null,
        gptResult.status  === 'fulfilled'  ? gptResult.value  : null
    );
    console.log('[GlowGuide] Combined results:', JSON.stringify(combined, null, 2));

    // Stage 3 — stream the report
    sendEvent({ status: 'generating', stage: 3, message: 'Writing your personalized report...' });

    const activeSystemPrompt = buildSystemPrompt(skinProfile);
    const reportPrompt = buildReportPrompt(combined, skinProfile, historySnapshot, activeSystemPrompt);

    const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1200,
        stream: true,
        messages: [
            { role: 'system', content: activeSystemPrompt || systemPrompt },
            { role: 'system', content: noMarkdownInstruction },
            { role: 'system', content: 'REMINDER: No bullet points ever. Use [ANALYSIS] block format.' },
            { role: 'user',   content: reportPrompt }
        ]
    });

    let fullText = '';
    for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) { fullText += token; sendEvent({ token }); }
    }

    const validated = validateReport(fullText, combined);
    // If validation modified the text, resend the full corrected version
    if (validated !== fullText) sendEvent({ corrected: validated });

    conversationHistory.push({ role: 'user', content: message || '[Skin photo analysis]' });
    conversationHistory.push({ role: 'assistant', content: validated });
    if (conversationHistory.length > 40) conversationHistory.splice(0, conversationHistory.length - 40);

    sendDone();
}

// Helper: build the full report prompt (extracted from generateFinalReport so it can be streamed)
function buildReportPrompt(combined, skinProfile, history, activeSystemPrompt) {
    const acneStatus = combined.acne?.detected
        ? `\u26a0\ufe0f DETECTED \u2014 severity: ${severityLabel(combined.acne.severity)} (score: ${combined.acne.severity})`
        : '\u2713 Not detected';
    const concernLines = [
        combined.acne?.detected         ? `- Acne | ${severityLabel(combined.acne.severity)} | Active breakouts detected.` : '',
        combined.pores?.detected        ? `- Enlarged Pores | ${severityLabel(combined.pores.severity)} | Visible pores.` : '',
        combined.pigmentation?.detected ? `- Pigmentation | ${severityLabel(combined.pigmentation.severity)} | Uneven tone.` : '',
        combined.wrinkles?.detected     ? `- Wrinkles | ${severityLabel(combined.wrinkles.severity)} | Fine lines.` : ''
    ].filter(Boolean).join('\n') || '- No significant concerns detected';

    return `Based on the analysis results below, write a compassionate and clinically accurate skin report.

ACTUAL ANALYSIS DATA (do not contradict this):
Acne: ${acneStatus}
Pores: ${combined.pores?.detected ? 'DETECTED ' + severityLabel(combined.pores.severity) : 'not detected'}
Pigmentation: ${combined.pigmentation?.detected ? 'DETECTED ' + severityLabel(combined.pigmentation.severity) : 'not detected'}
Wrinkles: ${combined.wrinkles?.detected ? 'DETECTED ' + severityLabel(combined.wrinkles.severity) : 'not detected'}
Skin Type: ${combined.skinType}
Texture: ${combined.texture || 'N/A'}
Redness: ${combined.redness?.severity || 'none'}
Dark Circles: ${combined.darkCircles?.severity || 'none'}
Hydration: ${combined.hydration?.level || 'N/A'} \u2014 ${combined.hydration?.notes || 'N/A'}
Urgent concerns: ${combined.urgent || 'none'}
${skinProfile ? '\nUSER PREVIOUS PROFILE: ' + JSON.stringify(skinProfile) : ''}

Write the report using EXACTLY this format:
[ANALYSIS]
SUMMARY: Honest 2 sentence summary mentioning the most significant findings
SKIN_TYPE: ${combined.skinType} \u2014 brief explanation
TEXTURE: ${combined.texture || 'N/A'}
CONCERNS:
${concernLines}
POSITIVE:
- genuine positives only
HYDRATION: ${combined.hydration?.level || 'N/A'}
URGENT: ${combined.urgent || 'none'}
NEXT: Specific follow-up question based on most significant finding
[/ANALYSIS]`;
}

// ══════════════════════════════════════════════
// PARALLEL IMAGE ANALYSIS PIPELINE
// ══════════════════════════════════════════════

function runCustomModel(imagePath) {
    // Use persistent process if ready (FIX 3 — no 3-5s startup)
    if (pythonReady && pythonProcess) {
        const requestId = Date.now().toString() + Math.random().toString(36).slice(2);
        return new Promise((resolve, reject) => {
            pendingModelRequests.set(requestId, { resolve, reject });
            pythonProcess.stdin.write(JSON.stringify({ requestId, imagePath }) + '\n');
            setTimeout(() => {
                if (pendingModelRequests.has(requestId)) {
                    pendingModelRequests.delete(requestId);
                    reject(new Error('Model timeout after 15s'));
                }
            }, 15000);
        });
    }

    // Legacy fallback — spawn a one-shot process when persistent model not ready
    return new Promise((resolve, reject) => {
        const py = process.platform === 'win32' ? 'python' : 'python3';
        const scriptPath = path.join(__dirname, 'ml_pipeline', 'inference.py');
        const proc = spawn(py, [scriptPath, imagePath]);
        let out = '', err = '';
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { err += d; });
        const timer = setTimeout(() => { proc.kill(); reject(new Error('Model timeout after 20s')); }, 20000);
        proc.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                console.error('[GlowGuide] Model stderr:', err.slice(0, 400));
                return reject(new Error('Model process exited with code ' + code));
            }
            try { resolve(JSON.parse(out.trim())); }
            catch (e) { reject(new Error('Model JSON parse failed: ' + out.slice(0, 200))); }
        });
    });
}

async function runGPTVision(imageBase64, imageType) {
    const visionPrompt = `Analyze this skin photo and return ONLY a valid JSON object with exactly these fields. No text outside the JSON, no markdown, no code fences.

{
  "texture": "detailed texture description of the skin surface",
  "redness": {
    "detected": true or false,
    "severity": "none" or "mild" or "moderate" or "severe",
    "location": "describe location on face or null"
  },
  "darkCircles": {
    "detected": true or false,
    "severity": "none" or "mild" or "moderate" or "severe"
  },
  "hydration": {
    "level": "well-hydrated" or "mildly-dehydrated" or "dehydrated",
    "notes": "brief observation about skin hydration"
  },
  "overallImpression": "one warm sentence about the overall skin condition",
  "urgent": "describe any urgent concern like infection or unusual growth, or null if none",
  "positives": ["genuine positive observation", "another positive observation"]
}`;

    const r = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 600,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: visionPrompt },
                { type: 'image_url', image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}`, detail: 'high' } }
            ]
        }]
    });
    const raw = r.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(raw);
}

function combineResults(modelData, gptData) {
    return {
        skinType: modelData?.skinType || 'Unknown',
        skinTypeConfidence: modelData?.skinTypeConfidence || null,
        acne: modelData?.acne || null,
        pigmentation: modelData?.pigmentation || null,
        wrinkles: modelData?.wrinkles || null,
        pores: modelData?.pores || null,
        overallSeverity: modelData?.overallSeverity || null,
        texture: gptData?.texture || null,
        redness: gptData?.redness || null,
        darkCircles: gptData?.darkCircles || null,
        hydration: gptData?.hydration || null,
        overallImpression: gptData?.overallImpression || null,
        urgent: gptData?.urgent || null,
        positives: gptData?.positives || [],
        modelUsed: !!modelData,
        gptUsed: !!gptData
    };
}

function severityLabel(score) {
    if (!score && score !== 0) return 'mild';
    if (score < 0.3) return 'mild';
    if (score < 0.6) return 'moderate';
    return 'severe';
}

async function generateFinalReport(combined, skinProfile, history, activeSystemPrompt) {
    const acneStatus = combined.acne?.detected
        ? `⚠️ DETECTED — severity: ${severityLabel(combined.acne.severity)} (score: ${combined.acne.severity})`
        : '✓ Not detected';
    const pigStatus = combined.pigmentation?.detected
        ? `⚠️ DETECTED — severity: ${severityLabel(combined.pigmentation.severity)}`
        : '✓ Not detected';
    const wrinkStatus = combined.wrinkles?.detected
        ? `⚠️ DETECTED — severity: ${severityLabel(combined.wrinkles.severity)}`
        : '✓ Not detected';
    const poreStatus = combined.pores?.detected
        ? `⚠️ DETECTED — severity: ${severityLabel(combined.pores.severity)}`
        : '✓ Not detected';

    const concernLines = [
        combined.acne?.detected          ? `- Acne | ${severityLabel(combined.acne.severity)} | description of what this means and recommended next steps` : '',
        combined.pigmentation?.detected  ? `- Pigmentation | ${severityLabel(combined.pigmentation.severity)} | description of uneven tone and treatment approach` : '',
        combined.pores?.detected         ? `- Enlarged Pores | ${severityLabel(combined.pores.severity)} | description of pore visibility and minimizing steps` : '',
        combined.wrinkles?.detected      ? `- Wrinkles | ${severityLabel(combined.wrinkles.severity)} | description of fine lines and prevention/treatment` : '',
        combined.redness?.detected       ? `- Redness | ${combined.redness.severity} | ${combined.redness.location || 'visible redness noted'}` : ''
    ].filter(Boolean).join('\n') || '- No significant concerns detected';

    const prompt = `You are a clinical skincare AI assistant. Your job is to report EXACTLY what the analysis data shows. Be accurate and honest. Do NOT soften or hide detected conditions. Do NOT say skin is healthy if conditions are detected. Users need accurate information to get the right skincare advice.

ANALYSIS DATA — report this EXACTLY:

SKIN TYPE: ${combined.skinType}

DETECTED CONDITIONS (from 99% accurate trained model):
Acne: ${acneStatus}
Pigmentation: ${pigStatus}
Wrinkles: ${wrinkStatus}
Enlarged Pores: ${poreStatus}
Overall Severity Score: ${combined.overallSeverity}/1.0

VISUAL OBSERVATIONS:
Texture: ${combined.texture || 'N/A'}
Redness: ${combined.redness?.severity || 'none'} ${combined.redness?.location || ''}
Dark Circles: ${combined.darkCircles?.severity || 'none'}
Hydration: ${combined.hydration?.level || 'N/A'} — ${combined.hydration?.notes || 'N/A'}
Urgent concerns: ${combined.urgent || 'none'}
${skinProfile ? '\nUSER PREVIOUS PROFILE: ' + JSON.stringify(skinProfile) : ''}

STRICT REPORTING RULES:
1. If acne is detected — YOU MUST mention acne prominently in the CONCERNS section.
2. If severity score > 0.5 — do NOT call skin healthy or resilient.
3. Only list positives that are genuinely supported by the data.
4. If a condition is detected — state it clearly and directly, not softened.
5. The SUMMARY must reflect the most significant detected conditions.
6. Do not use words like "youthful", "resilient", or "healthy" unless the data genuinely supports it.
7. Be compassionate but honest — users need accurate results to get the right skincare advice.

Write the report using EXACTLY this format:

[ANALYSIS]
SUMMARY: Honest 2 sentence summary mentioning the most significant findings
SKIN_TYPE: ${combined.skinType} — brief explanation
TEXTURE: ${combined.texture || 'N/A'}
CONCERNS:
${concernLines}
POSITIVE:
- Only genuine positives from the data — keep brief if severity is high
HYDRATION: ${combined.hydration?.level || 'N/A'} — note
URGENT: ${combined.urgent || 'none'}
NEXT: Specific follow-up question based on the most significant detected condition
[/ANALYSIS]

IMPORTANT: The [ANALYSIS] block must reflect the actual data above. If the data shows acne detected = true, the report MUST list acne in CONCERNS. Do not contradict the data.`;

    const resp = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1200,
        messages: [
            { role: 'system', content: `${activeSystemPrompt || systemPrompt}\n\n${noMarkdownInstruction}` },
            ...(history || []),
            { role: 'system', content: 'REMINDER: No bullet points ever. Use [OPTIONS], [CHAT], [ROUTINE], [ANALYSIS], or [INFO] only. One question per message maximum.' },
            { role: 'user', content: prompt }
        ]
    });
    return resp.choices[0].message.content;
}

// ══════════════════════════════════════════════
// REPORT VALIDATION & FALLBACK
// ══════════════════════════════════════════════

function validateReport(report, combined) {
    const issues = [];
    const lower = report.toLowerCase();

    if (combined.acne?.detected && combined.acne.severity > 0.3 && !lower.includes('acne')) {
        issues.push('Acne detected but not mentioned in report');
    }
    if (combined.overallSeverity > 0.5 &&
        (lower.includes('healthy skin') || lower.includes('great condition') ||
         lower.includes('youthful') || lower.includes('resilient'))) {
        issues.push('High severity but report is too positive');
    }

    if (issues.length > 0) {
        console.error('[GlowGuide] Report validation failed:', issues);
        return generateFallbackReport(combined);
    }
    return report;
}

function generateFallbackReport(combined) {
    const conditions = [];
    if (combined.acne?.detected)         conditions.push('acne (' + severityLabel(combined.acne.severity) + ')');
    if (combined.pigmentation?.detected) conditions.push('pigmentation');
    if (combined.pores?.detected)        conditions.push('enlarged pores');
    if (combined.wrinkles?.detected)     conditions.push('wrinkles');
    const conditionsList = conditions.length > 0 ? conditions.join(', ') : 'no major concerns';

    const concernLines = [
        combined.acne?.detected         ? `- Acne | ${severityLabel(combined.acne.severity)} | Active breakouts detected. This is treatable with the right routine.` : '',
        combined.pores?.detected        ? `- Enlarged Pores | ${severityLabel(combined.pores.severity)} | Pores are visible and can be minimized with proper care.` : '',
        combined.pigmentation?.detected ? `- Pigmentation | ${severityLabel(combined.pigmentation.severity)} | Uneven skin tone detected.` : '',
        combined.wrinkles?.detected     ? `- Wrinkles | ${severityLabel(combined.wrinkles.severity)} | Fine lines detected — addressable with targeted care.` : ''
    ].filter(Boolean).join('\n') || '- No significant concerns detected';

    const nextQuestion = combined.acne?.detected
        ? `Based on the detected acne, shall I build you a targeted routine for acne-prone ${combined.skinType.toLowerCase()} skin?`
        : `Would you like me to build a personalised routine for your ${combined.skinType.toLowerCase()} skin?`;

    return `[ANALYSIS]
SUMMARY: Our analysis detected ${conditionsList} in your skin. Here is what we found and what we recommend.
SKIN_TYPE: ${combined.skinType} — tailored advice follows
TEXTURE: ${combined.texture || 'Assessment completed'}
CONCERNS:
${concernLines}
POSITIVE:
- Early detection means we can build the right routine now
- Your skin concerns are all addressable with consistent care
HYDRATION: ${combined.hydration?.level || 'Monitor daily water intake'}
URGENT: ${combined.urgent || 'none'}
NEXT: ${nextQuestion}
[/ANALYSIS]`;
}

// Build system prompt enriched with skin profile context
function buildSystemPrompt(skinProfile) {
    if (!skinProfile || !skinProfile.skinType) return systemPrompt;
    const concerns = Array.isArray(skinProfile.concerns)
        ? skinProfile.concerns.map(c => (typeof c === 'object' ? c.name : c)).join(', ')
        : (skinProfile.concerns || skinProfile.concern || 'Unknown');
    const lastDate = skinProfile.analyzedAt
        ? new Date(skinProfile.analyzedAt).toLocaleDateString()
        : (skinProfile.lastConsult || 'Unknown');
    const profileBlock = `\n\nRETURNING USER — KNOWN SKIN PROFILE:\nDo not ask about anything already known. Reference their profile naturally in responses.\nSkin Type: ${skinProfile.skinType || 'Unknown'}\nMain Concern: ${skinProfile.concern || concerns || 'Unknown'}\nTexture: ${skinProfile.texture || 'Unknown'}\nLast Analyzed: ${lastDate}\n\nWhen this user starts a new session greet them as a returning user and briefly reference their known skin profile before asking new questions.`;
    return systemPrompt + profileBlock;
}

// OpenAI (GPT-4o) handler — stateless, receives history snapshot
async function handleOpenAIChat(message, image, imageType, history, activeSystemPrompt, extraSystemMessages = []) {
    const userContent = [];

    userContent.push({
        type: 'text',
        text: message || 'Please analyze the skin in this photo. Describe skin type, texture, visible concerns (acne, pores, redness, dark spots, oiliness/dryness). Focus only on skin condition, not on identifying the person.'
    });

    if (image) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:${imageType || 'image/jpeg'};base64,${image}`,
                detail: 'high'
            }
        });
    }

    // Use the history snapshot passed in + current user message
    const apiMessages = [
        ...history,
        { role: 'user', content: userContent }
    ];

    console.log('[GlowGuide] Sending to GPT-4o — image blocks:', userContent.filter(c => c.type === 'image_url').length, '| history msgs:', apiMessages.length);

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
            { role: 'system', content: activeSystemPrompt || systemPrompt },
            { role: 'system', content: noMarkdownInstruction },
            ...history,
            ...extraSystemMessages,
            { role: 'user', content: userContent }
        ]
    });

    return response.choices[0].message.content;
}

// Generate a short session title from the first user message
app.post('/api/generate-title', async (req, res) => {
    try {
        const { firstMessage } = req.body;
        if (!firstMessage || firstMessage.trim().length < 3) return res.json({ title: 'New Consultation' });
        const prompt = `Create a 4-6 word title for a skincare consultation that started with: "${firstMessage.slice(0, 200)}"\nRules:\n- Return the title ONLY, nothing else\n- No quotes, no punctuation at end\n- Capitalize Each Word\n- If message is a greeting or unclear, return exactly: New Consultation\nExamples:\n"my skin is oily" → Oily Skin Consultation\n"analyze my skin photo" → Skin Photo Analysis Session\n"what supplements for dry skin" → Supplements For Dry Skin\n"hi" → New Consultation`;
        const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: 20, messages: [{ role: 'user', content: prompt }] });
        let title = r.choices[0].message.content.trim().replace(/["'.,!]+$/, '');
        if (!title || title.length > 60) title = 'New Consultation';
        res.json({ title });
    } catch { res.json({ title: 'New Consultation' }); }
});

// AI provider endpoint
app.get('/api/provider', (req, res) => {
    res.json({ provider: 'openai', name: 'GPT-4o' });
});

// Reset conversation history
app.post('/api/reset', (req, res) => {
    conversationHistory = [];
    intakeState = { q1_concern: null, q2_skinType: null, q3_routine: null, q4_sensitivities: null, q5_budget: null, q6_extra: null, complete: false };
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

// ══════════════════════════════════════════════
// CLINICAL RECOMMENDATION ENGINE — Layer 2 + 3
// Builds routine + GPT-4o personalized explanation
// ══════════════════════════════════════════════
app.post('/api/recommend', async (req, res) => {
    try {
        const { skinProfile, checkinResponse, checkinHistory } = req.body;

        if (!skinProfile) {
            return res.status(400).json({ error: 'skinProfile is required' });
        }

        // ── Layer 2: Clinical engine ──
        const recommendation = buildRecommendation(skinProfile);

        // ── Layer 4: Feedback adjustment ──
        let feedbackAdvice = null;
        if (checkinResponse) {
            feedbackAdvice = getAdjustmentAdvice(checkinResponse, skinProfile);
        }
        const progressSummary = buildProgressSummary(checkinHistory || []);
        if (checkinHistory && checkinHistory.length > 0) {
            recommendation.experience = computeExperienceProgression(
                checkinHistory, recommendation.experience
            );
        }

        // ── Layer 3: GPT-4o personalized explanation ──
        let gptExplanation = '';
        let gptTips = [];
        try {
            const conditionText = recommendation.conditions.join(', ') || 'general skin health';
            const ingredientList = recommendation.selectedIngredients.slice(0, 5).join(', ');
            const warningText = recommendation.interactions.length > 0
                ? ` Key interaction note: ${recommendation.interactions[0].fix}`
                : '';

            const gptPrompt = `You are a board-certified dermatologist.
A patient has the following skin profile:
- Skin type: ${recommendation.skinType}
- Detected conditions: ${conditionText}
- Overall severity: ${recommendation.severity} (${Math.round(recommendation.overallSeverity * 100)}%)
- Experience level: ${recommendation.experience}

Their personalized protocol uses these key ingredients: ${ingredientList}.${warningText}

Write a concise, warm, clinical 2–3 sentence explanation of WHY this specific routine was chosen for them.
Then provide exactly 3 short tip bullets (each under 12 words), starting each with a relevant emoji.
Format your full response as valid JSON:
{
  "explanation": "...",
  "tips": ["💧 tip one", "⚡ tip two", "🌙 tip three"]
}`;

            const gptRes = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: gptPrompt }],
                temperature: 0.7,
                max_tokens: 300,
                response_format: { type: 'json_object' },
            });
            const parsed = JSON.parse(gptRes.choices[0].message.content);
            gptExplanation = parsed.explanation || '';
            gptTips = parsed.tips || [];
        } catch (gptErr) {
            console.error('[Recommend] GPT explanation failed:', gptErr.message);
            gptExplanation = `Your ${recommendation.severity} ${recommendation.conditions[0] || 'skin'} protocol was built using ${recommendation.selectedIngredients.length} clinically-validated ingredients matched to your skin type and severity score.`;
            gptTips = ['💡 Introduce actives one at a time', '☀️ Always apply SPF in the morning', '🌙 Retinol and AHAs go in your evening routine'];
        }

        // ── Search for products per routine step ──
        const budget = req.body.budget || 'medium';
        const country = req.body.country || 'USA';
        const city = req.body.city || '';
        const allSteps = [
            ...recommendation.routine.morning.map(s => ({ ...s, time: 'morning' })),
            ...recommendation.routine.evening.map(s => ({ ...s, time: 'evening' })),
        ];

        const productSearches = allSteps.slice(0, 12).map(async (step) => {
            try {
                const query = `${step.primaryIngredient} ${step.stepName} skincare`;
                const results = await searchProducts(query, budget, country, recommendation.conditions[0] || '', city);
                let products = (results || []).slice(0, 4);

                // If curated + web search yielded nothing, fall back to universal curated defaults
                if (!products.length) {
                    products = getUniversalDefaultsForStep(step, budget, recommendation.skinType);
                }

                return { stepKey: step.stepKey, stepName: step.stepName, time: step.time, products };
            } catch (err) {
                console.error('[Products] Search failed for step', step.stepKey, '-', err.message);
                const products = getUniversalDefaultsForStep(step, budget, recommendation.skinType);
                return { stepKey: step.stepKey, stepName: step.stepName, time: step.time, products };
            }
        });

        const productResults = await Promise.all(productSearches);
        const productsByStep = {};
        for (const r of productResults) {
            productsByStep[`${r.time}_${r.stepKey}`] = r.products;
        }

        res.json({
            recommendation,
            gptExplanation,
            gptTips,
            productsByStep,
            feedbackAdvice,
            progressSummary,
        });

    } catch (error) {
        console.error('[Recommend] Error:', error);
        res.status(500).json({ error: 'Failed to build recommendation' });
    }
});

// ── Ingredient evidence lookup ──
app.get('/api/ingredient/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name);
    const evidence = buildEvidenceSummary(name);
    if (!evidence) return res.status(404).json({ error: 'Ingredient not found' });
    res.json(evidence);
});

// ── Feedback check-in endpoint ──
app.post('/api/checkin', async (req, res) => {
    try {
        const { response, skinProfile, checkinHistory } = req.body;
        if (!response) return res.status(400).json({ error: 'response is required' });

        const advice = getAdjustmentAdvice(response, skinProfile || {});
        const newExp = computeExperienceProgression(checkinHistory || [], skinProfile?.experience || 'beginner');
        const progress = buildProgressSummary([...(checkinHistory || []), { response, date: new Date().toISOString() }]);

        res.json({ advice, newExperience: newExp, progressSummary: progress });
    } catch (err) {
        console.error('[Checkin] Error:', err);
        res.status(500).json({ error: 'Checkin failed' });
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

                let list = (products || []).slice(0, 4);
                if (!list.length) {
                    // Fall back to universal curated defaults using an inferred stepKey
                    const inferredStep = { stepKey: (step.step || '').toLowerCase().includes('moistur') ? 'moisturizer' : '', stepName: step.step };
                    list = getUniversalDefaultsForStep(inferredStep, budget || 'medium', '');
                }

                return {
                    step: step.step,
                    productType: step.productType,
                    timeOfDay: step.timeOfDay,
                    products: list
                };
            } catch (error) {
                console.error(`Search failed for ${step.step}:`, error.message);
                const inferredStep = { stepKey: (step.step || '').toLowerCase().includes('moistur') ? 'moisturizer' : '', stepName: step.step };
                const list = getUniversalDefaultsForStep(inferredStep, budget || 'medium', '');
                return {
                    step: step.step,
                    productType: step.productType,
                    timeOfDay: step.timeOfDay,
                    products: list
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

// ══════════════════════════════════════════════
// DERMATOLOGIST / SPECIALIST SEARCH
// Now powered primarily by Google Maps via SerpAPI
// ══════════════════════════════════════════════

async function searchClinicsViaSerpApi(locationStr, type) {
    if (!process.env.SERP_API_KEY) {
        console.warn('[GlowGuide] SERP_API_KEY not set — local clinic search disabled');
        return [];
    }

    const qType = type === 'hospital' ? 'dermatology hospital' : 'dermatology clinic';
    const query = `${qType} near ${locationStr}`;

    try {
        const resp = await axios.get('https://serpapi.com/search.json', {
            params: {
                engine: 'google_maps',
                type: 'search',
                q: query,
                api_key: process.env.SERP_API_KEY,
                hl: 'en'
            },
            timeout: 15000
        });

        const data = resp.data || {};
        let places = [];
        if (Array.isArray(data.local_results)) {
            places = data.local_results;
        } else if (data.local_results && Array.isArray(data.local_results.places)) {
            places = data.local_results.places;
        }

        return places.slice(0, 15).map(p => {
            const name = p.title || p.name || 'Dermatology Clinic';
            const coords = p.gps_coordinates || {};
            const lat = typeof coords.latitude === 'number' ? coords.latitude : coords.lat;
            const lng = typeof coords.longitude === 'number' ? coords.longitude : coords.lng;

            const openingHours = p.opening_hours || p.hours || p.open_now_text || null;
            const rating = typeof p.rating === 'number' ? p.rating : (typeof p.rating === 'string' ? parseFloat(p.rating) : null);
            const reviewCount = p.user_ratings_total || p.reviews || null;

            return {
                name,
                facilityType: type === 'hospital' ? 'Hospital' : 'Dermatology Clinic',
                address: p.address || (Array.isArray(p.address_lines) ? p.address_lines.join(', ') : 'Address not listed'),
                phone: p.phone || p.phone_number || null,
                website: p.website || null,
                googleMapsUrl: p.link || p.maps_url || null,
                directionsUrl: p.directions || p.directions_link || null,
                openingHours,
                openNow: p.open_now ?? null,
                rating: rating || null,
                reviewCount: reviewCount || null,
                distance: p.distance || p.distance_meters || null,
                lat: lat != null ? lat : null,
                lng: lng != null ? lng : null,
                thumbnail: p.thumbnail || p.thumbnail_url || null,
                source: 'Google Maps via SerpAPI'
            };
        });
    } catch (e) {
        console.error('[GlowGuide] SerpAPI clinic search failed:', e.message);
        return [];
    }
}

// Fallback list used when GPT is unavailable
const FALLBACK_ONLINE_CONSULTANTS = [
    { name: 'First Derm', description: 'AI-assisted dermatology — upload photo, get answer in 8 hours', website: 'https://www.firstderm.com', priceRange: '$29–59 per consultation', responseTime: 'Within 8 hours', rating: 4.6, reviewCount: 8900, specialties: ['Acne', 'Eczema', 'Skin diagnosis'], type: 'online', logo: 'F' },
    { name: 'DermNet', description: 'World-leading dermatology knowledge base by dermatologists', website: 'https://dermnetnz.org', priceRange: 'Free information resource', responseTime: 'Instant', rating: 4.8, reviewCount: 50000, specialties: ['All conditions', 'Self-diagnosis guide'], type: 'online', logo: 'D' },
    { name: 'Teladoc', description: 'Licensed dermatologists via video or async photo review', website: 'https://www.teladoc.com', priceRange: '$75–100 per visit', responseTime: 'Same day', rating: 4.7, reviewCount: 23000, specialties: ['All skin conditions', 'Prescriptions'], type: 'online', logo: 'T' },
    { name: 'Skin + Me', description: 'UK-based personalised prescription skincare from dermatologists', website: 'https://www.skinandme.com', priceRange: '£9.99/month', responseTime: '48 hours', rating: 4.8, reviewCount: 15000, specialties: ['Acne', 'Anti-aging', 'Prescription actives'], type: 'online', logo: 'S' },
    { name: 'Qoves Studio', description: 'AI facial analysis and dermatologist referral network', website: 'https://www.qoves.com', priceRange: 'Free AI + paid consult', responseTime: 'Instant AI, 24h human', rating: 4.5, reviewCount: 3200, specialties: ['Facial analysis', 'Skin grading'], type: 'online', logo: 'Q' }
];

// Hardcoded verified Hungarian clinics used as a safety net when APIs fail
const HUNGARIAN_CLINICS = [
    {
        name: 'Debreceni Egyetem Bőrgyógyászati Klinika',
        facilityType: 'University Dermatology Clinic',
        address: 'Nagyerdei krt. 98, 4032 Debrecen',
        rating: 4.2,
        reviewCount: 89,
        phone: '+36 52 411 717',
        website: 'https://www.dent.unideb.hu',
        openNow: 'Open · Closes 4PM',
        googleMapsUrl: 'https://maps.google.com/?q=Debreceni+Egyetem+Bőrgyógyászati+Klinika',
        directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=47.5573,21.6280',
        source: 'Verified'
    },
    {
        name: 'DermCenter Debrecen',
        facilityType: 'Private Dermatology Clinic',
        address: 'Piac utca 26, 4024 Debrecen',
        rating: 4.6,
        reviewCount: 134,
        phone: '+36 52 530 150',
        website: null,
        openNow: 'Open · Closes 6PM',
        googleMapsUrl: 'https://maps.google.com/?q=DermCenter+Debrecen',
        directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=47.5298,21.6393',
        source: 'Verified'
    },
    {
        name: 'Kenézy Gyula Kórház Bőrgyógyászat',
        facilityType: 'Hospital Dermatology Department',
        address: 'Bartók Béla út 2-26, 4031 Debrecen',
        rating: 3.9,
        reviewCount: 210,
        phone: '+36 52 511 777',
        website: 'https://www.kenezyk.hu',
        openNow: 'Open 24 hours',
        googleMapsUrl: 'https://maps.google.com/?q=Kenézy+Gyula+Kórház+Debrecen',
        directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=47.5441,21.6189',
        source: 'Verified'
    }
];

async function fetchOnlineConsultants(locationDisplay) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 900,
            messages: [{
                role: 'system',
                content: 'You are a dermatology resource expert. Return only valid JSON, no markdown, no extra text.'
            }, {
                role: 'user',
                content: `List 5 real online dermatology consultation platforms or telemedicine services that are available or well-known for users in or near: ${locationDisplay}.
Prioritise services that actually operate in that region. Always include at least one globally available option.
Return a JSON array of exactly 5 objects with these fields:
- name (string)
- description (1 sentence, what the platform offers)
- website (real HTTPS URL)
- priceRange (e.g. "Free", "$30–60 per consult", "£9.99/month")
- responseTime (e.g. "Instant", "Same day", "Within 24 hours")
- rating (number 4.0–5.0)
- reviewCount (integer)
- specialties (array of 2–3 short strings)
Return only the JSON array.`
            }]
        });
        const raw = response.choices[0].message.content.replace(/```json|```/g, '').trim();
        const consultants = JSON.parse(raw);
        if (!Array.isArray(consultants) || consultants.length === 0) throw new Error('Empty array');
        return consultants.map(c => ({
            ...c,
            type: 'online',
            logo: (c.name || 'X').charAt(0).toUpperCase()
        }));
    } catch (e) {
        console.error('[GlowGuide] fetchOnlineConsultants failed, using fallback:', e.message);
        return FALLBACK_ONLINE_CONSULTANTS;
    }
}

// Simple non-streaming GPT call — used for background tasks like profile summary generation
app.post('/api/simple-chat', async (req, res) => {
    const { message, system } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 200,
            messages: [
                { role: 'system', content: system || 'You are a helpful skincare advisor.' },
                { role: 'user',   content: message }
            ]
        });
        res.json({ response: completion.choices[0].message.content.trim() });
    } catch (e) {
        console.error('[simple-chat] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Dermatologist / specialist search endpoint
app.post('/api/dermatologists', async (req, res) => {
    const { location, city, country, lat: bodyLat, lng: bodyLng, locationQuery } = req.body;
    const locationInput = location || locationQuery || (city ? city + (country ? ', ' + country : '') : null);
    console.log('[GlowGuide] Derm search — location:', locationInput, '| lat:', bodyLat, '| lng:', bodyLng);

    if (!locationInput && (!bodyLat || !bodyLng)) {
        return res.status(400).json({ error: 'Location required' });
    }

    const displayLocation = locationInput || 'Your area';

    try {
        // Cache by location label so repeated searches are fast
        const cacheKey = displayLocation.toLowerCase();
        const cached = dermCache.get(cacheKey);
        if (cached && (Date.now() - cached.ts < DERM_CACHE_TTL)) {
            console.log('[GlowGuide] Serving cached derm results for:', cacheKey);
            const freshOnline = await fetchOnlineConsultants(displayLocation).catch(() => FALLBACK_ONLINE_CONSULTANTS);
            return res.json({ ...cached.data, online: freshOnline });
        }

        console.log('[GlowGuide] Querying SerpAPI for local clinics/hospitals...');
        const [clinicsRes, hospitalsRes, onlineRes] = await Promise.allSettled([
            searchClinicsViaSerpApi(displayLocation, 'clinic'),
            searchClinicsViaSerpApi(displayLocation, 'hospital'),
            fetchOnlineConsultants(displayLocation)
        ]);

        let clinics = clinicsRes.status === 'fulfilled' ? clinicsRes.value : [];
        let hospitals = hospitalsRes.status === 'fulfilled' ? hospitalsRes.value : [];

        if (clinicsRes.status === 'rejected') console.error('[GlowGuide] SerpAPI clinic search failed:', clinicsRes.reason?.message);
        if (hospitalsRes.status === 'rejected') console.error('[GlowGuide] SerpAPI hospital search failed:', hospitalsRes.reason?.message);

        // If user is in Debrecen and no local facilities were found, fall back to verified Hungarian clinics
        const locLabel = displayLocation.toLowerCase();
        if (locLabel.includes('debrecen') && clinics.length === 0 && hospitals.length === 0) {
            console.log('[GlowGuide] Using hardcoded Hungarian clinics fallback for Debrecen');
            clinics = HUNGARIAN_CLINICS;
            hospitals = [];
        }

        const online = onlineRes.status === 'fulfilled' ? onlineRes.value : FALLBACK_ONLINE_CONSULTANTS;

        // Best-effort coordinates from first result (used for map centering only)
        const firstWithCoords = [...clinics, ...hospitals].find(f => f.lat != null && f.lng != null);
        const coordinates = firstWithCoords
            ? { lat: firstWithCoords.lat, lng: firstWithCoords.lng, displayName: displayLocation }
            : (bodyLat && bodyLng && bodyLat !== 0 ? { lat: parseFloat(bodyLat), lng: parseFloat(bodyLng), displayName: displayLocation } : null);

        const resultData = {
            location: displayLocation,
            coordinates,
            clinics,
            hospitals,
            source: 'Google Maps via SerpAPI',
            note: clinics.length === 0 && hospitals.length === 0 ? 'No facilities found nearby. Try a larger city name.' : null
        };

        if (clinics.length > 0 || hospitals.length > 0) {
            dermCache.set(cacheKey, { ts: Date.now(), data: resultData });
        }

        console.log(`[GlowGuide] Returning: ${clinics.length} clinics, ${hospitals.length} hospitals, ${online.length} online`);
        res.json({ ...resultData, online });

    } catch (error) {
        console.error('[GlowGuide] Dermatologist search error:', error.message);
        const online = await fetchOnlineConsultants(displayLocation || 'your region');
        res.json({
            location: displayLocation,
            clinics: [],
            hospitals: [],
            online,
            source: 'fallback',
            error: 'Local clinic search unavailable for this area. Showing online options.',
            note: 'Try searching a major nearby city like "Budapest, Hungary"'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`GlowGuide running on port ${PORT}`);
    console.log(`Active AI Provider: GPT-4o`);
    console.log('[GlowGuide] SERP_API_KEY present:', !!process.env.SERP_API_KEY);
    if (process.env.SERP_API_KEY) {
        console.log('[GlowGuide] SERP_API_KEY prefix:', String(process.env.SERP_API_KEY).substring(0, 8));
    }
});
