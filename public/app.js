// GlowGuide – Multi-Page Wellness Dashboard
'use strict';

// ══════════════════════════════════════════════════════════════════
// FIREBASE AUTH MODULE
// ══════════════════════════════════════════════════════════════════

let currentUser = null;  // Global – accessible throughout the app
let _db = null;          // Firestore instance

// ── Error code → friendly message map ──
const AUTH_ERRORS = {
    'auth/email-already-in-use': 'This email is already registered. Try logging in instead.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/user-not-found': 'No account found with this email address.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many failed attempts. Please try again in a few minutes.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/popup-closed-by-user': '',   // silent – user closed popup
    'auth/popup-blocked': 'Popup was blocked. Please allow popups for this site.',
    'auth/account-exists-with-different-credential': 'An account with this email already exists using a different sign-in method.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
};
function friendlyError(err) {
    return AUTH_ERRORS[err.code] || (err.message || 'Something went wrong. Please try again.');
}

// ── Setup: landing screen buttons ──
async function initFirebaseAuth() {
    const fb = await window.GG_Firebase.init();

    // ── Always attach UI navigation listeners first ──
    // (these work regardless of Firebase config)
    document.getElementById('authEmailBtn')?.addEventListener('click', showEmailScreen);
    document.getElementById('authBackBtn')?.addEventListener('click', showLandingScreen);
    document.getElementById('tabSignup')?.addEventListener('click', () => switchTab('signup'));
    document.getElementById('tabLogin')?.addEventListener('click', () => switchTab('login'));
    document.getElementById('migrationYesBtn')?.addEventListener('click', () => migrateLocalData());
    document.getElementById('migrationNoBtn')?.addEventListener('click', () => hideMigrationToast());

    // Show/hide password toggles
    document.querySelectorAll('.auth-eye-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            btn.textContent = input.type === 'password' ? '👁' : '🙈';
        });
    });

    // Real-time validation (works without Firebase)
    setupRealtimeValidation();

    // ── If Firebase not configured → show banner, auth buttons show helpful info ──
    if (!fb.configured) {
        const notConfiguredBanner = document.getElementById('authNotConfigured');
        if (notConfiguredBanner) {
            notConfiguredBanner.style.display = 'flex';
            // Add a dev bypass button inside the banner
            const bypass = document.createElement('button');
            bypass.textContent = 'Skip to Dashboard →';
            bypass.style.cssText = 'margin-top:8px;background:var(--gold);color:var(--forest);border:none;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;';
            bypass.addEventListener('click', () => showApp(null));
            notConfiguredBanner.appendChild(bypass);
        }
        // Attach form submit + social button handlers with helpful messages
        document.getElementById('formSignup')?.addEventListener('submit', e => {
            e.preventDefault();
            showEmailError('Firebase is not configured yet. Add your keys to .env — see the banner above.');
        });
        document.getElementById('formLogin')?.addEventListener('submit', e => {
            e.preventDefault();
            showEmailError('Firebase is not configured yet. Add your keys to .env — see the banner above.');
        });
        const scrollToBanner = () => {
            if (notConfiguredBanner) { notConfiguredBanner.style.display = 'flex'; notConfiguredBanner.scrollIntoView({ behavior: 'smooth' }); }
        };
        document.getElementById('authGoogleBtn')?.addEventListener('click', scrollToBanner);
        // Keep auth screen visible — don't call showApp() here
        return;
    }

    _db = fb.db;
    const auth = fb.auth;

    // ── onAuthStateChanged — THE gatekeeper ──
    auth.onAuthStateChanged(async user => {
        if (user) {
            // Email/password users must verify their email first
            const isEmailProvider = user.providerData?.[0]?.providerId === 'password';
            if (isEmailProvider && !user.emailVerified) {
                await auth.signOut();
                showEmailScreen();
                showEmailError('Please verify your email before logging in. Check your inbox for the verification link.');
                return;
            }
            currentUser = user;
            await onUserLogin(user);
        } else {
            currentUser = null;
            const signOutBtn = document.getElementById('signOutBtn');
            if (signOutBtn) signOutBtn.style.display = 'none';
            resetAuthButtons();
            showAuth();
        }
    });

    // ── Firebase-specific button handlers ──
    document.getElementById('authGoogleBtn')?.addEventListener('click', () => signInGoogle(auth));
    document.getElementById('signOutBtn')?.addEventListener('click', () => signOutUser(auth));

    // Form submissions
    document.getElementById('formSignup')?.addEventListener('submit', e => { e.preventDefault(); submitSignup(auth); });
    document.getElementById('formLogin')?.addEventListener('submit', e => { e.preventDefault(); submitLogin(auth); });

    // Forgot password
    document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => sendReset(auth));
}

// ── Show/hide screens ──
function showAuth() {
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('authLanding').style.display = 'flex';
    document.getElementById('authEmail').style.display = 'none';
}

function showApp(user) {
    document.getElementById('authLanding').style.display = 'none';
    document.getElementById('authEmail').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
}

function showEmailScreen() {
    document.getElementById('authLanding').style.display = 'none';
    document.getElementById('authEmail').style.display = 'flex';
    clearAuthFormErrors();
}

// ── Reset auth buttons to original state (called on sign-out) ──
function resetAuthButtons() {
    const googleBtn = document.getElementById('authGoogleBtn');
    if (googleBtn) {
        googleBtn.classList.remove('loading');
        googleBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
    }
}

function showLandingScreen() {
    document.getElementById('authEmail').style.display = 'none';
    document.getElementById('authLanding').style.display = 'flex';
}

// ── Google sign-in ──
async function signInGoogle(auth) {
    const btn = document.getElementById('authGoogleBtn');
    btn.classList.add('loading');
    btn.textContent = 'Signing in...';
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
        // onAuthStateChanged handles the rest
    } catch (err) {
        btn.classList.remove('loading');
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
        const msg = friendlyError(err);
        if (msg) showAuthLandingError(msg);
    }
}



// ── Email Sign-Up ──
async function submitSignup(auth) {
    clearAuthFormErrors();
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;

    let valid = true;
    if (!name) { setFieldError('errSignupName', 'Please enter your full name.'); valid = false; }
    if (!validateEmail(email)) { setFieldError('errSignupEmail', 'Please enter a valid email.'); valid = false; }
    if (password.length < 8) { setFieldError('errSignupPassword', 'Password must be at least 8 characters.'); valid = false; }
    if (password !== confirm) { setFieldError('errSignupConfirm', 'Passwords do not match.'); valid = false; }
    if (!valid) return;

    setSubmitLoading('signupSubmitBtn', true);
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });
        // Create Firestore user document before signing out
        await createUserDocument(cred.user, 'email');
        // Send verification email then immediately sign out
        await cred.user.sendEmailVerification();
        await auth.signOut();
        setSubmitLoading('signupSubmitBtn', false);
        showEmailSuccess('✅ Account created! Check your email to verify your address, then log in.');
        // Switch to Log In tab so they can log in once verified
        switchTab('login');
    } catch (err) {
        setSubmitLoading('signupSubmitBtn', false);
        showEmailError(friendlyError(err));
    }
}

// ── Email Log-In ──
async function submitLogin(auth) {
    clearAuthFormErrors();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    let valid = true;
    if (!validateEmail(email)) { setFieldError('errLoginEmail', 'Please enter a valid email.'); valid = false; }
    if (!password) { setFieldError('errLoginPassword', 'Please enter your password.'); valid = false; }
    if (!valid) return;

    setSubmitLoading('loginSubmitBtn', true);
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
        setSubmitLoading('loginSubmitBtn', false);
        showEmailError(friendlyError(err));
    }
}

// ── Forgot password ──
async function sendReset(auth) {
    const email = document.getElementById('loginEmail').value.trim();
    if (!validateEmail(email)) { setFieldError('errLoginEmail', 'Enter your email above first.'); return; }
    try {
        await auth.sendPasswordResetEmail(email);
        showEmailSuccess('Password reset email sent! Check your inbox.');
    } catch (err) {
        showEmailError(friendlyError(err));
    }
}

// ── Sign Out ──
async function signOutUser(auth) {
    if (!confirm('Sign out of GlowGuide?')) return;
    try {
        await auth.signOut();
        // Immediately reset UI — don't wait for onAuthStateChanged propagation
        currentUser = null;
        _db = null;
        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) signOutBtn.style.display = 'none';
        resetAuthButtons();
        showAuth();
    } catch (err) {
        console.error('Sign out error:', err);
    }
}

// ── On user login ──
async function onUserLogin(user) {
    showApp(user);
    updateSidebarUser(user);

    // FIX 2: Show name instantly from Firebase Auth
    const firstName = user.displayName ? user.displayName.split(' ')[0] : 'there';
    const hour = new Date().getHours();
    let timeOfDay = '';
    if (hour >= 5 && hour < 12) {
        timeOfDay = 'Good morning';
    } else if (hour >= 12 && hour < 17) {
        timeOfDay = 'Good afternoon';
    } else if (hour >= 17 && hour < 21) {
        timeOfDay = 'Good evening';
    } else {
        timeOfDay = 'Good night';
    }
    const greetingEl = document.getElementById('homeGreeting');
    if (greetingEl) greetingEl.textContent = `${timeOfDay}, ${firstName}`;

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateEl = document.getElementById('homeDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', dateOptions);

    // FIX 1: Load tip instantly from local array without waiting for Firestore
    const tipIdx = new Date().getDate() % TIPS.length;
    const tip = TIPS[tipIdx];
    const tipEl = document.getElementById('homeTipText');
    if (tipEl) tipEl.textContent = tip;
    
    // FIX 3: Load Firestore data in the background (no await)
    // Replace skeletons with real data when loaded silently
    if (_db) {
        createUserDocument(user, user.providerData?.[0]?.providerId?.replace('.com', '') || 'email')
            .then(() => loadFirestoreData(user))
            .catch(console.error);
    }

    // Show migration toast if localStorage has data
    checkForLocalDataMigration();

    // Show sign-out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.style.display = 'flex';
}

// ── Update sidebar with user info ──
function updateSidebarUser(user) {
    if (!user) return;
    const name = user.displayName || user.email?.split('@')[0] || 'You';
    const email = user.email || '';
    const photo = user.photoURL;

    const avatarImg = document.getElementById('sidebarAvatarImg');
    const avatarInitials = document.getElementById('sidebarAvatarInitials');
    const usernameEl = document.getElementById('sidebarUsername');
    const useremailEl = document.getElementById('sidebarUseremail');

    if (usernameEl) usernameEl.textContent = name;
    if (useremailEl) useremailEl.textContent = email;

    if (photo && avatarImg) {
        avatarImg.src = photo;
        avatarImg.style.display = 'block';
        if (avatarInitials) avatarInitials.style.display = 'none';
    } else if (avatarInitials) {
        avatarInitials.textContent = name[0].toUpperCase();
    }

    // Also update localStorage username for page greeting etc.
    LS.set('glowguide_username', name);
}

// ── Create Firestore user document (only if doesn't exist) ──
async function createUserDocument(user, provider = 'email') {
    if (!_db) return;
    try {
        const ref = _db.collection('users').doc(user.uid);
        const snap = await ref.get();
        if (!snap.exists) {
            await ref.set({
                uid: user.uid,
                name: user.displayName || '',
                email: user.email || '',
                photoURL: user.photoURL || '',
                provider,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                skinProfile: null,
                waterSettings: null,
                savedRoutine: null,
                consultationHistory: []
            });
        }
    } catch (err) {
        console.error('[GlowGuide] Firestore user doc error:', err);
    }
}

// ── Load data from Firestore (then merge into localStorage) ──
async function loadFirestoreData(user) {
    if (!_db || !user) return;

    // FIX 4: Cache Firestore data locally
    const checkCache = (dataType, maxAgeMs) => {
        const cacheRaw = LS.get(`gg_cache_${user.uid}_${dataType}`, null);
        if (cacheRaw && (Date.now() - cacheRaw.ts < maxAgeMs)) return true;
        return false;
    };
    const setCache = (dataType) => {
        LS.set(`gg_cache_${user.uid}_${dataType}`, { ts: Date.now() });
    };

    const needsProfile = !checkCache('profile', 24 * 60 * 60 * 1000); // 24 hours
    const needsWater = !checkCache('water', 5 * 60 * 1000); // 5 minutes

    try {
        if (needsProfile) {
            const snap = await _db.collection('users').doc(user.uid).get();
            if (snap.exists) {
                const data = snap.data();
                let changed = false;
                if (data.skinProfile) { LS.set('glowguide_profile', data.skinProfile); changed = true; }
                if (data.savedRoutine) { LS.set('glowguide_routine', data.savedRoutine); changed = true; }
                if (data.waterSettings) {
                    if (data.waterSettings.target) LS.set('glowguide_water_target', data.waterSettings.target);
                    if (data.waterSettings.profile) LS.set('glowguide_water_profile', data.waterSettings.profile);
                    if (data.waterSettings.reminders) LS.set('glowguide_water_reminders', data.waterSettings.reminders);
                    changed = true;
                }
                setCache('profile');
                
                // Silent UI refresh if active
                if (changed) {
                    if (typeof renderHomeProfile === 'function') renderHomeProfile();
                    if (typeof renderHomeRoutine === 'function') renderHomeRoutine();
                    if (document.getElementById('page-routines')?.classList.contains('active')) {
                        if (typeof initRoutines === 'function') initRoutines();
                    }
                    if (document.getElementById('page-profile')?.classList.contains('active')) {
                        if (typeof initProfile === 'function') initProfile();
                    }
                }
            }
        }

        if (needsWater) {
            // Load last 7 days of water logs for chart
            const waterSnap = await _db.collection('users').doc(user.uid).collection('waterLogs')
                .orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(7).get();

            waterSnap.forEach(doc => {
                LS.set('glowguide_water_' + doc.id, doc.data().entries || []);
            });
            setCache('water');
            
            // Silent UI refresh if active
            if (typeof renderHomeWaterRing === 'function') renderHomeWaterRing();
            if (document.getElementById('page-water')?.classList.contains('active')) {
                if (typeof initWater === 'function') initWater();
            }
        }
    } catch (err) {
        console.error('[GlowGuide] Load Firestore data error:', err);
    }
}

// ── Dual-write helpers (localStorage + Firestore) ──
async function saveProfileToFirestore(profile) {
    if (!_db || !currentUser) return;
    try {
        await _db.collection('users').doc(currentUser.uid).update({ skinProfile: profile });
    } catch { }
}

async function saveRoutineToFirestore(routine) {
    if (!_db || !currentUser) return;
    try {
        await _db.collection('users').doc(currentUser.uid).update({ savedRoutine: routine });
    } catch { }
}

async function saveWaterSettingsToFirestore(settings) {
    if (!_db || !currentUser) return;
    try {
        await _db.collection('users').doc(currentUser.uid).update({ waterSettings: settings });
    } catch { }
}

async function saveWaterLogToFirestore(entries) {
    if (!_db || !currentUser) return;
    try {
        await _db.collection('users').doc(currentUser.uid)
            .collection('waterLogs').doc(today())
            .set({ entries, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch { }
}

// ── Migration toast ──
function checkForLocalDataMigration() {
    const history = LS.get('glowguide_chat_history', []);
    const waterEntries = LS.get('glowguide_water_' + today(), []);
    const hasData = history.length > 0 || waterEntries.length > 0;
    if (hasData && _db && currentUser) {
        const toast = document.getElementById('migrationToast');
        if (toast) toast.style.display = 'block';
    }
}

async function migrateLocalData() {
    hideMigrationToast();
    if (!_db || !currentUser) return;
    try {
        const profile = LS.get('glowguide_profile');
        const routine = LS.get('glowguide_routine');
        const waterTarget = LS.get('glowguide_water_target');
        const waterEntries = LS.get('glowguide_water_' + today(), []);
        const updates = {};
        if (profile) updates.skinProfile = profile;
        if (routine) updates.savedRoutine = routine;
        if (waterTarget) updates.waterSettings = waterTarget;
        if (Object.keys(updates).length) {
            await _db.collection('users').doc(currentUser.uid).update(updates);
        }
        if (waterEntries.length) await saveWaterLogToFirestore(waterEntries);
        showSaveToast();
    } catch (err) {
        console.error('[GlowGuide] Migration error:', err);
    }
}

function hideMigrationToast() {
    const toast = document.getElementById('migrationToast');
    if (toast) toast.style.display = 'none';
}

function showSaveToast() {
    const toast = document.getElementById('saveToast');
    if (!toast) return;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ── Tab switcher ──
function switchTab(mode) {
    const signup = document.getElementById('formSignup');
    const login = document.getElementById('formLogin');
    const tabS = document.getElementById('tabSignup');
    const tabL = document.getElementById('tabLogin');
    if (mode === 'signup') {
        signup.style.display = 'flex'; login.style.display = 'none';
        tabS.classList.add('active'); tabL.classList.remove('active');
    } else {
        login.style.display = 'flex'; signup.style.display = 'none';
        tabL.classList.add('active'); tabS.classList.remove('active');
    }
    clearAuthFormErrors();
}

// ── Validation helpers ──
function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function setupRealtimeValidation() {
    const addCheck = (id, check, errId, msg) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const ok = check(el.value);
            el.classList.toggle('valid', ok && el.value.length > 0);
            el.classList.toggle('error', !ok && el.value.length > 0);
            const errEl = document.getElementById(errId);
            if (errEl) errEl.textContent = (!ok && el.value.length > 0) ? msg : '';
        });
    };
    addCheck('signupEmail', validateEmail, 'errSignupEmail', 'Invalid email format.');
    addCheck('signupPassword', v => v.length >= 8, 'errSignupPassword', 'Minimum 8 characters.');
    addCheck('signupConfirm', v => v === document.getElementById('signupPassword')?.value, 'errSignupConfirm', 'Passwords do not match.');
    addCheck('loginEmail', validateEmail, 'errLoginEmail', 'Invalid email format.');
}

function setFieldError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function clearAuthFormErrors() {
    ['errSignupName', 'errSignupEmail', 'errSignupPassword', 'errSignupConfirm', 'errLoginEmail', 'errLoginPassword'].forEach(id => setFieldError(id, ''));
    ['authEmailError', 'authEmailSuccess'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.display = 'none'; el.textContent = ''; } });
}

function showEmailError(msg) { const el = document.getElementById('authEmailError'); if (el && msg) { el.textContent = msg; el.style.display = 'block'; } }
function showEmailSuccess(msg) { const el = document.getElementById('authEmailSuccess'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
function showAuthLandingError(msg) { if (msg) alert(msg); } // Simple fallback for landing errors

function setSubmitLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled = loading;
    if (text) text.style.display = loading ? 'none' : 'inline';
    if (spinner) spinner.style.display = loading ? 'inline' : 'none';
}



// ══════════════════════════════════════════════
// TIPS
// ══════════════════════════════════════════════
const TIPS = [
    "Change your pillowcase every 3–4 days to prevent bacteria buildup.",
    "Drink a glass of water first thing in the morning to kick-start hydration.",
    "Never touch your face with unwashed hands.",
    "Get 7–9 hours of sleep — your skin repairs itself overnight.",
    "Remove makeup before sleeping — always, no exceptions.",
    "Clean your phone screen daily; it transfers bacteria to your skin.",
    "Eat at least one green vegetable today for skin-nourishing antioxidants.",
    "Apply SPF even on cloudy days — UV rays penetrate cloud cover.",
    "Pat your face dry with a towel, never rub.",
    "Wash your hands before your skincare routine.",
    "Stress raises cortisol which triggers breakouts — find your calm.",
    "Rinse with cold water after cleansing to help close pores.",
    "Your gut health directly affects your skin — eat probiotic foods.",
    "Stay out of direct sun between 10am and 2pm when UV is strongest.",
    "Wash your makeup brushes weekly to prevent bacteria transfer.",
    "Silk pillowcases cause less friction on skin than cotton.",
    "Hot showers strip natural oils from skin — use lukewarm water.",
    "True hydration starts from inside — drink your water.",
    "Avoid picking or popping pimples to prevent scarring.",
    "Exercise increases blood flow to skin cells — move today.",
    "Reducing sugar intake helps reduce skin inflammation.",
    "Fresh air and short walks improve circulation and skin tone.",
    "Rinse your face after sweating to prevent clogged pores.",
    "Don't share skincare products or face towels.",
    "Check product expiry dates — expired products can irritate skin.",
    "Eat foods rich in omega-3 (salmon, walnuts) to strengthen the skin barrier.",
    "Consistency beats expensive products — stick to your routine.",
    "Less is more — overloading skin with products causes issues.",
    "Your neck and chest need SPF protection too.",
    "Manage stress actively — it always shows on your skin."
];

// ══════════════════════════════════════════════
// STATE & STORAGE HELPERS
// ══════════════════════════════════════════════
const LS = {
    get: (k, fallback = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
    del: (k) => { try { localStorage.removeItem(k); } catch { } }
};

function today() { return new Date().toISOString().slice(0, 10); }
function timeStr(d = new Date()) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let currentImage = null;
let currentPdfContent = null;
let userCity = '';
let userCountry = '';
let drawerOpen = false;
let reminderInterval = null;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// ══════════════════════════════════════════════
// ROUTER INIT HOOKS (UI handled by router.js)
// ══════════════════════════════════════════════
window.addEventListener('hashchange', () => {
    const page = location.hash.replace('#', '') || 'home';
    const initFns = { home: initHome, profile: initProfile, water: initWater, routines: initRoutines, products: initProducts, dermatologist: initDerm, settings: initSettings };
    if (initFns[page]) initFns[page]();
    closeSidebar();
});

// ══════════════════════════════════════════════
// SIDEBAR (mobile)
// ══════════════════════════════════════════════
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const ham = document.getElementById('hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('visible');
    if (ham) ham.classList.remove('open');
}

function setupSidebar() {
    const ham = document.getElementById('hamburger');
    const backdrop = document.getElementById('sidebarBackdrop');
    const sidebar = document.getElementById('sidebar');
    if (ham) ham.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        backdrop.classList.toggle('visible');
        ham.classList.toggle('open');
    });
    if (backdrop) backdrop.addEventListener('click', closeSidebar);
}

// ══════════════════════════════════════════════
// AI DRAWER
// ══════════════════════════════════════════════
function openDrawer(prefill) {
    drawerOpen = true;
    document.getElementById('aiDrawer').classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('visible');
    document.getElementById('aiFloatBtn').classList.add('drawer-open');
    if (prefill) { document.getElementById('messageInput').value = prefill; }
    document.getElementById('messageInput').focus();
}

function closeDrawer() {
    drawerOpen = false;
    document.getElementById('aiDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('visible');
    document.getElementById('aiFloatBtn').classList.remove('drawer-open');
}

function setupDrawer() {
    document.getElementById('aiFloatBtn').addEventListener('click', () => { drawerOpen ? closeDrawer() : openDrawer(); });
    document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
}

// ══════════════════════════════════════════════
// LOCATION
// ══════════════════════════════════════════════
function detectLocation() {
    const saved = LS.get('glowguide_location');
    if (saved) { userCity = saved.city || ''; userCountry = saved.country || ''; updateLocationUI(); return; }
    if (!navigator.geolocation) { showManualLocation(); return; }
    const t = setTimeout(showManualLocation, 5000);
    navigator.geolocation.getCurrentPosition(async pos => {
        clearTimeout(t);
        try {
            const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`);
            const d = await r.json();
            userCity = d.city || d.locality || d.principalSubdivision || '';
            userCountry = d.countryName || '';
            LS.set('glowguide_location', { city: userCity, country: userCountry });
            updateLocationUI();
        } catch { showManualLocation(); }
    }, () => { clearTimeout(t); showManualLocation(); }, { timeout: 5000 });
}

function updateLocationUI() {
    const txt = [userCity, userCountry].filter(Boolean).join(', ') || 'Location unknown';
    const el = document.getElementById('sidebarLocationText');
    if (el) el.textContent = txt;
    const dt = document.getElementById('dermLocationText');
    if (dt) dt.textContent = txt;
}

function showManualLocation() {
    const el = document.getElementById('sidebarLocationText');
    if (el) el.textContent = 'Set location in Settings';
}

function getUserLocation() { return { city: userCity, country: userCountry || 'USA' }; }

// ══════════════════════════════════════════════
// AI PROVIDER
// ══════════════════════════════════════════════
async function fetchAIProvider() {
    try {
        const r = await fetch('/api/provider');
        const d = await r.json();
        const el = document.getElementById('drawerProviderText');
        if (el) el.textContent = d.name;
    } catch { }
}

// ══════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════
function initHome() {
    // Greeting
    const hour = new Date().getHours();
    let timeOfDay = '';
    if (hour >= 5 && hour < 12) {
        timeOfDay = 'Good morning';
    } else if (hour >= 12 && hour < 17) {
        timeOfDay = 'Good afternoon';
    } else if (hour >= 17 && hour < 21) {
        timeOfDay = 'Good evening';
    } else {
        timeOfDay = 'Good night';
    }
    const name = currentUser?.displayName ? currentUser.displayName.split(' ')[0] : 'Beautiful';
    document.getElementById('homeGreeting').textContent = `${timeOfDay}, ${name}`;

    // Date
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('homeDate').textContent = new Date().toLocaleDateString('en-US', dateOptions);

    // Tip
    const tipIdx = new Date().getDate() % TIPS.length;
    const tip = TIPS[tipIdx];
    document.getElementById('homeTipText').textContent = tip;

    // Share tip
    const shareBtn = document.getElementById('tipShareBtn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(tip).then(() => {
            shareBtn.textContent = '✓ Copied!';
            shareBtn.classList.add('copied');
            setTimeout(() => { shareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Share tip'; shareBtn.classList.remove('copied'); }, 2000);
        });
    });

    // Water ring
    renderHomeWaterRing();

    // Skin profile snapshot
    renderHomeProfile();

    // Routine
    renderHomeRoutine();

    // Insights (Recent Sessions)
    renderInsights();

    // CTA buttons in cards
    ['homeBeginConsultBtn', 'homeGetRoutineBtn', 'homeFirstConsultBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => openDrawer("Let's start my skin consultation");
    });
}

function renderHomeWaterRing() {
    const target = LS.get('glowguide_water_target', { glasses: 8, ml: 2000 });
    const entries = LS.get('glowguide_water_' + today(), []);
    const drunk = entries.reduce((s, e) => s + (e.amount || 250), 0);
    const dGlasses = Math.floor(drunk / 250);
    const tGlasses = target.glasses || 8;
    const circ = 314;
    const offset = circ - (circ * Math.min(dGlasses / tGlasses, 1));

    const fill = document.getElementById('homeWaterRingFill');
    const count = document.getElementById('homeWaterCount');
    const tgt = document.getElementById('homeWaterTarget');
    const hint = document.getElementById('waterHomeHint');

    if (fill) fill.style.strokeDashoffset = offset;
    if (count) count.textContent = dGlasses;
    if (tgt) tgt.textContent = `/ ${tGlasses} glasses`;
    if (hint) hint.textContent = dGlasses >= tGlasses ? '🎉 Goal reached today!' : `${tGlasses - dGlasses} more to go`;

    const addBtn = document.getElementById('homeAddGlassBtn');
    if (addBtn) {
        // Clear old listeners by cloning
        const newAddBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.addEventListener('click', async () => {
            const newEntries = [...LS.get('glowguide_water_' + today(), []), { time: timeStr(), amount: 250 }];
            LS.set('glowguide_water_' + today(), newEntries);
            await saveWaterLogToFirestore(newEntries);
            renderHomeWaterRing(); // update the ring
            if (typeof renderWaterPage === 'function') renderWaterPage(); // update water page if open
        });
    }

    const nextLabel = document.getElementById('homeWaterNextReminder');
    if (nextLabel) {
        const reminders = LS.get('glowguide_water_reminders', { enabled: false, times: ['08:00', '10:30', '13:00', '16:00', '19:00'] });
        if (!reminders.enabled) {
            nextLabel.textContent = "Reminders off";
        } else if (!reminders.times || reminders.times.length === 0) {
            nextLabel.textContent = "No reminders set";
        } else {
            const now = new Date();
            const nowStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            const sorted = [...reminders.times].sort();
            const next = sorted.find(t => t > nowStr) || sorted[0];
            const isTomorrow = next <= nowStr;
            const [h, m] = next.split(':');
            let hNum = parseInt(h, 10);
            const ampm = hNum >= 12 ? 'PM' : 'AM';
            hNum = hNum % 12 || 12;
            nextLabel.textContent = `Next reminder: ${isTomorrow ? 'Tomorrow ' : ''}${hNum}:${m} ${ampm}`;
        }
    }
}

function renderHomeProfile() {
    const p = LS.get('glowguide_profile');
    const empty = document.getElementById('profileHomeEmpty');
    const data = document.getElementById('profileHomeData');
    const updateBtn = document.getElementById('homeUpdateProfileBtn');

    if (p && p.skinType) {
        if (empty) empty.style.display = 'none';
        if (data) {
            data.style.display = 'flex';
            if (updateBtn) updateBtn.style.display = 'block';

            document.getElementById('homeSkinType').textContent = p.skinType || '–';
            document.getElementById('homeSkinConcern').textContent = p.concern || '–';

            const budgetOutput = document.getElementById('homeSkinBudget');
            if (budgetOutput) budgetOutput.textContent = p.budget || '–';

            const routineOutput = document.getElementById('homeSkinRoutine');
            const routine = LS.get('glowguide_routine', { morning: [], evening: [] });
            const stepCount = (routine.morning?.length || 0) + (routine.evening?.length || 0);
            if (routineOutput) routineOutput.textContent = stepCount > 0 ? `${stepCount} steps total` : '–';
        }
    } else {
        if (empty) empty.style.display = 'flex';
        if (data) data.style.display = 'none';
        if (updateBtn) updateBtn.style.display = 'none';
    }
}

function renderHomeRoutine() {
    const empty = document.getElementById('routineHomeEmpty');
    const data = document.getElementById('routineHomeData');
    const stepsEl = document.getElementById('routineHomeSteps');
    if (!empty || !data || !stepsEl) return;

    empty.style.display = 'none';
    data.style.display = 'block';

    const defaultSteps = ['Cleanser', 'Toner', 'Serum', 'Moisturizer', 'SPF'];
    const storageKey = 'glowguide_todays_routine';

    // Reset at midnight
    let saved = LS.get(storageKey, { date: today(), steps: Array(5).fill(false) });
    if (saved.date !== today()) {
        saved = { date: today(), steps: Array(5).fill(false) };
        LS.set(storageKey, saved);
    }

    const renderSteps = () => {
        const doneCount = saved.steps.filter(Boolean).length;
        const total = saved.steps.length;
        const pct = Math.round(doneCount / total * 100);

        const fill = document.getElementById('homeRoutineProgressFill');
        const label = document.getElementById('homeRoutineProgressLabel');
        if (fill) fill.style.width = pct + '%';
        if (label) label.textContent = `${doneCount} of ${total} steps complete`;

        stepsEl.innerHTML = defaultSteps.map((step, i) => `
            <div class="routine-step-item ${saved.steps[i] ? 'completed' : ''}" data-index="${i}" style="cursor:pointer">
                <div class="routine-step-checkbox"></div>
                <span class="routine-step-text" style="${saved.steps[i] ? 'text-decoration:line-through;opacity:0.6' : ''}">${step}</span>
            </div>
        `).join('');

        stepsEl.querySelectorAll('.routine-step-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-index'), 10);
                saved.steps[idx] = !saved.steps[idx];
                LS.set(storageKey, saved);
                renderSteps();
            });
        });
    };

    renderSteps();
}

async function renderInsights() {
    const empty = document.getElementById('insightsEmpty');
    const list = document.getElementById('insightsList');
    if (!empty || !list || !_db || !currentUser) return;

    try {
        const snap = await _db.collection('users').doc(currentUser.uid).collection('consultations')
            .orderBy('createdAt', 'desc').limit(3).get();

        if (snap.empty) {
            empty.style.display = 'block';
            empty.innerHTML = `<p>No recent sessions. Start chatting to build your profile.</p><button class="cta-btn" onclick="openDrawer()">Start Consultation</button>`;
            list.style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        list.style.display = 'flex';

        list.innerHTML = snap.docs.map(doc => {
            const data = doc.data();
            const title = data.title || 'Skin Consultation';
            const dateStr = data.createdAt ? new Date(data.createdAt.toMillis()).toLocaleDateString() : 'Recent';
            return `
                <div class="insight-card" onclick="openDrawer()">
                    <div class="insight-text" style="font-weight:600">${title}</div>
                    <div class="insight-meta"><span>${dateStr}</span><span class="insight-continue">Continue →</span></div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error("Error loading consultations:", e);
    }
}

// ══════════════════════════════════════════════
// MY SKIN PROFILE PAGE
// ══════════════════════════════════════════════
function initProfile() {
    const p = LS.get('glowguide_profile');
    const empty = document.getElementById('profilePageEmpty');
    const data = document.getElementById('profilePageData');
    if (p && p.skinType) {
        if (empty) empty.style.display = 'none';
        if (data) {
            data.style.display = 'block';
            document.getElementById('profileSkinTypeFull').textContent = p.skinType || '–';
            document.getElementById('profileConcernFull').textContent = p.concern || '–';
            document.getElementById('profileBudgetFull').textContent = p.budget || '–';
            document.getElementById('profileLastConsultFull').textContent = p.lastConsult || '–';
            document.getElementById('profileNotesFull').textContent = p.notes || 'Complete more consultations to build out your profile.';
        }
    }
    ['profileBeginBtn', 'profileUpdateBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => openDrawer("Let's start my skin consultation");
    });
}

// ══════════════════════════════════════════════
// WATER TRACKER PAGE
// ══════════════════════════════════════════════
function initWater() {
    renderWaterPage();

    // Calculator
    document.getElementById('waterCalcBtn')?.addEventListener('click', () => {
        const weightRaw = parseFloat(document.getElementById('waterWeight').value);
        const unit = document.getElementById('waterWeightUnit').value;
        const weight_kg = unit === 'lbs' ? weightRaw * 0.453592 : weightRaw;
        const activity = document.getElementById('waterActivity').value;
        const climate = document.getElementById('waterClimate').value;
        const condition = document.getElementById('waterCondition').value;

        if (!weight_kg || weight_kg < 20) { alert('Please enter a valid weight.'); return; }

        let ml = weight_kg * 33;
        if (activity === 'active') ml += 500;
        if (activity === 'very_active') ml += 700;
        if (activity === 'sedentary') ml -= 200;
        if (climate === 'hot') ml += 300;
        if (condition === 'pregnant') ml += 300;
        if (condition === 'breastfeeding') ml += 500;

        const glasses = Math.ceil(ml / 250);
        const settingsPayload = { target: { glasses, ml: Math.round(ml) }, profile: { weight_kg, activity, climate, condition } };

        LS.set('glowguide_water_target', settingsPayload.target);
        LS.set('glowguide_water_profile', settingsPayload.profile);
        saveWaterSettingsToFirestore(settingsPayload);

        document.getElementById('waterResultGlasses').textContent = glasses;
        document.getElementById('waterResultMl').textContent = Math.round(ml);
        document.getElementById('waterResult').style.display = 'block';
        renderWaterPage();
        if (typeof renderHomeWaterRing === 'function') renderHomeWaterRing();
    });

    // Add glass
    document.getElementById('addGlassBtn')?.addEventListener('click', () => addWater(250));

    // Add custom
    document.getElementById('addCustomBtn')?.addEventListener('click', () => {
        const amt = parseInt(prompt('Enter amount in ml (e.g. 500):'), 10);
        if (amt && amt > 0 && amt < 2000) addWater(amt);
    });

    // Reminder toggle
    const toggle = document.getElementById('reminderToggle');
    const slots = document.getElementById('reminderTimeSlots');
    const hint = document.querySelector('.reminder-hint');
    const savedReminders = LS.get('glowguide_water_reminders', { enabled: false, times: ['08:00', '10:30', '13:00', '16:00', '19:00'] });

    if (toggle && savedReminders.enabled) {
        toggle.checked = true;
        if (slots) slots.style.display = 'flex';
        if (hint) hint.style.display = 'none';
    }

    // Populate the inputs if we have saved times
    if (savedReminders.times && savedReminders.times.length > 0) {
        if (slots) {
            slots.innerHTML = savedReminders.times.map(t =>
                `<div class="time-slot"><input type="time" class="time-input reminder-time" value="${t}"><button class="remove-time-btn" onclick="this.closest('.time-slot').remove()">×</button></div>`
            ).join('') + `<button class="secondary-btn" id="addTimeSlotBtn" style="margin-top:8px">+ Add Time</button><button class="cta-btn" id="saveRemindersBtn" style="margin-top:8px; margin-left:8px">Save Reminders</button>`;
        }
    }

    toggle?.addEventListener('change', () => {
        if (slots) slots.style.display = toggle.checked ? 'flex' : 'none';
        if (hint) hint.style.display = toggle.checked ? 'none' : 'block';
    });

    // Remove time buttons
    document.querySelectorAll('.remove-time-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.time-slot').remove());
    });

    // Save reminders
    document.getElementById('saveRemindersBtn')?.addEventListener('click', saveReminders);
    document.addEventListener('click', e => {
        if (e.target && e.target.id === 'saveRemindersBtn') saveReminders();
        if (e.target && e.target.id === 'addTimeSlotBtn') {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.innerHTML = `<input type="time" class="time-input reminder-time" value="12:00"><button class="remove-time-btn" onclick="this.closest('.time-slot').remove()">×</button>`;
            document.getElementById('reminderTimeSlots').insertBefore(slot, e.target);
        }
    });

    // Start interval if reminders enabled
    if (savedReminders.enabled && savedReminders.times.length) startReminderInterval();

    // Weekly chart
    renderWeeklyChart();
}

function addWater(amount) {
    const key = 'glowguide_water_' + today();
    const entries = LS.get(key, []);
    entries.push({ amount, time: timeStr() });
    LS.set(key, entries);
    saveWaterLogToFirestore(entries); // dual-write to Firestore
    renderWaterPage();
    // Also refresh home ring if visible
    if (document.getElementById('page-home')?.classList.contains('active')) renderHomeWaterRing();
}

function renderWaterPage() {
    const target = LS.get('glowguide_water_target', { glasses: 8, ml: 2000 });
    const entries = LS.get('glowguide_water_' + today(), []);
    const drunk = entries.reduce((s, e) => s + (e.amount || 250), 0);
    const dGlasses = Math.floor(drunk / 250);
    const tGlasses = target.glasses || 8;

    const circ = 427;
    const offset = circ - (circ * Math.min(dGlasses / tGlasses, 1));
    const ringFill = document.getElementById('waterPageRingFill');
    if (ringFill) ringFill.style.strokeDashoffset = offset;
    const pageCount = document.getElementById('waterPageCount');
    if (pageCount) pageCount.textContent = dGlasses;
    const pageTgt = document.getElementById('waterPageTarget');
    if (pageTgt) {
        const pct = Math.round((dGlasses / tGlasses) * 100);
        let msg = `${pct}% of daily goal`;
        if (pct >= 100) msg = '🎉 Goal crushed!';
        else if (pct >= 75) msg = "Almost there! 💧";
        else if (pct >= 50) msg = "Halfway done! Keep it up!";
        pageTgt.textContent = msg;
    }

    // Glass icons
    const gi = document.getElementById('glassIcons');
    if (gi) {
        gi.innerHTML = Array.from({ length: Math.max(tGlasses, dGlasses) }, (_, i) =>
            `<div class="glass-icon${i < dGlasses ? ' filled' : ''}" data-index="${i}" style="cursor:pointer" title="Glass ${i + 1}"></div>`
        ).join('');

        // Interactive toggle
        gi.querySelectorAll('.glass-icon').forEach((icon, i) => {
            icon.addEventListener('click', async () => {
                let currentEntries = LS.get('glowguide_water_' + today(), []);
                if (i < dGlasses) {
                    // Remove a glass (pop the last 250ml entry)
                    const reverseIdx = [...currentEntries].reverse().findIndex(e => e.amount === 250);
                    if (reverseIdx !== -1) {
                        currentEntries.splice(currentEntries.length - 1 - reverseIdx, 1);
                    } else {
                        currentEntries.pop(); // Fallback to just popping the last entry
                    }
                } else {
                    // Add a glass
                    currentEntries.push({ time: timeStr(), amount: 250 });
                }
                LS.set('glowguide_water_' + today(), currentEntries);
                await saveWaterLogToFirestore(currentEntries);
                renderWaterPage();
                if (typeof renderHomeWaterRing === 'function') renderHomeWaterRing();
            });
        });
    }

    // Log
    const log = document.getElementById('waterLog');
    if (log) {
        if (!entries.length) {
            log.innerHTML = '<p class="water-log-empty">No entries yet today</p>';
        } else {
            log.innerHTML = [...entries].reverse().map(e =>
                `<div class="water-log-entry"><span class="log-amount">💧 ${e.amount}ml</span><span class="log-time">${e.time}</span></div>`
            ).join('');
        }
    }
}

function renderWeeklyChart() {
    const chart = document.getElementById('weeklyChart');
    if (!chart) return;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const target = LS.get('glowguide_water_target', { glasses: 8 }).glasses;
    const now = new Date();
    let html = '';
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const entries = LS.get('glowguide_water_' + key, []);
        const drunk = entries.reduce((s, e) => s + (e.amount || 250), 0);
        const g = Math.min(Math.floor(drunk / 250), target);
        const pct = target ? (g / target * 100) : 0;
        const isToday = key === today();
        const dayName = days[d.getDay()];
        html += `<div class="week-bar-wrap">
            <div class="week-bar-bg"><div class="week-bar-fill${isToday ? ' today' : ''}" style="height:${pct}%"></div></div>
            <div class="week-bar-label">${isToday ? 'Today' : dayName}</div>
            <div class="week-bar-count">${g}/${target}</div>
        </div>`;
    }
    chart.innerHTML = html;
}

function saveReminders() {
    const times = Array.from(document.querySelectorAll('.reminder-time')).map(i => i.value).filter(Boolean);
    const enabled = document.getElementById('reminderToggle').checked;
    const reminders = { enabled, times };
    LS.set('glowguide_water_reminders', reminders);
    saveWaterSettingsToFirestore({ reminders }); // Merge to firestore

    // Update home ring if possible
    if (typeof renderHomeWaterRing === 'function') renderHomeWaterRing();

    if (enabled && times.length) {
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(p => { if (p === 'granted') startReminderInterval(); });
        } else if (Notification.permission === 'granted') {
            startReminderInterval();
        }
    } else {
        if (reminderInterval) clearInterval(reminderInterval);
    }
    alert('Reminders saved!');
}

function startReminderInterval() {
    if (reminderInterval) clearInterval(reminderInterval);
    reminderInterval = setInterval(() => {
        const reminders = LS.get('glowguide_water_reminders', { enabled: false, times: [] });
        if (!reminders.enabled || Notification.permission !== 'granted') return;

        const now = new Date();
        const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        if (reminders.times.includes(cur)) {
            // Check if already notified this exact minute today
            const lastNotified = LS.get('glowguide_last_notification', null);
            const currentNotifKey = `${today()}_${cur}`;

            if (lastNotified !== currentNotifKey) {
                LS.set('glowguide_last_notification', currentNotifKey);
                const target = LS.get('glowguide_water_target', { glasses: 8 }).glasses;
                const entries = LS.get('glowguide_water_' + today(), []);
                const drunk = Math.floor(entries.reduce((s, e) => s + (e.amount || 250), 0) / 250);
                new Notification('💧 GlowGuide Water Reminder', {
                    body: `Time to drink water! You've had ${drunk} glasses. ${target - drunk} more to reach your goal.`,
                    icon: '/favicon.ico'
                });
            }
        }
    }, 60000);
}

// ══════════════════════════════════════════════
// ROUTINES PAGE
// ══════════════════════════════════════════════
function initRoutines() {
    const routine = LS.get('glowguide_routine');
    const empty = document.getElementById('routinesEmpty');
    const data = document.getElementById('routinesData');

    ['routinesBeginBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => openDrawer("Let's start my skin consultation");
    });

    if (!routine) return;
    if (empty) empty.style.display = 'none';
    if (data) data.style.display = 'block';

    renderRoutineSteps('morning', routine.morning || []);
    renderRoutineSteps('evening', routine.evening || []);
    updateRoutineProgress();
}

function renderRoutineSteps(time, steps) {
    const container = document.getElementById(time + 'Steps');
    if (!container) return;
    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });
    container.innerHTML = steps.map((step, i) => {
        const isDone = (done[time] || [])[i];
        return `<div class="routine-step-item${isDone ? ' completed' : ''}" data-time="${time}" data-idx="${i}">
            <div class="routine-step-checkbox"></div>
            <span class="routine-step-text">${step}</span>
        </div>`;
    }).join('');
    container.querySelectorAll('.routine-step-item').forEach(item => {
        item.addEventListener('click', () => toggleRoutineStep(item.dataset.time, parseInt(item.dataset.idx)));
    });
}

function toggleRoutineStep(time, idx) {
    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });
    if (!done[time]) done[time] = [];
    done[time][idx] = !done[time][idx];
    LS.set('glowguide_routine_done_' + today(), done);
    const routine = LS.get('glowguide_routine');
    renderRoutineSteps('morning', routine.morning || []);
    renderRoutineSteps('evening', routine.evening || []);
    updateRoutineProgress();
}

function updateRoutineProgress() {
    const routine = LS.get('glowguide_routine', { morning: [], evening: [] });
    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });
    const total = (routine.morning || []).length + (routine.evening || []).length;
    const doneCount = (done.morning || []).filter(Boolean).length + (done.evening || []).filter(Boolean).length;
    const pct = total ? Math.round(doneCount / total * 100) : 0;
    const fill = document.getElementById('routineProgressFill');
    const label = document.getElementById('routineProgressLabel');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = `${doneCount} of ${total} steps complete`;
}

// ══════════════════════════════════════════════
// PRODUCTS PAGE
// ══════════════════════════════════════════════
function initProducts() {
    const products = LS.get('glowguide_saved_products', []);
    const empty = document.getElementById('productsEmpty');
    const grid = document.getElementById('productsGrid');
    const disc = document.getElementById('productsDisclaimer');

    const beginBtn = document.getElementById('productsBeginBtn');
    if (beginBtn) beginBtn.onclick = () => openDrawer("Let's start my skin consultation");

    if (!products.length) return;
    if (empty) empty.style.display = 'none';
    if (grid) {
        grid.style.display = 'grid';
        grid.innerHTML = products.map(p => createProductCard(p)).join('');
    }
    if (disc) disc.style.display = 'block';
}

// ══════════════════════════════════════════════
// DERMATOLOGIST PAGE
// ══════════════════════════════════════════════
function initDerm() {
    updateLocationUI();
    const findBtn = document.getElementById('findDermBtn');
    if (findBtn) findBtn.addEventListener('click', findDermatologists);
}

async function findDermatologists() {
    const resultsEl = document.getElementById('dermResults');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:24px">🔍 Searching for dermatologists near you...</p>';
    const loc = getUserLocation();
    if (!loc.city && !loc.country) {
        resultsEl.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:24px">Please set your location in Settings first.</p>';
        return;
    }
    try {
        const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Find 3 real dermatologist clinics in ${loc.city}, ${loc.country}. For each provide: name, address, phone if available, rating if available. Format as a simple list.` })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const html = formatMessage(d.response);
        resultsEl.innerHTML = `<div class="home-card full-width-card" style="animation:fadeIn 0.3s ease">${html}</div>`;
    } catch (err) {
        resultsEl.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:24px">Could not load dermatologists: ${err.message}</p>`;
    }
}

// ══════════════════════════════════════════════
// SETTINGS PAGE
// ══════════════════════════════════════════════
function initSettings() {
    // 1. Account Section
    const nameInput = document.getElementById('settingsName');
    const emailOutput = document.getElementById('settingsEmail');
    const avatar = document.getElementById('settingsAvatar');
    const pwdBtn = document.getElementById('settingsChangePwdBtn');

    if (currentUser) {
        const name = currentUser.displayName || LS.get('glowguide_username', 'User');
        if (nameInput) nameInput.value = name;
        if (emailOutput) emailOutput.textContent = currentUser.email || 'No email associated';
        if (avatar) {
            avatar.textContent = name.charAt(0).toUpperCase();
            // Generate deterministic pleasant color
            const hue = (name.charCodeAt(0) * 137) % 360;
            avatar.style.backgroundColor = `hsl(${hue}, 40%, 55%)`;
        }

        // Show change password btn if email provider
        const isPassword = currentUser.providerData.some(p => p.providerId.includes('password'));
        if (isPassword && pwdBtn) {
            pwdBtn.style.display = 'block';
            pwdBtn.onclick = () => {
                auth.sendPasswordResetEmail(currentUser.email).then(() => {
                    alert('Password reset email sent! Please check your inbox.');
                }).catch(e => alert(e.message));
            };
        }
    }

    document.getElementById('settingsSaveAccountBtn')?.addEventListener('click', async () => {
        const newName = document.getElementById('settingsName')?.value.trim();
        if (newName && currentUser) {
            try {
                await currentUser.updateProfile({ displayName: newName });
                LS.set('glowguide_username', newName);
                if (avatar) avatar.textContent = newName.charAt(0).toUpperCase();
                // Update sidebar avatar
                const sidebarAv = document.getElementById('sidebarAvatar');
                if (sidebarAv) sidebarAv.textContent = newName.charAt(0).toUpperCase();
                const sidebarName = document.getElementById('sidebarUsername');
                if (sidebarName) sidebarName.textContent = newName;

                alert('Account profile saved!');
            } catch (e) { alert(e.message); }
        }
    });

    // 2. Preferences
    const modelSelect = document.getElementById('settingsAiModel');
    if (modelSelect) {
        modelSelect.value = LS.get('glowguide_ai_model', 'v1');
        modelSelect.addEventListener('change', (e) => LS.set('glowguide_ai_model', e.target.value));
    }

    const unitMlBtn = document.getElementById('unitMlBtn');
    const unitOzBtn = document.getElementById('unitOzBtn');
    if (unitMlBtn && unitOzBtn) {
        const setUnit = (unit) => {
            LS.set('glowguide_water_unit', unit);
            if (unit === 'ml') { unitMlBtn.classList.add('active'); unitOzBtn.classList.remove('active'); }
            else { unitOzBtn.classList.add('active'); unitMlBtn.classList.remove('active'); }
        };
        setUnit(LS.get('glowguide_water_unit', 'ml'));
        unitMlBtn.onclick = () => setUnit('ml');
        unitOzBtn.onclick = () => setUnit('oz');
    }

    const notifToggle = document.getElementById('settingsNotifToggle');
    if (notifToggle) {
        notifToggle.checked = Notification.permission === 'granted';
        notifToggle.addEventListener('change', async (e) => {
            if (e.target.checked && Notification.permission !== 'granted') {
                const p = await Notification.requestPermission();
                e.target.checked = (p === 'granted');
            }
        });
    }

    // 3. Data & Privacy
    document.getElementById('settingsExportBtn')?.addEventListener('click', async () => {
        if (!currentUser || !_db) return;
        try {
            const btn = document.getElementById('settingsExportBtn');
            const originalText = btn.innerHTML;
            btn.textContent = 'Preparing export...';

            const snap = await _db.collection('users').doc(currentUser.uid).get();
            const data = snap.exists ? snap.data() : {};

            // Consultations
            const cSnap = await _db.collection('users').doc(currentUser.uid).collection('consultations').get();
            data.consultations = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Water logs
            const wSnap = await _db.collection('users').doc(currentUser.uid).collection('waterLogs').get();
            data.waterLogs = wSnap.docs.reduce((acc, doc) => ({ ...acc, [doc.id]: doc.data() }), {});

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'glowguide_data.json';
            a.click();
            URL.revokeObjectURL(url);

            btn.innerHTML = originalText;
        } catch (e) {
            console.error(e);
            alert('Could not export data.');
            document.getElementById('settingsExportBtn').textContent = 'Export My Data';
        }
    });

    document.getElementById('settingsClearBtn')?.addEventListener('click', async () => {
        if (!confirm('This will delete all your past AI consultations. Are you sure?')) return;
        if (!currentUser || !_db) return;
        try {
            const batch = _db.batch();
            const snap = await _db.collection('users').doc(currentUser.uid).collection('consultations').get();
            snap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            LS.removeItem('glowguide_chat_history'); // clear locally
            alert('Consultation history cleared.');
            if (typeof renderInsights === 'function') renderInsights(); // Update home screen if needed
        } catch (e) {
            console.error(e);
        }
    });

    document.getElementById('settingsDeleteBtn')?.addEventListener('click', async () => {
        if (!confirm('Are you ABSOLUTELY sure you want to delete your account? This cannot be undone.')) return;
        if (!confirm('Final warning: All your data will be permanently deleted. Proceed?')) return;
        if (!currentUser || !_db) return;

        try {
            // Delete user doc
            await _db.collection('users').doc(currentUser.uid).delete();
            // Delete user Auth
            await currentUser.delete();
            // The onAuthStateChanged listener will automatically redirect to the login screen
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') {
                alert('For security reasons, please log out and log back in before deleting your account.');
            } else {
                alert(e.message);
            }
        }
    });
}

// ══════════════════════════════════════════════
// DERMATOLOGIST SEARCH
// ══════════════════════════════════════════════
let allDerms = [];

async function initDerm() {
    const container = document.getElementById('dermResultsContainer');
    if (!container) return;

    // Show skeletons
    container.innerHTML = Array(3).fill(`
        <div class="derm-card">
            <div class="derm-card-top">
                <div class="derm-card-photo skeleton-box"></div>
                <div class="derm-card-info" style="gap:8px; display:flex; flex-direction:column;">
                    <div class="skeleton-box" style="height:18px; width:70%;"></div>
                    <div class="skeleton-box" style="height:14px; width:40%;"></div>
                    <div class="skeleton-box" style="height:12px; width:90%;"></div>
                </div>
            </div>
            <div class="derm-card-actions">
                <div class="skeleton-box" style="height:36px; border-radius:20px; flex:1;"></div>
                <div class="skeleton-box" style="height:36px; border-radius:20px; flex:1;"></div>
            </div>
        </div>
    `).join('');

    // Attach filter listeners
    document.querySelectorAll('.derm-filter-pill').forEach(btn => {
        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            document.querySelectorAll('.derm-filter-pill').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderDermDocs(e.target.dataset.filter);
        });
    });

    const locText = document.getElementById('dermLocationText');
    const changeBtn = document.getElementById('changeDermLocationBtn');
    
    // Allow manual city input
    if (changeBtn) {
        changeBtn.onclick = () => {
            const newCity = prompt("Enter a city name (e.g. 'London', 'New York', or 'Paris'):");
            if (newCity && newCity.trim().length > 0) {
                LS.set('glowguide_location', { city: newCity.trim(), country: '', lat: 0, lng: 0, override: true });
                initDerm(); // Re-trigger search (note this mock lat/lng will trigger the API fallback to mock data unless geolocated)
            }
        };
    }

    // Get location
    const loc = LS.get('glowguide_location', { city: 'Unknown Location', country: '', lat: 0, lng: 0 });
    if (locText) {
        locText.textContent = loc.city + (loc.country ? `, ${loc.country}` : '');
    }

    try {
        const response = await fetch('/api/dermatologists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loc)
        });
        const data = await response.json();
        allDerms = data.results || [];
        
        // Ensure modal close button works
        const closeBtn = document.getElementById('bookingModalClose');
        const backdrop = document.getElementById('bookingModalBackdrop');
        const closeModal = () => {
            document.getElementById('bookingModal').classList.remove('open');
            setTimeout(() => { document.getElementById('bookingModal').style.display = 'none'; backdrop.style.display = 'none'; }, 300);
        };
        if (closeBtn) closeBtn.onclick = closeModal;
        if (backdrop) backdrop.onclick = closeModal;

        renderDermDocs('all');

    } catch (err) {
        console.error('Derm fetch failed', err);
        container.innerHTML = `<div class="page-empty-state"><div class="empty-illustration">⚠️</div><h3>Could not load doctors</h3><p>Please try again later. ${err.message}</p></div>`;
    }
}

function renderDermDocs(filter = 'all') {
    const container = document.getElementById('dermResultsContainer');
    if (!container) return;

    let filtered = [...allDerms];

    if (filter === 'highest_rated') {
        filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (filter === 'most_reviewed') {
        filtered.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
    } else if (filter === 'open_now') {
        filtered = filtered.filter(d => d.isOpenNow);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="page-empty-state" style="grid-column: 1 / -1;">
                <div class="empty-illustration">🩺</div>
                <h3>No dermatologists found</h3>
                <p>Try expanding your search radius or changing your location filters.</p>
                <button class="secondary-btn" onclick="initDerm()">Refresh Search</button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map((d, index) => {
        // Construct stars
        const fullStars = Math.floor(d.rating || 0);
        const starsHtml = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);

        // Construct open status badge
        let statusClass = 'unknown';
        let statusText = 'Hours unlisted';
        if (d.isOpenNow === true) { statusClass = 'open'; statusText = 'Open Now'; }
        else if (d.isOpenNow === false) { statusClass = 'closed'; statusText = 'Closed'; }

        const photoHtml = d.photoUrl 
            ? `<img src="${d.photoUrl}" alt="${d.name}" class="derm-card-photo">` 
            : `<div class="derm-card-photo">${d.name.charAt(0).toUpperCase()}</div>`;
        
        const reviewHtml = d.topReview ? `
            <div class="derm-card-extended">
                <span class="derm-extended-title">Top Patient Review</span>
                <span style="color:var(--gold); font-size:11px;">${'★'.repeat(d.topReview.rating || 5)}</span>
                <p style="margin-top:4px; font-style:italic;">"${d.topReview.text}"</p>
                <p style="margin-top:4px; font-size:11px; opacity:0.7;">- ${d.topReview.author}</p>
                ${d.openingHours && d.openingHours.length ? `
                    <span class="derm-extended-title" style="margin-top:12px;">Opening Hours</span>
                    <ul style="padding-left:14px; margin-top:4px;">${d.openingHours.map(h => `<li>${h}</li>`).join('')}</ul>
                ` : ''}
            </div>
        ` : '';

        // Note: we inject a global click handler directly stringified because attaching via DOM nodes in map is harder. 
        // We will attach an event delegation listener to the container instead.
        return `
            <div class="derm-card" data-index="${allDerms.indexOf(d)}" style="cursor:pointer;">
                <div class="derm-card-top">
                    ${photoHtml}
                    <div class="derm-card-info">
                        <div class="derm-tag">Dermatologist</div>
                        <h3 class="derm-doctor-name" title="${d.name}">${d.name}</h3>
                        <div class="derm-rating">
                            <span class="derm-stars">${starsHtml}</span>
                            <span style="color:var(--text);">${d.rating?.toFixed(1) || 'N/A'}</span>
                            <span class="derm-review-count">(${d.reviewCount || 0} reviews)</span>
                        </div>
                        <div class="derm-details-text"><span>📍</span> ${d.address || 'Address unlisted'}</div>
                        <div class="derm-badges">
                            <span class="derm-status-badge ${statusClass}"><span class="derm-status-dot"></span>${statusText}</span>
                            ${d.priceLevel ? `<span class="derm-price">${d.priceLevel}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="derm-card-actions">
                    <button class="derm-btn derm-btn-primary book-btn" data-index="${allDerms.indexOf(d)}">📅 Book</button>
                    ${d.googleMapsUrl ? `<a href="${d.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="derm-btn derm-btn-outline maps-btn">🗺 Maps</a>` : ''}
                </div>
                ${reviewHtml}
            </div>
        `;
    }).join('');

    // Attach delegated events
    container.querySelectorAll('.derm-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // ignore if clicked on a button
            if (e.target.closest('.derm-btn')) return;
            card.classList.toggle('expanded');
        });
    });

    container.querySelectorAll('.book-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookingModal(allDerms[btn.dataset.index]);
        });
    });
}

function openBookingModal(doc) {
    const modal = document.getElementById('bookingModal');
    const backdrop = document.getElementById('bookingModalBackdrop');
    
    document.getElementById('bookingModalName').textContent = doc.name;
    const photoWrap = document.getElementById('bookingModalPhoto');
    if (doc.photoUrl) {
        photoWrap.innerHTML = `<img src="${doc.photoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
    } else {
        photoWrap.innerHTML = doc.name.charAt(0).toUpperCase();
    }

    const webBtn = document.getElementById('bookingModalWebsite');
    if (doc.website) {
        webBtn.href = doc.website;
        webBtn.style.display = 'flex';
    } else {
        webBtn.style.display = 'none';
        webBtn.href = '#';
    }

    const phoneWrap = document.getElementById('bookingModalPhoneWrap');
    if (doc.phone) {
        phoneWrap.href = 'tel:' + doc.phone.replace(/[^0-9+]/g, '');
        document.getElementById('bookingModalPhoneText').textContent = doc.phone;
        phoneWrap.style.display = 'flex';
    } else {
        phoneWrap.style.display = 'none';
    }

    const dirBtn = document.getElementById('bookingModalDirections');
    if (doc.googleMapsUrl) {
        dirBtn.href = doc.googleMapsUrl;
        dirBtn.style.display = 'flex';
    } else {
        dirBtn.style.display = 'none';
    }

    backdrop.style.display = 'block';
    modal.style.display = 'block';
    
    // tiny delay for CSS transition
    setTimeout(() => { modal.classList.add('open'); }, 10);
}

// ══════════════════════════════════════════════
// AI CHAT
// ══════════════════════════════════════════════
function setupChat() {
    const sendBtn = document.getElementById('sendBtn');
    const msgInput = document.getElementById('messageInput');
    const imageInput = document.getElementById('imageInput');
    const pdfInput = document.getElementById('pdfInput');
    const removeImageBtn = document.getElementById('removeImage');
    const removePdfBtn = document.getElementById('removePdf');
    const startOverBtn = document.getElementById('startOverBtn');

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (msgInput) {
        msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
        msgInput.addEventListener('input', () => { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px'; });
    }

    if (imageInput) imageInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { addMessage('Please upload a valid image (JPG, PNG, WebP).', 'ai', null, true); imageInput.value = ''; return; }
        const reader = new FileReader();
        reader.onload = ev => { currentImage = ev.target.result; document.getElementById('previewImg').src = currentImage; document.getElementById('imagePreview').style.display = 'flex'; };
        reader.readAsDataURL(file);
    });

    if (removeImageBtn) removeImageBtn.addEventListener('click', () => { currentImage = null; imageInput.value = ''; document.getElementById('imagePreview').style.display = 'none'; });

    if (pdfInput) pdfInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const nameEl = document.getElementById('pdfName');
        if (nameEl) nameEl.textContent = 'Processing...';
        document.getElementById('pdfPreview').style.display = 'flex';
        try {
            currentPdfContent = await parsePdf(file);
            if (nameEl) nameEl.textContent = file.name + ' – Ready';
        } catch (err) {
            addMessage(err.message || 'Failed to parse PDF.', 'ai', null, true);
            currentPdfContent = null; pdfInput.value = ''; document.getElementById('pdfPreview').style.display = 'none';
        }
    });

    if (removePdfBtn) removePdfBtn.addEventListener('click', () => { currentPdfContent = null; pdfInput.value = ''; document.getElementById('pdfPreview').style.display = 'none'; });

    if (startOverBtn) startOverBtn.addEventListener('click', async () => {
        try { await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch { }
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
            const ws = document.createElement('div');
            ws.className = 'welcome-state';
            const hour = new Date().getHours();
            const gr = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            ws.innerHTML = `<div class="welcome-illustration"><svg width="120" height="140" viewBox="0 0 180 200" fill="none"><path d="M90 200 Q90 140 90 80" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round"/><path d="M90 120 Q110 105 125 90 Q108 100 90 108" stroke="#C9A84C" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M90 140 Q70 125 55 110 Q72 120 90 128" stroke="#C9A84C" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="90" cy="75" r="5" stroke="#C9A84C" stroke-width="1.5" fill="none"/></svg></div><h3 class="welcome-greeting">${gr}</h3><p class="welcome-subtitle">Ready to build your perfect skincare routine?</p><div class="quick-start-chips"><button class="quick-chip" data-prompt="Let's start my skin consultation">Begin Consultation</button><button class="quick-chip" data-prompt="I'd like to analyze my skin photo">Analyze Skin Photo</button><button class="quick-chip" data-prompt="What supplements should I take for better skin?">Supplement Guide</button></div>`;
            chatMessages.appendChild(ws);
            ws.querySelectorAll('.quick-chip').forEach(chip => chip.addEventListener('click', () => { document.getElementById('messageInput').value = chip.dataset.prompt; sendMessage(); }));
        }
    });

    // Quick chips
    document.querySelectorAll('.quick-chip').forEach(chip => {
        chip.addEventListener('click', () => { document.getElementById('messageInput').value = chip.dataset.prompt; sendMessage(); });
    });

    // Load chat history
    const history = LS.get('glowguide_chat_history', []);
    if (history.length) {
        const welcomeEl = document.getElementById('welcomeState');
        if (welcomeEl) welcomeEl.remove();
        history.forEach(m => addMessage(m.content, m.role, null, false, true));
    }
}

async function parsePdf(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async e => {
            try {
                const base64 = e.target.result.split(',')[1];
                const r = await fetch('/api/parse-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: base64 }) });
                const d = await r.json();
                if (!r.ok) reject(new Error(d.message || 'Failed to parse PDF'));
                else resolve(d.text);
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function sendMessage() {
    const msgInput = document.getElementById('messageInput');
    const message = msgInput.value.trim();
    if (!message && !currentImage && !currentPdfContent) return;

    const welcomeEl = document.getElementById('welcomeState');
    if (welcomeEl) welcomeEl.remove();

    addMessage(message, 'user', currentImage);

    // Save user message to history
    saveToHistory({ role: 'user', content: message, timestamp: timeStr() });

    let analyzingDiv = null;
    if (currentImage) {
        analyzingDiv = document.createElement('div');
        analyzingDiv.className = 'message ai-message';
        analyzingDiv.innerHTML = '<div class="message-content analyzing-message"><p>Analyzing your skin photo...</p></div>';
        document.getElementById('chatMessages').appendChild(analyzingDiv);
        scrollChat();
    }

    msgInput.value = '';
    msgInput.style.height = 'auto';

    const imageToSend = currentImage;
    const pdfToSend = currentPdfContent;
    currentImage = null;
    currentPdfContent = null;
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('pdfPreview').style.display = 'none';
    if (document.getElementById('imageInput')) document.getElementById('imageInput').value = '';
    if (document.getElementById('pdfInput')) document.getElementById('pdfInput').value = '';

    document.getElementById('loadingOverlay').style.display = 'flex';

    try {
        const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, image: imageToSend, pdfContent: pdfToSend })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed to get response');

        addMessage(d.response, 'ai');
        saveToHistory({ role: 'assistant', content: d.response, timestamp: timeStr() });

        // Extract and save profile info
        extractAndSaveProfile(d.response);

        // Show notif dot
        document.getElementById('aiNotifDot').style.display = 'block';
        setTimeout(() => { document.getElementById('aiNotifDot').style.display = 'none'; }, 5000);

        const hasRoutine = ['morning routine', 'evening routine', 'morning:', 'evening:', 'cleanser', 'moisturizer', 'sunscreen'].some(k => d.response.toLowerCase().includes(k));
        if (hasRoutine) {
            extractAndSaveRoutine(d.response);
            await searchAndDisplayProducts(d.response);
        }
    } catch (err) {
        addMessage('Sorry, something went wrong: ' + err.message, 'ai', null, true);
    } finally {
        if (analyzingDiv) analyzingDiv.remove();
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

function saveToHistory(entry) {
    const history = LS.get('glowguide_chat_history', []);
    history.push(entry);
    if (history.length > 50) history.splice(0, history.length - 50);
    LS.set('glowguide_chat_history', history);
}

function extractAndSaveProfile(text) {
    const lower = text.toLowerCase();
    let skinType = null;
    if (lower.includes('oily skin')) skinType = 'Oily';
    else if (lower.includes('dry skin')) skinType = 'Dry';
    else if (lower.includes('combination skin')) skinType = 'Combination';
    else if (lower.includes('sensitive skin')) skinType = 'Sensitive';
    else if (lower.includes('normal skin')) skinType = 'Normal';
    if (!skinType) return;
    const existing = LS.get('glowguide_profile', {});
    const updated = { ...existing, skinType, lastConsult: today(), consultCount: (existing.consultCount || 0) + 1, notes: text.slice(0, 400) };
    if (lower.includes('acne') || lower.includes('breakout')) updated.concern = 'Acne / Breakouts';
    else if (lower.includes('dark spot') || lower.includes('hyperpigment')) updated.concern = 'Dark Spots';
    else if (lower.includes('anti-aging') || lower.includes('wrinkle')) updated.concern = 'Anti-Aging';
    else if (lower.includes('redness') || lower.includes('rosacea')) updated.concern = 'Redness';
    LS.set('glowguide_profile', updated);
    saveProfileToFirestore(updated); // dual-write to Firestore
}

function extractAndSaveRoutine(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const morning = [];
    const evening = [];
    let section = null;
    lines.forEach(line => {
        const lower = line.toLowerCase();
        if (lower.includes('morning') || lower.includes('am routine') || lower.includes('daytime')) section = 'morning';
        else if (lower.includes('evening') || lower.includes('night') || lower.includes('pm routine')) section = 'evening';
        else if (section && (line.startsWith('-') || /^\d+\./.test(line) || line.startsWith('•'))) {
            const clean = line.replace(/^[-•\d.]+\s*/, '').trim();
            if (clean.length > 3) {
                if (section === 'morning') morning.push(clean);
                else evening.push(clean);
            }
        }
    });
    if (morning.length || evening.length) {
        const routine = { morning, evening, savedAt: today() };
        LS.set('glowguide_routine', routine);
        saveRoutineToFirestore(routine); // dual-write to Firestore
    }
}

function addMessage(text, sender, image = null, isError = false, silent = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const div = document.createElement('div');
    div.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
    const content = document.createElement('div');
    content.className = 'message-content';
    if (isError) content.style.backgroundColor = '#fff0f0';
    if (image && sender === 'user') {
        const img = document.createElement('img');
        img.src = image; img.style.maxWidth = '180px'; img.style.borderRadius = '8px'; img.style.marginBottom = '8px'; img.style.display = 'block';
        content.appendChild(img);
    }
    if (text) content.innerHTML += formatMessage(text);
    div.appendChild(content);
    chatMessages.appendChild(div);
    if (!silent) scrollChat();
}

function formatMessage(text) {
    let f = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    f = f.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
    return `<p>${f}</p>`;
}

function scrollChat() { const a = document.getElementById('chatMessages'); if (a) a.scrollTop = a.scrollHeight; }

async function searchAndDisplayProducts(routineText) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const searching = document.createElement('div');
    searching.className = 'message ai-message';
    searching.innerHTML = '<div class="message-content"><div class="products-loading">🔍 Finding products for your routine...<div class="loading-dots"><span></span><span></span><span></span></div></div></div>';
    chatMessages.appendChild(searching);
    scrollChat();
    try {
        const loc = getUserLocation();
        const r = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ routineText, skinConcern: '', budget: 'medium', country: loc.country, city: loc.city })
        });
        const d = await r.json();
        searching.remove();
        if (!r.ok || !d.products || !d.products.length) { addMessage('Product search unavailable right now — try searching on Amazon or Sephora.', 'ai'); return; }
        renderProductCards(d.products);
    } catch {
        searching.remove();
        addMessage('Product search unavailable right now.', 'ai');
    }
}

function renderProductCards(productGroups) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const allProducts = [];
    const morningP = productGroups.filter(g => g.timeOfDay === 'morning' || g.timeOfDay === 'both');
    const eveningP = productGroups.filter(g => g.timeOfDay === 'evening' || g.timeOfDay === 'both');
    const div = document.createElement('div');
    div.className = 'message ai-message';
    let html = '<div class="message-content"><div class="products-section">';
    const renderGroup = (groups, label) => {
        if (!groups.length) return;
        html += `<div class="products-section-header">${label}</div><div class="products-grid">`;
        groups.forEach(g => g.products.forEach(p => { html += createProductCard(p); allProducts.push(p); }));
        html += '</div>';
    };
    renderGroup(morningP, 'Morning Products');
    renderGroup(eveningP, 'Evening Products');
    html += '<p class="products-disclaimer" style="margin-top:10px">Always patch test new products.</p></div></div>';
    div.innerHTML = html;
    chatMessages.appendChild(div);
    scrollChat();
    // Save products
    const existing = LS.get('glowguide_saved_products', []);
    const merged = [...existing, ...allProducts.filter(p => !existing.find(e => e.name === p.name))].slice(0, 40);
    LS.set('glowguide_saved_products', merged);
}

function createProductCard(p) {
    const stars = p.rating ? '★'.repeat(Math.round(p.rating)) + '☆'.repeat(5 - Math.round(p.rating)) : '';
    const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23F0EAE0' width='100' height='100'/%3E%3C/svg%3E";
    return `<div class="product-card">
        <img class="product-image" src="${p.thumbnail || fallback}" alt="${p.name}" onerror="this.src='${fallback}'">
        <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="product-price">${p.price}</div>
            ${stars ? `<div class="product-rating"><span class="product-stars">${stars}</span></div>` : ''}
            <div class="product-source">${p.source}</div>
            ${p.link ? `<a href="${p.link}" target="_blank" rel="noopener noreferrer" class="product-shop-btn">Shop Now</a>` : '<span class="product-shop-btn" style="opacity:.5;cursor:default">Unavailable</span>'}
        </div>
    </div>`;
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // ── Firebase Auth (gates app visibility) ──
    // initFirebaseAuth calls showApp() or showAuth() based on login state.
    // All other setup runs regardless but the UI is hidden until auth resolves.
    initFirebaseAuth();

    detectLocation();
    fetchAIProvider();
    setupSidebar();
    setupDrawer();
    setupChat();

    // Route to initial page (will show after auth gate opens)
    navigateTo(location.hash || '#home');
    if (location.hash.includes('dermatologist')) initDerm();

    // Listen for global hash changes to trigger page loads
    window.addEventListener('hashchange', () => {
        if (window.location.hash.includes('dermatologist')) {
            initDerm();
        }
    });

    console.log('GlowGuide Wellness Dashboard loaded ✨');
});
