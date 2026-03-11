// firebase-config.js – GlowGuide
// Fetches Firebase config from server (env vars), initializes Firebase app.
// Called by app.js before any auth logic runs.

window.GG_Firebase = {
    _auth: null,
    _db: null,
    _configured: false,

    async init() {
        try {
            const res = await fetch('/firebase-config');
            const config = await res.json();

            // Check if config is filled in (placeholder values won't work)
            if (!config.apiKey || config.apiKey === 'your_firebase_api_key' || config.apiKey === '') {
                console.warn('[GlowGuide] Firebase not configured. Add keys to .env first.');
                this._configured = false;
                return { configured: false, auth: null, db: null };
            }

            // Only initialize once
            if (!firebase.apps.length) {
                firebase.initializeApp(config);
            }

            this._auth = firebase.auth();
            this._db = firebase.firestore();
            this._configured = true;

            console.log('[GlowGuide] Firebase initialized ✓');
            return { configured: true, auth: this._auth, db: this._db };
        } catch (err) {
            console.error('[GlowGuide] Firebase init failed:', err);
            this._configured = false;
            return { configured: false, auth: null, db: null };
        }
    },

    getAuth() { return this._auth; },
    getDb() { return this._db; },
    isConfigured() { return this._configured; }
};

