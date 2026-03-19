# GlowGuide

An AI-powered skincare and wellness dashboard that combines custom deep learning models with GPT-4o vision to deliver personalized skin analysis, clinically-backed routines, product recommendations, and dermatologist discovery — all through a conversational interface.

## Features

### AI Skin Consultation
- Guided 6-question intake (concern, skin type, current routine, sensitivities, budget, lifestyle)
- Streaming conversational interface powered by GPT-4o
- Automatic routine generation after intake completion
- Supports text, photo uploads, and PDF medical report parsing

### Skin Photo Analysis (Dual-Model Pipeline)
- **Custom ML Model:** EfficientNet-B0 multi-task CNN trained on 5+ dermatology datasets (~20k images)
  - Skin type classification (Normal, Oily, Dry, Combination, Sensitive)
  - Condition detection (Acne, Pigmentation, Wrinkles, Redness, Dark Circles, Pores)
  - Severity regression (continuous 0–1 score)
- **GPT-4o Vision:** Parallel analysis for texture, hydration, and fine-grained observations
- Results from both models are merged for a comprehensive skin report

### Clinical Routine Builder
- Evidence-based ingredient selection from a curated clinical database (studies, journals, evidence levels)
- Ingredients gated by experience level (beginner / intermediate / advanced)
- Concentration thresholds adjusted by severity (mild / moderate / severe)
- Automatic interaction and contraindication checking
- Logical step ordering: Cleanser → Exfoliant → Toner → Essence → Serum → Treatment → Eye Cream → Spot Treatment → Moisturizer → Oil → SPF
- Morning / evening split generation

### 28-Day Adaptive Check-In System
- Prompted 28 days after routine creation
- Tracks progress: much better / some progress / no change / got worse
- Adaptive feedback engine:
  - *Much better* → upgrades experience level, unlocks stronger ingredients
  - *Some progress* → extends timeline with encouragement
  - *No change* → suggests adding targeted treatments
  - *Got worse* → triggers emergency simplification protocol

### Product Recommendations
- Curated product database indexed by active ingredient
- Fallback to DuckDuckGo search when curated data is insufficient
- Filtered by budget tier, skin type compatibility, and rating
- Product extraction from routine text via Claude Sonnet 4

### Water Hydration Tracker
- Daily goal setting with glass-count visualization
- Visual progress tracking

### Dermatologist Finder
- Local clinic/hospital search via SerpAPI (Google Maps)
- OpenStreetMap (Nominatim + Overpass) fallback
- Displays: address, phone, website, hours, open/closed status, rating, distance
- Curated online telemedicine options (First Derm, DermNet, Teladoc, Skin+Me, Qoves Studio)
- 15-minute response caching per location

## Architecture

```
GlowGuide/
├── server.js                  # Express.js backend (API routes, streaming, ML orchestration)
├── prompt.js                  # System prompts & response formatting rules
├── clinical-engine.js         # Evidence-based ingredient selection & routine builder
├── feedback-engine.js         # Check-in tracking & adaptive routine adjustments
├── productSearch.js           # Product discovery (curated DB + web search)
├── extractProducts.js         # AI-powered product extraction from routine text
├── public/
│   ├── index.html             # SPA shell (all pages embedded)
│   ├── app.js                 # Frontend logic (~4400 lines)
│   ├── router.js              # Client-side page navigation
│   ├── style.css              # Full styling (~5400 lines)
│   └── firebase-config.js     # Firebase initialization
├── data/
│   ├── curated-products.json  # Product database (brand, price, rating, ingredients)
│   └── ingredients-clinical.json  # Clinical ingredient DB (studies, mechanisms, thresholds)
├── ml_pipeline/
│   ├── model.py               # EfficientNet-B0 multi-task model definition
│   ├── inference_server.py    # Persistent Python process for real-time inference
│   ├── inference.py           # Single-image inference script
│   ├── train.py               # Training pipeline
│   ├── config.py              # Model hyperparameters & class definitions
│   ├── dataset.py             # Dataset loading utilities
│   ├── gradcam.py             # Grad-CAM visualization
│   └── checkpoints/           # Saved model weights
└── .env                       # API keys & Firebase config
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla HTML5 / CSS3 / JavaScript (SPA) |
| **Backend** | Node.js + Express v5 |
| **Primary AI** | OpenAI GPT-4o (chat, vision, analysis) / GPT-4o-mini (lightweight queries) |
| **Secondary AI** | Anthropic Claude Sonnet 4 (product extraction fallback) |
| **Custom ML** | PyTorch — EfficientNet-B0 (multi-task: classification + detection + regression) |
| **Authentication** | Firebase Auth (Google OAuth + Email/Password with verification) |
| **Database** | Firebase Firestore (user profiles, routines, history) + browser localStorage |
| **Geolocation APIs** | SerpAPI (Google Maps), Nominatim / Overpass (OpenStreetMap) |
| **PDF Parsing** | pdf-parse |
| **Streaming** | Server-Sent Events (SSE) for real-time chat responses |

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/chat` | Streaming AI consultation (text, image, PDF support) |
| `POST` | `/api/recommend` | Generate personalized skincare routine |
| `POST` | `/api/checkin` | Submit 28-day check-in and receive adaptive feedback |
| `POST` | `/api/products` | Search product recommendations by routine |
| `GET`  | `/api/ingredient/:name` | Look up clinical evidence for an ingredient |
| `POST` | `/api/dermatologists` | Search local clinics and online telemedicine |
| `POST` | `/api/generate-title` | AI-generated session title |
| `POST` | `/api/parse-pdf` | Extract data from uploaded medical/skincare PDFs |
| `POST` | `/api/reset` | Clear conversation history |
| `POST` | `/api/simple-chat` | Stateless GPT-4o-mini query |
| `GET`  | `/api/provider` | Current AI provider info |
| `GET`  | `/firebase-config` | Firebase configuration for frontend |

## ML Model Details

**Architecture:** EfficientNet-B0 backbone (pretrained on ImageNet) with three task-specific heads:

- **Skin Type Head** — 5-class softmax (Normal, Oily, Dry, Combination, Sensitive)
- **Condition Head** — 6-label sigmoid (Acne, Pigmentation, Wrinkles, Redness, Dark Circles, Pores)
- **Severity Head** — Single-neuron regression (0–1)

**Training Configuration:**
- Input: 224 x 224 RGB images
- Batch size: 32
- Epochs: 50
- Optimizer: Adam (lr = 1e-4)
- Device: CUDA (GPU) with CPU fallback

**Training Datasets:**
- Human Facial Skin Defects (4,788 images)
- Skin Issues Dataset
- PAD-UFES-20 (skin lesions)
- Fitzpatrick17k (skin tone diversity)
- SCIN (skin conditions)

**Inference:** Runs as a persistent Python subprocess (`inference_server.py`) — model loads once at server boot, eliminating the 3–5 second cold-start per request.

## Setup

### Prerequisites
- Node.js (v18+)
- Python 3.9+ with PyTorch
- API keys: OpenAI, SerpAPI, (optional) Anthropic
- Firebase project with Auth and Firestore enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/GlowGuide.git
cd GlowGuide

# Install Node.js dependencies
npm install

# Set up Python environment for the ML pipeline
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
# .venv\Scripts\activate         # Windows
pip install torch torchvision efficientnet_pytorch pillow

# Configure environment variables
cp .env.example .env
# Fill in your API keys and Firebase config in .env
```

### Running

```bash
# Start the server (also boots the ML inference process)
node server.js
```

The app will be available at `http://localhost:3000`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | GPT-4o / GPT-4o-mini access |
| `SERP_API_KEY` | Yes | Google Maps dermatologist search |
| `ANTHROPIC_API_KEY` | No | Claude (used for product extraction) |
| `AI_PROVIDER` | No | `openai` (default) or `anthropic` |
| `PORT` | No | Server port (default: 3000) |
| `FIREBASE_API_KEY` | Yes | Firebase Auth |
| `FIREBASE_AUTH_DOMAIN` | Yes | Firebase Auth domain |
| `FIREBASE_PROJECT_ID` | Yes | Firestore project |
| `FIREBASE_STORAGE_BUCKET` | Yes | Firebase Storage |
| `FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase Cloud Messaging |
| `FIREBASE_APP_ID` | Yes | Firebase App ID |

## Response Format Protocol

The AI uses structured tags instead of markdown for consistent UI rendering:

| Tag | Purpose |
|-----|---------|
| `[CHAT]` | Conversational messages and open-ended questions |
| `[OPTIONS]` | Multiple-choice selections (2–6 options) |
| `[ROUTINE]` | Skincare routine output (morning/evening) |
| `[ANALYSIS]` | Skin photo analysis report |
| `[INFO]` | Long-form advice and explanations |

## License

ISC
