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
            .then(() => { loadFirestoreData(user); loadSessionsFromFirestore(); })
            .catch(console.error);
    }

    // Show migration toast if localStorage has data
    checkForLocalDataMigration();

    // Show sign-out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.style.display = 'flex';

    // FIX E — Clear corrupted data (if > 20 glasses)
    const todayKey = today();
    const storedWater = LS.get('glowguide_water_' + todayKey, []);
    const drunkCount = Math.floor(storedWater.reduce((s, e) => s + (e.amount || 250), 0) / 250);
    if (drunkCount > 20) {
        LS.del('glowguide_water_' + todayKey);
        if (_db && currentUser) {
            _db.collection('users').doc(currentUser.uid)
                .collection('waterLogs').doc(todayKey).delete().catch(() => {});
        }
    }
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

// ── Image persistence helpers ─────────────────────────────────────────────────
/** Compress a base64 image to JPEG at reduced size for localStorage caching. */
async function compressImageForStorage(base64, maxWidthPx = 400) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ratio = Math.min(1, maxWidthPx / img.width);
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
        };
        img.onerror = () => resolve(base64); // fallback: return original on error
        img.src = 'data:image/jpeg;base64,' + base64;
    });
}

/** Save compressed image base64 to localStorage under a session-scoped key. */
function saveImageToLocal(key, base64) {
    try {
        const dataStr = JSON.stringify({ b: base64, ts: Date.now() });
        if (dataStr.length > 4 * 1024 * 1024) {
            console.warn('[GlowGuide] Image exceeds 4MB limit, skipping cache');
            return;
        }
        localStorage.setItem('gg_img_' + key, dataStr);
        const keys = JSON.parse(localStorage.getItem('gg_img_index') || '[]');
        if (!keys.includes(key)) {
            keys.unshift(key);
            localStorage.setItem('gg_img_index', JSON.stringify(keys.slice(0, 40)));
        }
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('[GlowGuide] localStorage full — clearing old images');
            clearOldSessionImages();
            try { localStorage.setItem('gg_img_' + key, JSON.stringify({ b: base64, ts: Date.now() })); } catch {}
        }
    }
}

/** Retrieve a saved image base64 string by key (returns null if not found). */
function getImageFromLocal(key) {
    try {
        const raw = localStorage.getItem('gg_img_' + key);
        return raw ? (JSON.parse(raw)?.b || null) : null;
    } catch { return null; }
}

/** Evict oldest cached images to free up localStorage space. */
function clearOldSessionImages() {
    try {
        const keys = JSON.parse(localStorage.getItem('gg_img_index') || '[]');
        keys.slice(20).forEach(k => localStorage.removeItem('gg_img_' + k));
        localStorage.setItem('gg_img_index', JSON.stringify(keys.slice(0, 20)));
    } catch {}
}
// ─────────────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function timeStr(d = new Date()) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let currentImage = null;
let currentPdfContent = null;
let userCity = '';
let userCountry = '';
let userLocale = null; // { country, currency, currencySymbol, region }
let drawerOpen = false;
let reminderInterval = null;
let glassUpdateInProgress = false; // Guard for Bug 2
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// ── Session state ──────────────────────────────
let currentSessionId = null;
let currentSessionMessages = [];
let currentSessionTitle = null;
let currentSessionCreatedAt = null;
let allSessions = [];

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
    document.getElementById('aiFloatBtn').style.display = 'none';
    // Only create a new session if there is no active session — never on reopen
    if (!currentSessionId) {
        startNewSession();
        showWelcomeState();
    }
    if (prefill) { document.getElementById('messageInput').value = prefill; }
    document.getElementById('messageInput').focus();
}

function closeDrawer() {
    drawerOpen = false;
    document.getElementById('aiDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('visible');
    document.getElementById('aiFloatBtn').style.display = 'flex';
}

function setupDrawer() {
    document.getElementById('aiFloatBtn').addEventListener('click', () => { drawerOpen ? closeDrawer() : openDrawer(); });
    document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
}

// ══════════════════════════════════════════════
// SESSION MANAGEMENT
// ══════════════════════════════════════════════

function startNewSession() {
    currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    currentSessionMessages = [];
    currentSessionTitle = null;
    currentSessionCreatedAt = new Date().toISOString();
}

async function saveCurrentSession() {
    if (!currentSessionId || currentSessionMessages.length === 0) return;
    if (!currentUser || !_db) return;
    const session = {
        id: currentSessionId,
        title: currentSessionTitle || 'New Consultation',
        messages: currentSessionMessages,
        createdAt: currentSessionCreatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    try {
        await _db.collection('users').doc(currentUser.uid)
            .collection('chatSessions').doc(currentSessionId).set(session, { merge: true });
        const idx = allSessions.findIndex(s => s.id === currentSessionId);
        if (idx >= 0) allSessions[idx] = session;
        else allSessions.unshift(session);
        renderSidebarHistory(allSessions);
    } catch (e) { console.error('[GlowGuide] Failed to save session:', e); }
}

async function generateSessionTitle(firstMessage) {
    if (!firstMessage || firstMessage.trim().length < 3) return;
    try {
        const r = await fetch('/api/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstMessage: firstMessage.trim() })
        });
        const d = await r.json();
        currentSessionTitle = d.title || 'New Consultation';
        updateSessionTitleInSidebar(currentSessionId, currentSessionTitle);
    } catch { currentSessionTitle = 'New Consultation'; }
}

function updateSessionTitleInSidebar(sessionId, title) {
    const row = document.querySelector(`#drawerSessionList .chat-history-row[data-id="${sessionId}"] .session-title`);
    if (row) row.textContent = title;
}

async function loadSessionsFromFirestore() {
    if (!currentUser || !_db) return;
    try {
        const snap = await _db.collection('users').doc(currentUser.uid)
            .collection('chatSessions').orderBy('updatedAt', 'desc').limit(30).get();
        allSessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allSessions = deduplicateSessions(allSessions);
        renderSidebarHistory(allSessions);
    } catch (e) { console.error('[GlowGuide] loadSessions error:', e); }
}

function deduplicateSessions(sessions) {
    const seen = new Set();
    return sessions.filter(session => {
        const createdAt = session.createdAt;
        let secs;
        if (createdAt && typeof createdAt.seconds === 'number') {
            secs = createdAt.seconds;
        } else if (createdAt) {
            secs = Math.floor(new Date(createdAt).getTime() / 1000);
        } else {
            secs = 0;
        }
        const key = (session.title || 'New Consultation') + '_' + Math.floor(secs / 60);
        if (seen.has(key)) {
            if (currentUser && _db) {
                _db.collection('users').doc(currentUser.uid)
                    .collection('chatSessions').doc(session.id)
                    .delete().catch(e => console.error('[GlowGuide] dedup delete failed:', e));
            }
            return false;
        }
        seen.add(key);
        return true;
    });
}

function renderSidebarHistory(sessions) {
    const list = document.getElementById('drawerSessionList');
    if (!list) return;
    if (!sessions || sessions.length === 0) {
        list.innerHTML = '<div class="drawer-session-empty">No past chats yet</div>';
        return;
    }
    const query = (document.getElementById('drawerChatSearch')?.value || '').toLowerCase();
    const filtered = query ? sessions.filter(s => (s.title || '').toLowerCase().includes(query)) : sessions;
    if (filtered.length === 0) { list.innerHTML = '<div class="drawer-session-empty">No matching chats</div>'; return; }
    list.innerHTML = filtered.map(s => `
        <div class="chat-history-row${s.id === currentSessionId ? ' active' : ''}" data-id="${escapeHtml(s.id)}" role="button" tabindex="0">
            <div class="session-info">
                <div class="session-title">${escapeHtml(s.title || 'New Consultation')}</div>
                <div class="session-time">${formatRelativeTime(s.updatedAt)}</div>
            </div>
            <button class="session-delete-btn" data-id="${escapeHtml(s.id)}" aria-label="Delete session" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
        </div>`).join('');
    list.querySelectorAll('.chat-history-row').forEach(row => {
        row.addEventListener('click', e => { if (e.target.closest('.session-delete-btn')) return; loadSessionIntoChat(row.dataset.id); });
        row.addEventListener('keydown', e => { if (e.key === 'Enter') loadSessionIntoChat(row.dataset.id); });
    });
    list.querySelectorAll('.session-delete-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteSession(btn.dataset.id, btn); });
    });
}

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const ts = typeof isoString === 'string' ? new Date(isoString).getTime()
        : (isoString.toMillis ? isoString.toMillis() : Number(isoString));
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadSessionIntoChat(sessionId) {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;
    await saveCurrentSession();
    currentSessionId = session.id;
    currentSessionMessages = [...(session.messages || [])];
    currentSessionTitle = session.title;
    currentSessionCreatedAt = session.createdAt;
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    currentSessionMessages.forEach(m => {
        if (m.imageKey) {
            const imgB64 = getImageFromLocal(m.imageKey);
            const imgSrc = imgB64 ? 'data:image/jpeg;base64,' + imgB64 : null;
            // Render the image (with any accompanying text stripped of placeholder)
            addMessage(m.content === '[Skin photo shared]' ? '' : m.content, 'user', imgSrc, false, true);
        } else {
            addMessage(m.content, m.role === 'user' ? 'user' : 'ai', null, false, true);
        }
    });
    scrollChat();
    document.querySelectorAll('.chat-history-row').forEach(r => r.classList.toggle('active', r.dataset.id === sessionId));
    if (!drawerOpen) openDrawer();
}

function confirmDeleteSession(sessionId, btn) {
    document.querySelector('.session-confirm-delete')?.remove();
    const confirm = document.createElement('div');
    confirm.className = 'session-confirm-delete';
    confirm.innerHTML = '<span>Delete?</span><button class="confirm-yes">Yes</button><button class="confirm-no">No</button>';
    btn.closest('.chat-history-row').appendChild(confirm);
    confirm.querySelector('.confirm-yes').addEventListener('click', e => { e.stopPropagation(); deleteSession(sessionId); });
    confirm.querySelector('.confirm-no').addEventListener('click', e => { e.stopPropagation(); confirm.remove(); });
}

async function deleteSession(sessionId) {
    if (!currentUser || !_db) return;
    try {
        await _db.collection('users').doc(currentUser.uid).collection('chatSessions').doc(sessionId).delete();
        allSessions = allSessions.filter(s => s.id !== sessionId);
        renderSidebarHistory(allSessions);
        if (currentSessionId === sessionId) { startNewSession(); showWelcomeState(); }
    } catch (e) { console.error('[GlowGuide] deleteSession error:', e); }
}

function showWelcomeState() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    const ws = document.createElement('div');
    ws.className = 'welcome-state';
    ws.id = 'welcomeState';
    const hour = new Date().getHours();
    const gr = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    ws.innerHTML = `<div class="welcome-illustration"><svg width="120" height="140" viewBox="0 0 180 200" fill="none"><path d="M90 200 Q90 140 90 80" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round"/><path d="M90 120 Q110 105 125 90 Q108 100 90 108" stroke="#C9A84C" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M90 140 Q70 125 55 110 Q72 120 90 128" stroke="#C9A84C" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="90" cy="75" r="5" stroke="#C9A84C" stroke-width="1.5" fill="none"/></svg></div><h3 class="welcome-greeting">${gr}</h3><p class="welcome-subtitle">Ready to build your perfect skincare routine?</p><div class="quick-start-chips"><button class="quick-chip" data-prompt="Let's start my skin consultation">Begin Consultation</button><button class="quick-chip" data-prompt="I'd like to analyze my skin photo">Analyze Skin Photo</button><button class="quick-chip" data-prompt="What supplements should I take for better skin?">Supplement Guide</button></div>`;
    chatMessages.appendChild(ws);
    ws.querySelectorAll('.quick-chip').forEach(chip => chip.addEventListener('click', () => {
        if (chip.dataset.prompt && chip.dataset.prompt.toLowerCase().includes('consultation')) startConsultationFlow();
        else { document.getElementById('messageInput').value = chip.dataset.prompt; sendMessage(); }
    }));
}

function setupSessionHistory() {
    const newBtn = document.getElementById('drawerNewChatBtn');
    if (newBtn) newBtn.addEventListener('click', async () => {
        await saveCurrentSession();
        startNewSession();
        showWelcomeState();
    });
    const search = document.getElementById('drawerChatSearch');
    if (search) search.addEventListener('input', () => renderSidebarHistory(allSessions));
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
        // Sync dev toggle if visible
        const toggle = document.getElementById('devProviderToggle');
        if (toggle) toggle.checked = d.provider === 'openai';
        const status = document.getElementById('devProviderStatus');
        if (status) status.textContent = `Active: ${d.name}`;
    } catch { }
}

function setupDevOptions() {
    // Enable dev mode by visiting the app with ?devmode=1 in the URL
    if (new URLSearchParams(location.search).get('devmode') === '1') {
        localStorage.setItem('glowguide_devmode', 'true');
    }
    const isDevMode = localStorage.getItem('glowguide_devmode') === 'true';
    const card = document.getElementById('devOptionsCard');
    if (card && isDevMode) card.style.display = '';

    const toggle = document.getElementById('devProviderToggle');
    if (!toggle) return;
    toggle.addEventListener('change', async () => {
        const provider = toggle.checked ? 'openai' : 'anthropic';
        try {
            const r = await fetch('/api/provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider })
            });
            const d = await r.json();
            const status = document.getElementById('devProviderStatus');
            if (status) status.textContent = `Switched to: ${d.name}`;
            const el = document.getElementById('drawerProviderText');
            if (el) el.textContent = d.name;
        } catch {
            toggle.checked = !toggle.checked; // revert on error
        }
    });
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
        if (el) el.onclick = () => { openDrawer(); startConsultationFlow(); };
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

function cleanConsultNotes(raw) {
    return raw
        .replace(/\[ROUTINE\][\s\S]*/gi, '')         // strip [ROUTINE] to end (no close tag)
        .replace(/\[CHAT\]/gi, '').replace(/\[\/CHAT\]/gi, '')
        .replace(/^(SUMMARY|MORNING|EVENING|AFTERNOON):\s*/gim, '') // strip section labels
        .replace(/^\s*\d+\.\s+\S+\s*\|.*$/gm, '')   // strip "1. Step | Ing | Reason" lines
        .replace(/^[-*]\s+/gm, '')                   // strip bullet prefixes
        .replace(/\*\*/g, '')                         // strip bold markers
        .replace(/\n{3,}/g, '\n\n')                  // collapse excess blanks
        .trim()
        .slice(0, 400);
}

function initProfile() {
    let p = LS.get('glowguide_profile');
    // One-time migration: clean stale notes that contain raw [ROUTINE] / structural labels
    if (p && p.notes && (/\[ROUTINE\]/i.test(p.notes) || /^(SUMMARY|MORNING|EVENING):/im.test(p.notes))) {
        p.notes = cleanConsultNotes(p.notes);
        LS.set('glowguide_profile', p);
    }
    const empty = document.getElementById('profilePageEmpty');
    const data = document.getElementById('profilePageData');
    if (p && p.skinType) {
        if (empty) empty.style.display = 'none';
        if (data) {
            data.style.display = 'block';
            document.getElementById('profileSkinTypeFull').textContent = p.skinType || '–';
            document.getElementById('profileConcernFull').textContent  = p.concern  || '–';
            document.getElementById('profileBudgetFull').textContent   = p.budget   || '–';

            // Format date nicely: "2026-03-12" → "March 12, 2026"
            const rawDate = p.lastConsult || p.analyzedAt || '';
            let niceDate = '–';
            if (rawDate) {
                const d = new Date(rawDate);
                if (!isNaN(d)) niceDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                else niceDate = rawDate; // fallback to raw if already formatted
            }
            document.getElementById('profileLastConsultFull').textContent = niceDate;

            // AI Summary — check p.summary first, then p.notes
            const notesEl = document.getElementById('profileNotesFull');
            if (notesEl) {
                const summaryText = (p.summary || p.notes || '').trim();
                if (summaryText) {
                    const lines = summaryText.split(/\n+/).filter(l => l.trim());

                    const analysis = [];
                    const skinType = [];
                    const texture = [];
                    const concerns = [];
                    const positive = [];

                    for (const raw of lines) {
                        const line = raw.trim();
                        const upper = line.toUpperCase();
                        if (upper.startsWith('[ANALYSIS]') || upper.startsWith('ANALYSIS:')) {
                            analysis.push(line.replace(/\[ANALYSIS\]\s*/i, '').replace(/^ANALYSIS:\s*/i, ''));
                        } else if (upper.startsWith('SKIN_TYPE') || upper.startsWith('SKIN TYPE')) {
                            skinType.push(line.replace(/^SKIN[_ ]TYPE:\s*/i, ''));
                        } else if (upper.startsWith('TEXTURE')) {
                            texture.push(line.replace(/^TEXTURE:\s*/i, ''));
                        } else if (upper.startsWith('CONCERNS')) {
                            concerns.push(line.replace(/^CONCERNS:\s*/i, ''));
                        } else if (upper.startsWith('POSITIVE')) {
                            positive.push(line.replace(/^POSITIVE:?\s*/i, ''));
                        } else {
                            analysis.push(line);
                        }
                    }

                    const makeSection = (label, emoji, items) => {
                        if (!items.length) return '';
                        const body = items.map(t => `<li>${escapeHtml(t)}</li>`).join('');
                        return `<div class="profile-summary-section">
                            <div class="profile-summary-section-header">
                                <span class="profile-summary-section-icon">${emoji}</span>
                                <span class="profile-summary-section-title">${label}</span>
                            </div>
                            <ul class="profile-summary-list">${body}</ul>
                        </div>`;
                    };

                    notesEl.innerHTML = [
                        makeSection('Overall analysis', '\ud83d	dd0e', analysis),
                        makeSection('Skin type', '\ud83d	dc44', skinType),
                        makeSection('Texture', '\ud83d	dd2c', texture),
                        makeSection('Key concerns', '\ud83d	dc9a', concerns),
                        makeSection('Positives', '\u2728', positive)
                    ].join('');
                } else {
                    notesEl.innerHTML = `<p style="color:#AAAAAA;font-style:italic;font-size:13px;">Complete a consultation to see your skin summary here.</p>`;
                }
            }

            // Extra profile fields
            renderExtraProfileFields(p);
        }
    }
    ['profileBeginBtn', 'profileUpdateBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => openDrawer("Let's start my skin consultation");
    });
}

function renderExtraProfileFields(p) {
    // Sensitivity
    const sensEl = document.getElementById('profileSensitivityFull');
    if (sensEl) sensEl.textContent = p.sensitivity || 'Not set';

    // Age range
    const ageEl = document.getElementById('profileAgeFull');
    if (ageEl) ageEl.textContent = p.age || 'Not set';

    // Experience level — derived from sensitivity answer
    const expEl = document.getElementById('profileExperienceFull');
    if (expEl) {
        const sens = (p.sensitivity || '').toLowerCase();
        let level = 'Not set';
        if (sens.includes('not sensitive')) level = 'Advanced';
        else if (sens.includes('mildly')) level = 'Intermediate';
        else if (sens.includes('very sensitive')) level = 'Beginner';
        else if (p.skinType) level = 'Intermediate'; // has profile but no sensitivity
        expEl.textContent = level;
    }

    // Routine saved
    const routineEl = document.getElementById('profileRoutineFull');
    if (routineEl) {
        const savedRoutine = LS.get('glowguide_routine');
        const hasRoutine = savedRoutine && ((savedRoutine.morning?.length || 0) + (savedRoutine.evening?.length || 0) > 0);
        if (hasRoutine) {
            routineEl.innerHTML = `Yes &nbsp;<a href="#" onclick="navigate('page-routines');return false;" style="color:#C9A84C;font-size:12px;font-weight:600;">View →</a>`;
        } else {
            routineEl.textContent = 'None saved';
        }
    }

    // Skin concerns as tags (all concerns from analysis)
    const tagsRow = document.getElementById('profileConcernTagsRow');
    if (tagsRow) {
        const analysisConcerns = Array.isArray(p.concerns) ? p.concerns : [];
        if (analysisConcerns.length > 0) {
            const tags = analysisConcerns.map(c => {
                const name = typeof c === 'string' ? c : c.name;
                const sev  = typeof c === 'object' ? c.severity : '';
                const sevColor = sev === 'severe' ? '#C0392B' : sev === 'moderate' ? '#E67E22' : '#2A7A4F';
                return `<span style="background:rgba(28,56,41,0.07);color:${sevColor};border:1px solid ${sevColor}33;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;display:inline-block;margin:3px;">${escapeHtml(name)}${sev ? ` <span style="opacity:0.6;font-size:10px;">(${sev})</span>` : ''}</span>`;
            }).join('');
            tagsRow.innerHTML = `
                <div class="home-card full-width-card" style="padding:16px 20px;">
                    <div style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Detected Skin Concerns</div>
                    <div>${tags}</div>
                </div>`;
            tagsRow.style.display = 'block';
        } else {
            tagsRow.style.display = 'none';
        }
    }
}

function initWater() {
    renderWaterPage();

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

    document.getElementById('addCustomBtn')?.addEventListener('click', () => {
        const amt = parseInt(prompt('Enter amount in ml (e.g. 500):'), 10);
        if (amt && amt > 0 && amt < 2000) addWater(amt);
    });

    const toggle = document.getElementById('reminderToggle');
    const slots = document.getElementById('reminderTimeSlots');
    const hint = document.querySelector('.reminder-hint');
    const savedReminders = LS.get('glowguide_water_reminders', { enabled: false, times: ['08:00', '10:30', '13:00', '16:00', '19:00'] });

    if (toggle && savedReminders.enabled) {
        toggle.checked = true;
        if (slots) slots.style.display = 'flex';
        if (hint) hint.style.display = 'none';
    }

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

    document.querySelectorAll('.remove-time-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.time-slot').remove());
    });

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

    if (savedReminders.enabled && savedReminders.times.length) startReminderInterval();

    renderWeeklyChart();
}

async function addGlass() {
    if (glassUpdateInProgress) return;
    glassUpdateInProgress = true;
    try {
        await addWater(250);
    } finally {
        setTimeout(() => { glassUpdateInProgress = false; }, 400);
    }
}

async function resetToday() {
    if (!confirm("Are you sure you want to reset today's water count?")) return;
    const todayKey = today();
    LS.del('glowguide_water_' + todayKey);
    if (_db && currentUser) {
        await _db.collection('users').doc(currentUser.uid)
            .collection('waterLogs').doc(todayKey).delete().catch(() => {});
    }
    renderWaterPage();
    if (typeof renderHomeWaterRing === 'function') renderHomeWaterRing();
    alert("Today's count has been reset.");
}

function addWater(amount) {
    const key = 'glowguide_water_' + today();
    const entries = LS.get(key, []);
    entries.push({ amount, time: timeStr() });
    LS.set(key, entries);
    saveWaterLogToFirestore(entries);
    renderWaterPage();
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

    const gi = document.getElementById('glassIcons');
    if (gi) {
        gi.innerHTML = Array.from({ length: Math.max(tGlasses, dGlasses) }, (_, i) =>
            `<div class="glass-icon${i < dGlasses ? ' filled' : ''}" data-index="${i}" title="Glass ${i + 1}"></div>`
        ).join('');
    }

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
// ══════════════════════════════════════════════
// ROUTINES LOGIC
// ══════════════════════════════════════════════

function initRoutines() {
    const routine = LS.get('glowguide_routine');
    const empty = document.getElementById('routinesEmpty');
    const data = document.getElementById('routinesData');
    const progressSection = document.getElementById('routineProgressSection');
    const lastUpdated = document.getElementById('routinesLastUpdated');

    if (!routine) {
        if (empty) empty.style.display = 'block';
        if (data) data.style.display = 'none';
        if (progressSection) progressSection.style.display = 'none';
        if (lastUpdated) lastUpdated.textContent = 'Last updated: --';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (data) data.style.display = 'block';
    if (progressSection) progressSection.style.display = 'block';

    // Show last updated days ago
    if (lastUpdated && routine.savedAt) {
        const saved = new Date(routine.savedAt);
        const now = new Date();
        const diff = Math.floor((now - saved) / (1000 * 60 * 60 * 24));
        lastUpdated.textContent = `Last updated: ${diff === 0 ? 'Today' : diff + ' day' + (diff > 1 ? 's' : '') + ' ago'}`;
    }

    renderRoutinesPage(routine);
}

function extractAndSaveRoutine(text) {
    if (!text.includes('[ROUTINE]')) return;
    
    const content = text.match(/\[ROUTINE\]([\s\S]*?)\[\/ROUTINE\]/)?.[1];
    if (!content) return;

    const routine = {
        summary: '',
        morning: [],
        evening: [],
        wellness: '',
        supplements: [],
        disclaimer: '',
        savedAt: today()
    };

    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    let currentSection = null;

    lines.forEach(line => {
        const upper = line.toUpperCase();
        if (upper.startsWith('SUMMARY:')) {
            routine.summary = line.replace(/SUMMARY:\s*/i, '').trim();
            currentSection = 'SUMMARY';
        } else if (upper.startsWith('MORNING:')) {
            currentSection = 'MORNING';
        } else if (upper.startsWith('EVENING:')) {
            currentSection = 'EVENING';
        } else if (upper.startsWith('WELLNESS:')) {
            routine.wellness = line.replace(/WELLNESS:\s*/i, '').trim();
            currentSection = 'WELLNESS';
        } else if (upper.startsWith('SUPPLEMENTS:')) {
            currentSection = 'SUPPLEMENTS';
        } else if (upper.startsWith('DISCLAIMER:')) {
            routine.disclaimer = line.replace(/DISCLAIMER:\s*/i, '').trim();
            currentSection = 'DISCLAIMER';
        } else if (upper.startsWith('INTERACTIONS:')) {
            routine.interactions = line.replace(/INTERACTIONS:\s*/i, '').trim();
            currentSection = 'INTERACTIONS';
        } else if (upper.startsWith('TIMELINE:')) {
            routine.timeline = line.replace(/TIMELINE:\s*/i, '').trim();
            currentSection = 'TIMELINE';
        } else if (upper.startsWith('DERMATOLOGIST:')) {
            routine.dermatologist = line.replace(/DERMATOLOGIST:\s*/i, '').trim();
            currentSection = 'DERMATOLOGIST';
        } else if (line.startsWith('-') || /^\d+\./.test(line)) {
            // Handle both "- StepType | Ingredient | Reason" and "1. StepType | Ingredient | Reason"
            const clean = line.replace(/^[-•]\s*|^\d+\.\s*/, '').trim();
            if (currentSection === 'MORNING') {
                // 3-field: StepType | Ingredient | Reason  (new prompt format)
                // 4-field: StepName | Type | Ingredient | Reason  (old format)
                const parts = clean.split('|').map(p => p.trim());
                if (parts.length >= 3) {
                    routine.morning.push({
                        step:       parts[0] || '',
                        type:       parts.length >= 4 ? parts[1] : parts[0],
                        ingredient: parts.length >= 4 ? parts[2] : parts[1],
                        reason:     parts.length >= 4 ? (parts[3] || '') : (parts[2] || '')
                    });
                } else if (parts.length === 2) {
                    routine.morning.push({ step: parts[0], type: parts[0], ingredient: parts[1], reason: '' });
                } else if (clean.length > 2) {
                    routine.morning.push({ step: clean, type: clean, ingredient: '', reason: '' });
                }
            } else if (currentSection === 'EVENING') {
                const parts = clean.split('|').map(p => p.trim());
                if (parts.length >= 3) {
                    routine.evening.push({
                        step:       parts[0] || '',
                        type:       parts.length >= 4 ? parts[1] : parts[0],
                        ingredient: parts.length >= 4 ? parts[2] : parts[1],
                        reason:     parts.length >= 4 ? (parts[3] || '') : (parts[2] || '')
                    });
                } else if (parts.length === 2) {
                    routine.evening.push({ step: parts[0], type: parts[0], ingredient: parts[1], reason: '' });
                } else if (clean.length > 2) {
                    routine.evening.push({ step: clean, type: clean, ingredient: '', reason: '' });
                }
            } else if (currentSection === 'SUPPLEMENTS') {
                const parts = clean.split('|').map(p => p.trim());
                routine.supplements.push({ name: parts[0], reason: parts[1] || '' });
            } else if (currentSection === 'INTERACTIONS') {
                routine.interactions = (routine.interactions ? routine.interactions + ' • ' : '') + clean;
            } else if (currentSection === 'TIMELINE') {
                routine.timeline = (routine.timeline ? routine.timeline + ' | ' : '') + clean;
            }
        } else if (currentSection === 'WELLNESS' && !routine.wellness) {
            routine.wellness = line;
        }
    });

    LS.set('glowguide_routine', routine);
    saveRoutineToFirestore(routine);
    
    // Refresh UI if visible
    if (document.getElementById('page-routines')?.classList.contains('active')) {
        initRoutines();
    }
}

function renderRoutinesPage(routine) {
    const morningContainer = document.getElementById('morningSteps');
    const eveningContainer = document.getElementById('eveningSteps');
    const wellnessContainer = document.getElementById('routineWellnessContent');
    const supplementsContainer = document.getElementById('routineSupplementsContent');
    const disclaimerEl = document.getElementById('routineDisclaimer');
    const mCount = document.getElementById('morningStepCount');
    const eCount = document.getElementById('eveningStepCount');
    const wellnessCard = document.getElementById('wellnessCard');
    const supplementsCard = document.getElementById('supplementsCard');
    const supplementDisclaimer = document.getElementById('supplementDisclaimer');
    // Step badge
    if (mCount) mCount.textContent = `${routine.morning.length} steps`;
    if (eCount) eCount.textContent = `${routine.evening.length} steps`;

    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });

    // Render morning steps
    if (morningContainer) {
        morningContainer.innerHTML = routine.morning.map((item, i) => {
            const isDone = (done.morning || [])[i];
            let stepName, stepIng, stepWhy;
            if (typeof item === 'string') {
                const parts = item.split('|').map(p => p.trim());
                stepName = parts[0] || item; stepIng = parts[1] || ''; stepWhy = parts[2] || '';
            } else {
                stepName = item.step || item.stepName || item.type || '';
                stepIng  = item.ingredient || '';
                stepWhy  = item.reason || item.why || '';
            }
            return `
                <div class="routine-step-row${isDone ? ' completed' : ''}" onclick="toggleRoutineStep('morning', ${i})" style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;">
                    <div style="width:24px;height:24px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-top:1px;${isDone ? 'background:#1C3829;color:#C9A84C;' : 'border:2px solid #C9A84C;color:transparent;'}">
                        ${isDone ? '✓' : ''}
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;color:#1C3829;text-transform:uppercase;letter-spacing:0.5px;${isDone ? 'text-decoration:line-through;opacity:0.45;' : ''}">${stepName}</span>
                            <span style="font-size:10px;font-weight:700;color:#B07D1A;background:rgba(255,243,205,0.9);border:1px solid rgba(201,168,76,0.35);border-radius:4px;padding:1px 6px;letter-spacing:0.8px;">AM</span>
                        </div>
                        ${stepIng ? `<div style="margin-top:6px;"><span style="background:rgba(201,168,76,0.13);color:#7A5C00;border:1px solid rgba(201,168,76,0.35);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;display:inline-block;">${stepIng}</span></div>` : ''}
                        ${stepWhy ? `<div style="font-size:12px;color:#8A8070;margin-top:5px;line-height:1.45;">${stepWhy}</div>` : ''}
                    </div>
                </div>
                ${i < routine.morning.length-1 ? '<hr style="border:none;border-top:1px solid #F0E9DC;margin:0;">' : ''}
            `;
        }).join('');
    }

    // Render evening steps
    if (eveningContainer) {
        eveningContainer.innerHTML = routine.evening.map((item, i) => {
            const isDone = (done.evening || [])[i];
            let stepName, stepIng, stepWhy;
            if (typeof item === 'string') {
                const parts = item.split('|').map(p => p.trim());
                stepName = parts[0] || item; stepIng = parts[1] || ''; stepWhy = parts[2] || '';
            } else {
                stepName = item.step || item.stepName || item.type || '';
                stepIng  = item.ingredient || '';
                stepWhy  = item.reason || item.why || '';
            }
            return `
                <div class="routine-step-row${isDone ? ' completed' : ''}" onclick="toggleRoutineStep('evening', ${i})" style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;">
                    <div style="width:24px;height:24px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-top:1px;${isDone ? 'background:#1C3829;color:#C9A84C;' : 'border:2px solid #8899CC;color:transparent;'}">
                        ${isDone ? '✓' : ''}
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;color:#1C3829;text-transform:uppercase;letter-spacing:0.5px;${isDone ? 'text-decoration:line-through;opacity:0.45;' : ''}">${stepName}</span>
                            <span style="font-size:10px;font-weight:700;color:#3D5A99;background:rgba(219,234,254,0.9);border:1px solid rgba(147,168,215,0.4);border-radius:4px;padding:1px 6px;letter-spacing:0.8px;">PM</span>
                        </div>
                        ${stepIng ? `<div style="margin-top:6px;"><span style="background:rgba(147,168,215,0.15);color:#2B4A8B;border:1px solid rgba(147,168,215,0.4);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;display:inline-block;">${stepIng}</span></div>` : ''}
                        ${stepWhy ? `<div style="font-size:12px;color:#8A8070;margin-top:5px;line-height:1.45;">${stepWhy}</div>` : ''}
                    </div>
                </div>
                ${i < routine.evening.length-1 ? '<hr style="border:none;border-top:1px solid #EEF0F8;margin:0;">' : ''}
            `;
        }).join('');
    }

    // Wellness card
    if (wellnessCard && routine.wellness && routine.wellness.length > 0) {
        wellnessCard.style.display = 'block';
        if (wellnessContainer) wellnessContainer.innerHTML = `<p>${routine.wellness}</p>`;
    } else if (wellnessCard) {
        wellnessCard.style.display = 'none';
    }

    // Supplements card
    if (supplementsCard && routine.supplements && routine.supplements.length > 0) {
        supplementsCard.style.display = 'block';
        if (supplementsContainer) {
            supplementsContainer.innerHTML = routine.supplements.map(s => `
                <div class="supplement-item" style="display:flex;align-items:center;margin-bottom:6px;">
                    <span style="width:10px;height:10px;background:#C9A84C;border-radius:50%;display:inline-block;margin-right:8px;"></span>
                    <span style="font-weight:600;">${s.name}</span>
                    <span style="margin-left:auto;color:#888;font-size:13px;">${s.reason}</span>
                </div>
            `).join('');
        }
        if (supplementDisclaimer) supplementDisclaimer.style.display = 'block';
    } else if (supplementsCard) {
        supplementsCard.style.display = 'none';
        if (supplementDisclaimer) supplementDisclaimer.style.display = 'none';
    }

    // Disclaimer
    if (disclaimerEl && routine.disclaimer) {
        disclaimerEl.textContent = routine.disclaimer;
    }

    // Interactions / Timeline / Products CTA sections
    const extrasAnchor = document.getElementById('routineExtras');
    if (extrasAnchor) {
        let extrasHtml = '';

        if (routine.interactions && String(routine.interactions).trim()) {
            extrasHtml += `
                <div style="background:rgba(254,243,199,0.7);border:1px solid rgba(201,168,76,0.35);border-radius:12px;padding:14px 16px;margin-top:16px;display:flex;gap:10px;align-items:flex-start;">
                    <span style="font-size:18px;flex-shrink:0;">⚠️</span>
                    <div>
                        <div style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:13px;color:#92580A;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;">Ingredient Interactions</div>
                        <div style="font-size:13px;color:#6B4A10;line-height:1.5;">${routine.interactions}</div>
                    </div>
                </div>`;
        }

        if (routine.timeline && String(routine.timeline).trim()) {
            extrasHtml += `
                <div style="background:rgba(220,252,231,0.7);border:1px solid rgba(74,160,100,0.3);border-radius:12px;padding:14px 16px;margin-top:12px;display:flex;gap:10px;align-items:flex-start;">
                    <span style="font-size:18px;flex-shrink:0;">📅</span>
                    <div>
                        <div style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:13px;color:#1A6637;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;">Expected Timeline</div>
                        <div style="font-size:13px;color:#1A5C35;line-height:1.5;">${routine.timeline}</div>
                    </div>
                </div>`;
        }

        extrasHtml += `
            <button onclick="navigate('page-products')" style="width:100%;margin-top:16px;background:linear-gradient(135deg,#1C3829,#2A5040);color:#C9A84C;border:none;border-radius:12px;padding:14px;font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;cursor:pointer;letter-spacing:0.3px;display:flex;align-items:center;justify-content:center;gap:8px;">
                <span>View Recommended Products</span>
                <span style="font-size:16px;">→</span>
            </button>`;

        extrasAnchor.innerHTML = extrasHtml;
    }

    updateRoutineProgress();
    updateRoutineMotivation();
}

function toggleRoutineStep(time, idx) {
    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });
    if (!done[time]) done[time] = [];
    done[time][idx] = !done[time][idx];
    LS.set('glowguide_routine_done_' + today(), done);
    
    // Refresh the page data
    const routine = LS.get('glowguide_routine');
    if (routine) renderRoutinesPage(routine);
}

function updateRoutineProgress() {
    const routine = LS.get('glowguide_routine', { morning: [], evening: [] });
    const done = LS.get('glowguide_routine_done_' + today(), { morning: [], evening: [] });
    const total = (routine.morning || []).length + (routine.evening || []).length;
    const doneCount = (done.morning || []).filter(Boolean).length + (done.evening || []).filter(Boolean).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const fill = document.getElementById('routineProgressFill');
    const percentLabel = document.getElementById('routineProgressPercent');
    if (fill) fill.style.width = pct + '%';
    if (percentLabel) percentLabel.textContent = pct + '%';
    // Save for motivation
    window._routineProgressPct = pct;
    window._routineProgressDone = doneCount;
    window._routineProgressTotal = total;
}

function updateRoutineMotivation() {
    const pct = window._routineProgressPct || 0;
    const done = window._routineProgressDone || 0;
    const total = window._routineProgressTotal || 0;
    const label = document.getElementById('routineProgressMotivation');
    if (!label) return;
    let msg = '';
    if (total === 0) msg = 'Start your routine for the day ✨';
    else if (pct === 0) msg = 'Start your routine for the day ✨';
    else if (pct < 50) msg = 'Good start, keep going 🌿';
    else if (pct < 100) msg = 'Almost done for today 💪';
    else msg = 'Routine complete! Amazing 🎉';
    label.textContent = `${msg} (${done} of ${total} steps)`;
}

// ══════════════════════════════════════════════
// PRODUCTS PAGE — Clinical Recommendation Engine UI
// Layers 1-4: Ingredients DB + Clinical Engine +
//             GPT-4o Personalization + Feedback Loop
// ══════════════════════════════════════════════

let _productsData = null;           // cached API response

function initProducts() {
    // Hook up empty-state CTAs
    const analyseBtn = document.getElementById('productsAnalyseCTA');
    const describeBtn = document.getElementById('productsDescribeCTA');
    if (analyseBtn) analyseBtn.onclick = () => openDrawer('📸 Analyse my skin — please ask me to upload a photo');
    if (describeBtn) describeBtn.onclick = () => openDrawer("Let's start my skin consultation — I'll describe my concerns");

    const profile = LS.get('glowguide_profile', null);
    if (!profile) {
        showProductsState('empty');
        return;
    }

    // Check 4-week check-in
    _checkCheckinDue();

    // Load recommendation (use cache if same profile)
    const cachedKey = 'gg_products_cache';
    const cachedProfile = LS.get('gg_products_profile', null);
    const cached = LS.get(cachedKey, null);
    const profileChanged = JSON.stringify(profile) !== JSON.stringify(cachedProfile);

    if (cached && !profileChanged) {
        _productsData = cached;
        showProductsState('main');
        _renderProductsUI(_productsData, profile);
    } else {
        showProductsState('loading');
        loadProductsForRoutine(profile);
    }
}

// Trigger full product loading for the current routine on page mount
function loadProductsForRoutine(profile) {
    if (!profile) return;
    _fetchRecommendation(profile);
}

function showProductsState(state) {
    const ids = ['productsEmptyState', 'productsLoadingState', 'productsMainContent'];
    const map = { empty: 0, loading: 1, main: 2 };
    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.style.display = i === map[state] ? '' : 'none';
    });
}

async function _fetchRecommendation(profile) {
    try {
        await ensureUserLocale();

        const loc = LS.get('glowguide_location', {});
        const body = {
            skinProfile: profile,
            budget: LS.get('glowguide_budget', 'medium'),
            country: loc.country || userCountry || 'USA',
            city: loc.city || userCity || '',
            checkinHistory: LS.get('gg_checkin_responses', []),
        };
        const res = await fetch('/api/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        _productsData = data;
        LS.set('gg_products_cache', data);
        LS.set('gg_products_profile', profile);
        showProductsState('main');
        _renderProductsUI(data, profile);
    } catch (err) {
        console.error('[Products] Fetch failed:', err);
        showProductsState('empty');
    }
}

function _renderProductsUI(data, profile) {
    const { recommendation, gptExplanation, gptTips, productsByStep } = data;

    // SCREEN 7: Urgent derm banner
    const dermBanner = document.getElementById('productsDermBanner');
    if (dermBanner) dermBanner.style.display = recommendation.overallSeverity > 0.7 ? 'flex' : 'none';

    // SCREEN 1: Hero
    _renderHero(recommendation);

    // SCREEN 2: Intro card
    _renderIntroCard(gptExplanation, gptTips, recommendation.interactions);

    // SCREEN 3+4: Routine tabs + steps
    _renderRoutineTabs(recommendation, productsByStep);

    // SCREEN 6: Avoid & Love
    _renderAvoidLove(recommendation);
}

// ── SCREEN 1: Hero ──────────────────────────────────────────────
function _renderHero(rec) {
    const skinTypeEl  = document.getElementById('productsSkinTypeVal');
    const severityFil = document.getElementById('productsSeverityFill');
    const condRow     = document.getElementById('productsConditionsRow');

    const skinTypeLabel = (rec.skinType || 'Normal').charAt(0).toUpperCase() + (rec.skinType || 'Normal').slice(1);
    if (skinTypeEl) skinTypeEl.textContent = skinTypeLabel;

    if (severityFil) {
        const pct = Math.round((rec.overallSeverity || 0.3) * 100);
        severityFil.style.width = pct + '%';
        const color = pct < 40 ? '#16A34A' : pct < 70 ? '#D97706' : '#DC2626';
        severityFil.style.background = color;
    }

    if (condRow) {
        const severityEmoji = { mild: '🟢', moderate: '🟡', severe: '🔴' };
        condRow.innerHTML = (rec.conditions || []).map(c => {
            const label = c.charAt(0).toUpperCase() + c.slice(1);
            const badge = severityEmoji[rec.severity] || '🟡';
            return `<span class="products-condition-chip">${badge} ${label} · ${rec.severity}</span>`;
        }).join('');
    }
}

// ── SCREEN 2: Intro Card ──────────────────────────────────────────
function _renderIntroCard(explanation, tips, interactions) {
    const textEl    = document.getElementById('productsGptText');
    const tipsRow   = document.getElementById('productsTipsRow');
    const warnEl    = document.getElementById('productsInteractionsWarn');
    const warnList  = document.getElementById('productsInteractionsList');

    if (textEl) textEl.textContent = explanation || '';

    if (tipsRow && tips) {
        tipsRow.innerHTML = tips.map(t =>
            `<span class="products-tip-chip">${t}</span>`
        ).join('');
    }

    if (warnEl && warnList && interactions && interactions.length > 0) {
        warnEl.style.display = '';
        warnList.innerHTML = interactions.map(w =>
            `<li><strong>${w.ingredient1}</strong> + <strong>${w.ingredient2}</strong> — ${w.fix}</li>`
        ).join('');
    }
}

// ── SCREEN 3+4: Tabs + Step Cards ──────────────────────────────
function _renderRoutineTabs(rec, productsByStep) {
    const morning = (rec?.routine?.morning) || [];
    const evening = (rec?.routine?.evening) || [];
    const pByStep = productsByStep || _productsData?.productsByStep || {};
    
    const container = document.getElementById('productsStepsContainer');
    if (!container) return;

    let html = '';
    
    if (morning.length > 0) {
        html += `<h2 class="products-section-header">☀️ Morning Protocol</h2>`;
        html += morning.map((step, i) => {
            const products = pByStep[`morning_${step.stepKey}`] || [];
            return _buildStepCard(step, i, 'morning', products);
        }).join('');
    }

    if (evening.length > 0) {
        html += `<h2 class="products-section-header" style="margin-top:40px">🌙 Evening Protocol</h2>`;
        html += evening.map((step, i) => {
            const products = pByStep[`evening_${step.stepKey}`] || [];
            return _buildStepCard(step, i, 'evening', products);
        }).join('');
    }

    container.innerHTML = html;
}

function _buildStepCard(step, index, time, products) {
    const timeEmoji = time === 'morning' ? '☀️ AM' : '🌙 PM';
    const claimsPreview = (step.approvedClaims || []).slice(0, 1).join('');
    const concentration = step.concentration || '';
    const ingShorten = (step.primaryIngredient || '').split('(')[0].trim();

    const productCards = (products || []).map(p => _buildProductMiniCard(p)).join('');

    return `<div class="products-step-card">
        <div class="products-step-header">
            <div class="products-step-num">${index + 1}</div>
            <div class="products-step-info">
                <div class="products-step-name">Step ${index + 1} · ${step.stepName}</div>
                ${ingShorten ? `<span class="products-step-ing-chip">Key: ${ingShorten}${concentration ? ' — ' + concentration.split('—')[0].trim() : ''}</span>` : ''}
            </div>
            <span class="products-step-time-badge">${timeEmoji}</span>
        </div>
        <div class="products-step-body">
            <div class="products-step-why-label">WHY THIS STEP</div>
            <p class="products-step-why-text">${claimsPreview || step.mechanism || 'Essential step in your protocol.'}</p>
            ${step.primaryIngredient ? `<button class="products-evidence-btn" onclick="openEvidenceModal('${encodeURIComponent(step.primaryIngredient)}')">📋 See Clinical Evidence</button>` : ''}
            <div class="products-step-divider"></div>
            <div class="products-step-products-label">RECOMMENDED PRODUCTS</div>
            <div class="products-products-scroll">
                ${productCards}
            </div>
        </div>
    </div>`;
}

function _brandColor(name) {
    const palette = ['#14532D', '#166534', '#064E3B', '#365314', '#92400E', '#1C3829'];
    const s = (name || 'X');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % palette.length;
    return palette[idx];
}

function _buildProductMiniCard(p) {
    const name   = (p.name || p.title || 'Product').substring(0, 60);
    const brand  = p.brand || p.source || '';
    const initial = (brand || name).charAt(0).toUpperCase();
    const link   = p.link || p.url || '#';
    const price  = p.price ? formatPrice(p.price, p.currency || 'USD') : null;
    const badge  = p.badge || null;
    const rating = p.rating ? Math.round(p.rating) : 0;
    const stars  = rating > 0 ? '\u2605'.repeat(Math.min(rating,5)) + '\u2606'.repeat(Math.max(0, 5-rating)) : '';
    const reviews = p.reviewCount ? p.reviewCount.toLocaleString() : null;
    const encodedProduct = encodeURIComponent(JSON.stringify({ name: p.name || name, brand: p.brand || brand, price: p.price, currency: p.currency, url: p.url || p.link }));

    const hasImage = !!p.image;
    const bgColor = _brandColor(brand || name);

    return `<div class="products-mini-card2">
        ${badge ? `<span class="pmc-badge">${badge}</span>` : ''}
        <div class="pmc-image" style="background:${bgColor};">
            ${hasImage ? `<img src="${p.image}" alt="${name}" class="pmc-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />` : ''}
            <div class="pmc-fallback-avatar" style="${hasImage ? 'display:none;' : 'display:flex;'}">
                <span class="pmc-initial">${initial}</span>
            </div>
        </div>
        ${brand ? `<div class="pmc-brand">${brand}</div>` : ''}
        <div class="pmc-name">${name}</div>
        ${p.keyIngredient ? `<span class="pmc-ing-chip">${p.keyIngredient}</span>` : ''}
        ${stars ? `<div class="pmc-rating"><span class="pmc-stars">${stars}</span><span class="pmc-rating-num">${p.rating}</span>${reviews ? `<span class="pmc-review-count">(${reviews})</span>` : ''}</div>` : ''}
        ${price ? `<div class="pmc-price">${price}</div>` : ''}
        <div class="pmc-btns">
            <a href="${link}" target="_blank" rel="noopener noreferrer" class="pmc-btn-view">View →</a>
            <button class="pmc-btn-buy" onclick="openBuyModal('${encodedProduct}')">&#128722; Buy</button>
        </div>
    </div>`;
}

// ── SCREEN 6: Avoid & Love Chips ────────────────────────────────
function _renderAvoidLove(rec) {
    const avoidEl = document.getElementById('productsAvoidChips');
    const loveEl  = document.getElementById('productsLoveChips');

    if (avoidEl) {
        avoidEl.innerHTML = (rec.avoidList || []).map(name =>
            `<span class="products-avoid-chip" title="Not suited to your current profile">${name}</span>`
        ).join('');
    }

    if (loveEl) {
        loveEl.innerHTML = (rec.goodList || []).slice(0, 12).map(name =>
            `<button class="products-love-chip" onclick="openEvidenceModal('${encodeURIComponent(name)}')">${name}</button>`
        ).join('');
    }
}

// ── SCREEN 5: Evidence Modal ─────────────────────────────────────
async function openEvidenceModal(encodedName) {
    const name = decodeURIComponent(encodedName);
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('evidenceModalContent');
    if (!modal || !content) return;

    modal.style.display = 'flex';
    content.innerHTML = '<div style="text-align:center;padding:24px;color:#9CA3AF">Loading evidence…</div>';

    try {
        const res = await fetch(`/api/ingredient/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error('Not found');
        const ing = await res.json();
        content.innerHTML = _buildEvidenceModalHTML(name, ing);
    } catch {
        content.innerHTML = `<div style="padding:24px"><h3 style="font-family:Cormorant Garamond,serif;font-size:24px">${name}</h3><p style="color:#9CA3AF;margin-top:8px">Clinical data not available for this ingredient.</p></div>`;
    }
}

function _buildEvidenceModalHTML(name, ing) {
    const studiesHtml = (ing.clinical_studies || []).map(s => {
        const badge = s.evidence_level === 'RCT' ? 'badge-rct'
                    : s.evidence_level?.includes('Systematic') ? 'badge-review'
                    : 'badge-trial';
        return `<div class="ev-study">
            <div class="ev-study-top">
                <span class="ev-study-authors">${s.authors} (${s.year})</span>
                <span class="ev-badge ${badge}">${s.evidence_level}</span>
            </div>
            <div class="ev-study-journal">${s.journal}</div>
            <p class="ev-study-finding">${s.finding}</p>
            ${s.n_patients ? `<span class="ev-n-badge">n = ${s.n_patients}</span>` : ''}
        </div>`;
    }).join('');

    const conditions = (ing.approved_claims || []).slice(0, 5).map(c =>
        `<li>${c}</li>`
    ).join('');

    return `
    <h2 class="ev-ing-name">${name}</h2>
    ${ing.cosing_ref ? `<p class="ev-inci">CosIng Ref: ${ing.cosing_ref}</p>` : ''}
    <div class="ev-badges-row">
        ${ing.eu_approved ? '<span class="ev-reg-badge ev-reg-green">✓ EU CosIng Approved</span>' : ''}
        ${ing.pubchem_cid ? `<span class="ev-reg-badge ev-reg-blue">NIH PubChem CID: ${ing.pubchem_cid}</span>` : ''}
        ${ing.incidecoder_score ? `<span class="ev-reg-badge ev-reg-gold">INCIDecoder: ${ing.incidecoder_score} ⭐</span>` : ''}
    </div>
    ${ing.eu_max_concentration ? `<p class="ev-eu-note">EU max approved: <strong>${ing.eu_max_concentration}</strong></p>` : ''}

    <div class="ev-section-label">How it works</div>
    <p class="ev-mechanism">${ing.mechanism || '—'}</p>

    <div class="ev-section-label">📚 Clinical Evidence</div>
    ${studiesHtml || '<p class="ev-no-studies">No clinical studies on file.</p>'}

    ${conditions ? `<div class="ev-claims-box"><strong>Approved claims for your skin:</strong><ul>${conditions}</ul></div>` : ''}
    ${ing.pregnancy_safe === true ? '<div class="ev-pregnancy-safe">✅ Pregnancy-safe ingredient</div>' : ''}
    ${(ing.contraindications || []).length > 0 ? `<div class="ev-contraindication">⚠️ Contraindications: ${ing.contraindications.join(', ')}</div>` : ''}`;
}

function closeEvidenceModal(e) {
    if (e && e.target !== document.getElementById('evidenceModal')) return;
    const modal = document.getElementById('evidenceModal');
    if (modal) modal.style.display = 'none';
}

// ── Buy Modal helpers & localization ─────────────────────────────
const CURRENCY_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    HUF: 370,
    AED: 3.67,
    CAD: 1.36,
    AUD: 1.53
};

const CURRENCY_SYMBOLS = {
    USD: '$',
    EUR: '\u20ac',
    GBP: '\u00a3',
    HUF: 'Ft',
    AED: 'AED',
    CAD: 'C$',
    AUD: 'A$'
};

function inferRegionFromCountryCode(code) {
    const cc = (code || '').toUpperCase();
    if (!cc) return 'US';
    if (['GB', 'UK'].includes(cc)) return 'UK';
    if (['US', 'CA', 'AU'].includes(cc)) return cc === 'US' ? 'US' : cc === 'CA' ? 'CA' : 'AU';
    if (cc === 'AE' || cc === 'SA' || cc === 'QA' || cc === 'KW') return 'GCC';
    // Simple EU bucket for everything else in Europe
    const euCodes = ['HU','DE','FR','ES','IT','NL','BE','AT','CH','SE','NO','DK','FI','PL','CZ','PT','GR','RO'];
    if (euCodes.includes(cc)) return 'EU';
    return 'US';
}

async function ensureUserLocale() {
    if (userLocale) return userLocale;

    // 1) Try skinProfile.location from localStorage
    try {
        const profile = LS.get('glowguide_profile', null);
        if (profile && profile.location) {
            const loc = profile.location;
            const countryCode = loc.countryCode || loc.country_code || loc.country || '';
            const currency = (loc.currency || '').toUpperCase();
            const region = inferRegionFromCountryCode(countryCode);
            const cur = currency || (region === 'EU' ? 'EUR' : region === 'UK' ? 'GBP' : 'USD');
            userLocale = {
                country: countryCode || 'US',
                currency: cur,
                currencySymbol: CURRENCY_SYMBOLS[cur] || '$',
                region
            };
            return userLocale;
        }
    } catch {}

    // 2) Fallback: IP-based lookup via ipapi.co
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
            const d = await res.json();
            const countryCode = d.country_code || d.country || 'US';
            const currency = (d.currency || 'USD').toUpperCase();
            const region = inferRegionFromCountryCode(countryCode);
            userLocale = {
                country: countryCode,
                currency,
                currencySymbol: d.currency_symbol || CURRENCY_SYMBOLS[currency] || '$',
                region
            };

            // Keep legacy location state in sync for other features
            if (!userCountry) userCountry = d.country_name || countryCode;
            if (!userCity) userCity = d.city || userCity;

            return userLocale;
        }
    } catch (e) {
        console.warn('[GlowGuide] ipapi.co locale detection failed:', e.message);
    }

    // 3) Final fallback based on existing userCountry/userCity
    const guessCode = (userCountry || '').toLowerCase().includes('hungary') ? 'HU'
        : (userCountry || '').toLowerCase().includes('united kingdom') ? 'GB'
        : (userCountry || '').toLowerCase().includes('united arab emirates') ? 'AE'
        : 'US';
    const region = inferRegionFromCountryCode(guessCode);
    const cur = region === 'EU' ? 'EUR' : region === 'UK' ? 'GBP' : region === 'GCC' ? 'AED' : 'USD';
    userLocale = {
        country: guessCode,
        currency: cur,
        currencySymbol: CURRENCY_SYMBOLS[cur] || '$',
        region
    };
    return userLocale;
}

function formatPrice(price, currency) {
    if (!price) return '';
    const locale = userLocale || { country: 'US', currency: 'USD', currencySymbol: '$', region: 'US' };
    const src = (currency || 'USD').toUpperCase();
    const target = (locale.currency || 'USD').toUpperCase();
    const srcRate = CURRENCY_RATES[src] || 1;
    const tgtRate = CURRENCY_RATES[target] || 1;
    const converted = (price / srcRate) * tgtRate;
    const symbol = locale.currencySymbol || CURRENCY_SYMBOLS[target] || '$';
    return symbol + converted.toFixed(0);
}

function buildGoogleShoppingLink(product) {
    const name = product.name || '';
    const brand = product.brand || '';
    const q = encodeURIComponent(`buy ${name} ${brand}`.trim());
    return `https://www.google.com/search?q=${q}&tbm=shop`;
}

function getBuyLinks(product) {
    const locale = userLocale || { country: 'US', currency: 'USD', currencySymbol: '$', region: 'US' };
    const region = locale.region || 'US';
    const q = encodeURIComponent(product.name || '');
    const isPremium = (product.priceRange || '').toLowerCase() === 'premium' || (product.priceRange || '').toLowerCase() === 'luxury';

    const links = [];

    if (region === 'EU' || locale.country === 'HU') {
        if (isPremium) {
            links.push({ retailer: 'Sephora', icon: '\ud83d\udda4', label: 'Sephora Hungary', url: `https://www.sephora.com/hu/en/search?keyword=${q}`, badge: 'Premium beauty' });
        } else {
            links.push({ retailer: 'Notino',   icon: '\ud83d\udce6', label: 'Notino.hu',   url: `https://www.notino.hu/search.asp?expr=${q}`, badge: 'Local shipping' });
            links.push({ retailer: 'Rossmann', icon: '\ud83d\udec2', label: 'Rossmann.hu', url: `https://shop.rossmann.hu/kereses?q=${q}`,     badge: 'Drugstore prices' });
            links.push({ retailer: 'dm',       icon: '\ud83d\udec1', label: 'dm.hu',       url: `https://www.dm.hu/search?query=${q}`,         badge: 'Everyday essentials' });
        }
    } else if (region === 'UK') {
        links.push({ retailer: 'LOOKFANTASTIC', icon: '\u2728', label: 'LookFantastic', url: `https://www.lookfantastic.com/search?q=${q}`, badge: 'Beauty specialist' });
        links.push({ retailer: 'Boots',         icon: '\ud83d\udec1', label: 'Boots',        url: `https://www.boots.com/search/${q}/all`,     badge: 'High street' });
    } else if (region === 'GCC') {
        links.push({ retailer: 'Noon',   icon: '\ud83d\uded2', label: 'noon.com',  url: `https://www.noon.com/uae-en/search/?q=${q}`,       badge: 'Local delivery' });
        links.push({ retailer: 'Namshi', icon: '\ud83d\udc5c', label: 'namshi.com', url: `https://en-ae.namshi.com/catalog/?q=${q}`,        badge: 'Beauty & fashion' });
    } else if (region === 'CA') {
        links.push({ retailer: 'Amazon', icon: '\ud83d\udce6', label: 'Amazon.ca', url: `https://www.amazon.ca/s?k=${q}`, badge: 'Fast delivery' });
    } else if (region === 'AU') {
        links.push({ retailer: 'Adore Beauty', icon: '\u2728', label: 'AdoreBeauty', url: `https://www.adorebeauty.com.au/search?q=${q}`, badge: 'AU beauty' });
    } else {
        // Default: US
        links.push({ retailer: 'Amazon', icon: '\ud83d\udce6', label: 'Amazon.com', url: `https://www.amazon.com/s?k=${q}`, badge: 'Fast delivery' });
    }

    if (product.url && product.url !== '#') {
        links.push({ retailer: 'Brand Direct', icon: '\ud83c\udff7\ufe0f', label: 'Buy from ' + (product.brand || 'Brand'), url: product.url, badge: 'Official store' });
    }

    // Always include a Google Shopping search as a final fallback
    links.push({ retailer: 'Google Shopping', icon: '\ud83d\udd0d', label: 'Compare prices', url: buildGoogleShoppingLink(product), badge: 'Multiple retailers' });

    return links;
}

let _buyModalProduct = null;
function openBuyModal(encodedProduct) {
    try {
        _buyModalProduct = typeof encodedProduct === 'string'
            ? JSON.parse(decodeURIComponent(encodedProduct))
            : encodedProduct;
    } catch { return; }
    const modal   = document.getElementById('buyModal');
    const content = document.getElementById('buyModalContent');
    if (!modal || !content) return;
    const p = _buyModalProduct;
    const links    = getBuyLinks(p);
    const priceStr = p.price ? formatPrice(p.price, p.currency || 'USD') : '';
    const brand    = p.brand || '';
    const name     = p.name  || 'Product';
    const initial  = (brand || name).charAt(0).toUpperCase();
    content.innerHTML = `
        <div class="buy-modal-header">
            <div class="buy-modal-product">
                <div class="buy-modal-avatar">${initial}</div>
                <div class="buy-modal-product-info">
                    ${brand ? `<div class="buy-modal-brand">${brand}</div>` : ''}
                    <div class="buy-modal-name">${name}</div>
                    ${priceStr ? `<div class="buy-modal-price">${priceStr}</div>` : ''}
                </div>
            </div>
            <button class="buy-modal-close" onclick="closeBuyModal()">&times;</button>
        </div>
        <div class="buy-modal-subtitle">Choose where to buy:</div>
        <div class="buy-modal-options">
            ${links.map(l=>`
                <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="buy-modal-option" onclick="closeBuyModal()">
                    <span class="buy-modal-icon">${l.icon}</span>
                    <div class="buy-modal-option-info">
                        <span class="buy-modal-retailer">${l.label}</span>
                        <span class="buy-modal-badge">${l.badge}</span>
                    </div>
                    <span class="buy-modal-arrow">&rarr;</span>
                </a>`).join('')}
        </div>
        <div class="buy-modal-affiliate-note">GlowGuide may earn a small commission on purchases at no extra cost to you &mdash; this funds our free AI features.</div>
    `;
    modal.style.display = 'flex';
}
function closeBuyModal() {
    const modal = document.getElementById('buyModal');
    if (modal) modal.style.display = 'none';
    _buyModalProduct = null;
}

// ── SCREEN 8: 4-Week Check-in ────────────────────────────────────
const CHECKIN_KEYS = {
    savedAt:   'gg_routine_saved_at',
    responses: 'gg_checkin_responses',
    dismissed: 'gg_checkin_dismissed_until',
};

function _checkCheckinDue() {
    const savedAt = LS.get(CHECKIN_KEYS.savedAt, null);
    if (!savedAt) return;
    const dismissedUntil = LS.get(CHECKIN_KEYS.dismissed, null);
    if (dismissedUntil && new Date(dismissedUntil) > new Date()) return;
    const daysIn = Math.floor((Date.now() - new Date(savedAt).getTime()) / 86400000);
    if (daysIn >= 28) {
        setTimeout(() => {
            const banner = document.getElementById('checkinBanner');
            if (banner) banner.style.display = 'flex';
        }, 1500);
    }
}

async function submitCheckin(response) {
    const banner = document.getElementById('checkinBanner');
    if (banner) banner.style.display = 'none';

    // Save to local history
    const history = LS.get(CHECKIN_KEYS.responses, []);
    history.push({ response, date: new Date().toISOString() });
    LS.set(CHECKIN_KEYS.responses, history);

    try {
        const profile = LS.get('glowguide_profile', {});
        const res = await fetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response, skinProfile: profile, checkinHistory: history }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.newExperience && profile) {
            profile.experience = data.newExperience;
            LS.set('glowguide_profile', profile);
        }
        if (data.advice) {
            _showCheckinAdvice(data.advice);
        }
        // Invalidate cache so next page load rebuilds
        LS.set('gg_products_cache', null);
    } catch (err) {
        console.error('[Checkin]', err);
    }
}

function _showCheckinAdvice(advice) {
    if (!advice) return;
    const colors = { success: '#F0FDF4', info: '#EFF6FF', warning: '#FFFBEB', danger: '#FFF5F5' };
    const borders = { success: '#86EFAC', info: '#93C5FD', warning: '#FCD34D', danger: '#FCA5A5' };
    const banner = document.getElementById('checkinBanner');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.innerHTML = `<div class="checkin-inner" style="background:${colors[advice.type]||'#FAF7F2'};border:1px solid ${borders[advice.type]||'#E5DDD4'};border-radius:20px;padding:24px 32px;max-width:600px;margin:0 auto">
        <h3 style="font-family:Cormorant Garamond,serif;font-size:20px;color:#1C3829;margin-bottom:8px">${advice.headline}</h3>
        <p style="font-size:14px;color:#374151;line-height:1.7">${advice.detail}</p>
        <button onclick="document.getElementById('checkinBanner').style.display='none'" style="margin-top:16px;background:transparent;border:none;color:#9CA3AF;font-size:13px;cursor:pointer">Dismiss</button>
    </div>`;
}

function dismissCheckin() {
    const banner = document.getElementById('checkinBanner');
    if (banner) banner.style.display = 'none';
    // Snooze for 7 days
    const snoozeDate = new Date(Date.now() + 7 * 86400000).toISOString();
    LS.set(CHECKIN_KEYS.dismissed, snoozeDate);
}

// Called when routine is saved (to start the 28-day clock)
function markRoutineSaved() {
    if (!LS.get(CHECKIN_KEYS.savedAt, null)) {
        LS.set(CHECKIN_KEYS.savedAt, new Date().toISOString());
    }
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
let allClinics   = [];
let allHospitals = [];
let allOnline    = [];
let dermSearchInProgress = false;
let dermSearchDone       = false;   // prevents re-fire on every render
let activeDermTab    = 'clinics';
let activeDermFilter = 'all';

// Helper: rough check if a clinic is open now based on OSM opening_hours string
function isClinicOpenNow(hoursStr) {
    if (!hoursStr || typeof hoursStr !== 'string') return false;
    // Simple heuristic: if the current day abbreviation appears and current time is in range
    try {
        const now = new Date();
        const day = ['Su','Mo','Tu','We','Th','Fr','Sa'][now.getDay()];
        const hhmm = now.getHours() * 100 + now.getMinutes();
        // e.g. "Mo-Fr 08:00-18:00; Sa 09:00-13:00"
        const parts = hoursStr.split(';').map(s => s.trim());
        for (const part of parts) {
            if (!part.includes(day) && !part.match(/Mo-Fr|Mo-Sa|Mo-Su/)) continue;
            const timeMatch = part.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
            if (timeMatch) {
                const open  = parseInt(timeMatch[1]) * 100 + parseInt(timeMatch[2]);
                const close = parseInt(timeMatch[3]) * 100 + parseInt(timeMatch[4]);
                if (hhmm >= open && hhmm <= close) return true;
            }
        }
    } catch(e) {}
    return false;
}

async function initDerm() {
    const container = document.getElementById('dermResultsContainer');
    if (!container) return;

    // Prevent duplicate fetches on repeated renders — skip if already loaded
    if (dermSearchDone && (allClinics.length || allHospitals.length || allOnline.length)) {
        setupDermTabs();
        setupDermFilters();
        setupDermSearch();
        renderDermTab();
        return;
    }

    showDermSkeletons(container);
    setupDermTabs();
    setupDermFilters();
    setupDermSearch();

    const loc = LS.get('glowguide_location', { city: '', country: '', lat: 0, lng: 0 });
    const locText = document.getElementById('dermLocationText');
    if (locText) locText.textContent = (loc.city ? loc.city + (loc.country ? `, ${loc.country}` : '') : 'Your area');

    await fetchDermResults(loc);
    dermSearchDone = true;
}

function showDermSkeletons(container) {
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
}

function switchToOnlineTab() {
    document.querySelectorAll('.derm-tab').forEach(t => t.classList.remove('active'));
    const onlineEl = document.querySelector('.derm-tab[data-tab="online"]');
    if (onlineEl) onlineEl.classList.add('active');
    activeDermTab = 'online';
    activeDermFilter = 'all';
    const filterBar = document.getElementById('dermFilterBar');
    if (filterBar) filterBar.style.display = 'none';
    renderDermTab();
}

function setupDermTabs() {
    document.querySelectorAll('.derm-tab').forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
        newTab.addEventListener('click', () => {
            const clickedTab = newTab.dataset.tab;
            document.querySelectorAll('.derm-tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');
            activeDermTab    = clickedTab;
            activeDermFilter = 'all';
            document.querySelectorAll('.derm-filter-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
            const filterBar = document.getElementById('dermFilterBar');
            if (filterBar) filterBar.style.display = activeDermTab === 'online' ? 'none' : 'flex';
            renderDermTab();
        });
    });
}

function setupDermFilters() {
    document.querySelectorAll('.derm-filter-pill').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            document.querySelectorAll('.derm-filter-pill').forEach(b => b.classList.remove('active'));
            newBtn.classList.add('active');
            activeDermFilter = newBtn.dataset.filter;
            renderDermTab();
        });
    });
}

function setupDermSearch() {
    const searchBtn   = document.getElementById('dermSearchBtn');
    const searchInput = document.getElementById('dermSearchInput');
    const changeBtn   = document.getElementById('changeDermLocationBtn');

    const doSearch = async () => {
        const query = searchInput?.value.trim();
        if (!query) return;
        dermSearchDone = false;  // allow fresh search for new location
        const container = document.getElementById('dermResultsContainer');
        showDermSkeletons(container);
        await fetchDermResults({ locationQuery: query });
        dermSearchDone = true;
        const locText = document.getElementById('dermLocationText');
        if (locText) locText.textContent = query;
    };

    if (searchBtn)   searchBtn.onclick = doSearch;
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    if (changeBtn) {
        changeBtn.onclick = () => {
            const newCity = prompt("Enter a city name (e.g. 'London', 'New York', 'Dubai'):");
            if (newCity?.trim()) {
                if (searchInput) searchInput.value = newCity.trim();
                doSearch();
            }
        };
    }
}

async function fetchDermResults(loc) {
    if (dermSearchInProgress) {
        console.log('[GlowGuide] Derm search already in progress — skipping duplicate call');
        return;
    }
    dermSearchInProgress = true;
    // Reset stale data so tab counts show loading state (0) while waiting
    allClinics = []; allHospitals = []; allOnline = [];
    updateDermTabCounts();
    const container = document.getElementById('dermResultsContainer');
    try {
        const response = await fetch('/api/dermatologists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loc)
        });
        const data = await response.json();
        allClinics   = data.clinics   || [];
        allHospitals = data.hospitals || [];
        allOnline    = data.online    || [];

        // Show error note if present
        if (data.error) {
            console.warn('[GlowGuide] Derm search note:', data.error);
        }

        updateDermTabCounts();
        setupBookingModalHandlers();

        // If no local results, default to the Online tab so page is never empty
        const hasLocal = allClinics.length > 0 || allHospitals.length > 0;
        activeDermTab    = hasLocal ? 'clinics' : 'online';
        activeDermFilter = 'all';
        document.querySelectorAll('.derm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeDermTab));
        document.querySelectorAll('.derm-filter-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
        const filterBar = document.getElementById('dermFilterBar');
        if (filterBar) filterBar.style.display = hasLocal ? 'flex' : 'none';

        renderDermTab();
    } catch (err) {
        console.error('[GlowGuide] Derm fetch failed', err);
        // Always show online consultants even on network failure
        if (allOnline.length > 0) {
            activeDermTab = 'online';
            document.querySelectorAll('.derm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'online'));
            renderDermTab();
        } else {
            container.innerHTML = `<div class="page-empty-state"><div class="empty-illustration">⚠️</div><h3>Could not load results</h3><p>${escapeHtml(err.message)}</p></div>`;
        }
    } finally {
        dermSearchInProgress = false;
    }
}

function updateDermTabCounts() {
    const c = document.getElementById('tabCountClinics');
    const o = document.getElementById('tabCountOnline');
    const h = document.getElementById('tabCountHospitals');
    if (c) {
        c.textContent = allClinics.length ? `(${allClinics.length})` : '';
        const ct = c.closest('.derm-tab');
        if (ct) { ct.style.opacity = allClinics.length ? '' : '0.4'; ct.style.cursor = allClinics.length ? '' : 'default'; }
    }
    if (o) o.textContent = allOnline.length ? `(${allOnline.length})` : '';
    if (h) {
        h.textContent = allHospitals.length ? `(${allHospitals.length})` : '';
        const ht = h.closest('.derm-tab');
        if (ht) { ht.style.opacity = allHospitals.length ? '' : '0.4'; ht.style.cursor = allHospitals.length ? '' : 'default'; }
    }
}

function renderDermTab() {
    if (activeDermTab === 'online') {
        renderOnlineConsultants();
    } else {
        renderDermDocs(activeDermTab === 'clinics' ? allClinics : allHospitals, activeDermFilter);
    }
}

function renderOnlineConsultants() {
    const container = document.getElementById('dermResultsContainer');
    if (!container) return;
    if (!allOnline.length) {
        container.innerHTML = `<div class="page-empty-state" style="grid-column:1/-1;"><div class="empty-illustration">💻</div><h3>No online consultants available</h3><p>Try again later.</p></div>`;
        return;
    }
    container.innerHTML = allOnline.map(d => {
        const chips = (d.specialties || []).map(s => `<span class="derm-specialty-chip">${escapeHtml(s)}</span>`).join('');
        const stars = '★'.repeat(Math.floor(d.rating || 0)) + '☆'.repeat(5 - Math.floor(d.rating || 0));
        return `
            <div class="derm-card derm-card-online">
                <div class="derm-card-top">
                    <div class="derm-card-photo derm-online-initial">${escapeHtml(d.name.charAt(0))}</div>
                    <div class="derm-card-info">
                        <div class="derm-tag" style="background:rgba(79,124,99,0.15); color:#4f7c63;">Online Platform</div>
                        <h3 class="derm-doctor-name">${escapeHtml(d.name)}</h3>
                        <div class="derm-rating">
                            <span class="derm-stars">${stars}</span>
                            <span>${(d.rating || 0).toFixed(1)}</span>
                            <span class="derm-review-count">(${(d.reviewCount || 0).toLocaleString()} reviews)</span>
                        </div>
                        <p style="font-size:13px; color:var(--text-muted); margin-top:4px;">${escapeHtml(d.description || '')}</p>
                    </div>
                </div>
                <div class="derm-online-meta" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                    <span class="derm-response-badge" style="background:rgba(79,124,99,0.15); color:#4f7c63; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;">⚡ ${escapeHtml(d.responseTime || 'Fast')}</span>
                    <span class="derm-price-badge" style="background:rgba(201,168,76,0.12); color:var(--gold); padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;">💰 ${escapeHtml(d.priceRange || 'See website')}</span>
                </div>
                ${chips ? `<div class="derm-specialty-chips" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">${chips}</div>` : ''}
                <div class="derm-card-actions" style="margin-top:12px;">
                    ${d.website ? `<a href="${escapeHtml(d.website)}" target="_blank" rel="noopener noreferrer" class="derm-btn derm-btn-primary" style="flex:1; justify-content:center;">Consult Now →</a>` : ''}
                </div>
            </div>`;
    }).join('');
}

function renderDermDocs(docs, filter = 'all') {
    const container = document.getElementById('dermResultsContainer');
    if (!container) return;

    let filtered = [...(docs || [])];
    if (filter === 'highest_rated')  filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (filter === 'most_reviewed') filtered.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
    else if (filter === 'open_now')  filtered = filtered.filter(d => isClinicOpenNow(d.openingHours || d.openNow));

    if (filtered.length === 0) {
        const noResultsMsg = filter === 'open_now'
            ? 'No results are currently open. Try the <strong>All</strong> filter.'
            : 'No local clinics found for this area. Try a larger city name.';
        const onlineBtn = (filter !== 'open_now' && allOnline.length > 0)
            ? `<button class="secondary-btn" onclick="switchToOnlineTab()" style="margin-top:8px;">View Online Consultants (${allOnline.length})</button>`
            : '';
        container.innerHTML = `
            <div class="page-empty-state" style="grid-column:1/-1;">
                <div class="empty-illustration">🩺</div>
                <h3>No results found</h3>
                <p>${noResultsMsg}</p>
                ${onlineBtn}
                ${filter === 'open_now' ? '' : `<button class="secondary-btn" onclick="initDerm()" style="margin-top:8px;">Refresh</button>`}
            </div>`;
        return;
    }

    const sourceArr = activeDermTab === 'hospitals' ? allHospitals : allClinics;
    const tagLabel  = activeDermTab === 'hospitals' ? 'Treatment Center' : 'Local Clinic';
    const tagColor  = activeDermTab === 'hospitals' ? 'rgba(201,168,76,0.15)' : 'rgba(79,124,99,0.15)';
    const tagText   = activeDermTab === 'hospitals' ? '#9a7b2e' : '#4f7c63';

    container.innerHTML = filtered.map(d => {
        const initial = escapeHtml((d.name || '?').charAt(0).toUpperCase());
        const facilityBadge = d.facilityType || tagLabel;

        const ratingVal = typeof d.rating === 'number' ? d.rating : (typeof d.rating === 'string' ? parseFloat(d.rating) : null);
        const rating = ratingVal && !Number.isNaN(ratingVal) ? ratingVal : null;
        const reviews = d.reviewCount || d.reviews || null;
        const stars = rating ? '★'.repeat(Math.round(Math.min(rating, 5))) + '☆'.repeat(Math.max(0, 5 - Math.round(Math.min(rating, 5)))) : '';

        // Opening hours badge
        let hoursHtml = '';
        if (d.openingHours && typeof d.openingHours === 'string') {
            hoursHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top:4px;">🕐 ${escapeHtml(d.openingHours)}</div>`;
        }

        // Phone
        const phoneHtml = d.phone
            ? `<div style="font-size:12px; margin-top:4px;">📞 <a href="tel:${escapeHtml(d.phone)}" style="color:var(--forest);">${escapeHtml(d.phone)}</a></div>`
            : '';

        // AI / description text (may come from SerpAPI or GPT in future)
        const descSource = d.aiDescription || d.description || '';
        const descHtml = descSource
            ? `<p style="font-size:13px; color:var(--text-muted); margin-top:6px;">${escapeHtml(descSource)}</p>`
            : '';

        // Directions link
        const directionsUrl = d.directionsUrl || ((d.lat != null && d.lng != null)
            ? `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`
            : null);

        const sourceIdx = sourceArr.indexOf(d);
        const hasThumb = !!d.thumbnail;
        const bgColor = _brandColor(d.name || facilityBadge || 'Clinic');
        const distanceHtml = d.distance
            ? `<span style="font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(15,23,42,0.04); color:#4b5563;">📏 ${escapeHtml(String(d.distance))}</span>`
            : '';
        const statusText = typeof d.openNow === 'string' ? d.openNow : (d.openNow === true ? 'Open now' : (d.openNow === false ? 'Closed' : 'Hours unknown'));

        return `
            <div class="derm-card" data-source="${activeDermTab}" data-index="${sourceIdx}">
                <div class="derm-card-top">
                    <div class="derm-card-photo" style="background:${bgColor};">
                        ${hasThumb ? `<img src="${escapeHtml(d.thumbnail)}" alt="${escapeHtml(d.name || 'Clinic')}" class="derm-photo-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />` : ''}
                        <div class="derm-photo-initial" style="${hasThumb ? 'display:none;' : 'display:flex;'}">${initial}</div>
                    </div>
                    <div class="derm-card-info">
                        <div class="derm-tag" style="background:${tagColor}; color:${tagText};">${escapeHtml(facilityBadge)}</div>
                        <h3 class="derm-doctor-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</h3>
                        ${rating ? `<div class="derm-rating"><span class="derm-stars">${stars}</span><span>${rating.toFixed(1)}</span>${reviews ? `<span class="derm-review-count">(${Number(reviews).toLocaleString()} reviews)</span>` : ''}</div>` : ''}
                        ${descHtml}
                        <div class="derm-details-text" style="margin-top:4px;"><span>📍</span> ${escapeHtml(d.address || 'Address not listed')}</div>
                        ${phoneHtml}
                        ${hoursHtml}
                        <div class="derm-badges">
                            <span class="derm-status-badge ${statusText.toLowerCase().includes('open') ? 'open' : (statusText.toLowerCase().includes('closed') ? 'closed' : 'unknown')}"><span class="derm-status-dot"></span>${escapeHtml(statusText)}</span>
                            ${distanceHtml}
                            <span style="font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(201,168,76,0.12); color:var(--gold);">${escapeHtml(d.source || 'Google Maps')}</span>
                        </div>
                        ${d.website ? `<div style="font-size:12px; margin-top:4px;">🌐 <a href="${escapeHtml(d.website)}" target="_blank" rel="noopener noreferrer" style="color:var(--forest);">${escapeHtml(new URL(d.website).hostname)}</a></div>` : ''}
                    </div>
                </div>
                <div class="derm-card-actions" style="margin-top:12px; display:flex; gap:8px;">
                    ${d.googleMapsUrl ? `<a href="${escapeHtml(d.googleMapsUrl)}" target="_blank" rel="noopener noreferrer" class="derm-btn derm-btn-primary" style="flex:1; justify-content:center;">🗺 View on Maps</a>` : ''}
                    ${directionsUrl ? `<a href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" class="derm-btn derm-btn-outline" style="flex:1; justify-content:center;">🧭 Get Directions</a>` : ''}
                </div>
            </div>`;
    }).join('');

    container.querySelectorAll('.derm-card').forEach(card => {
        card.addEventListener('click', e => { if (e.target.closest('.derm-btn') || e.target.closest('a')) return; card.classList.toggle('expanded'); });
    });
    container.querySelectorAll('.book-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const src = btn.dataset.source === 'hospitals' ? allHospitals : allClinics;
            const doc = src[btn.dataset.index];
            if (doc) openBookingModal(doc);
        });
    });
}

function setupBookingModalHandlers() {
    const closeBtn  = document.getElementById('bookingModalClose');
    const backdrop  = document.getElementById('bookingModalBackdrop');
    const closeModal = () => {
        document.getElementById('bookingModal').classList.remove('open');
        setTimeout(() => {
            document.getElementById('bookingModal').style.display = 'none';
            backdrop.style.display = 'none';
        }, 300);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (backdrop) backdrop.onclick = closeModal;
}

function openBookingModal(doc) {
    const modal    = document.getElementById('bookingModal');
    const backdrop = document.getElementById('bookingModalBackdrop');

    document.getElementById('bookingModalName').textContent = doc.name;
    const photoWrap = document.getElementById('bookingModalPhoto');
    if (doc.photoUrl) {
        photoWrap.innerHTML = `<img src="${escapeHtml(doc.photoUrl)}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
    } else {
        photoWrap.innerHTML = escapeHtml(doc.name.charAt(0).toUpperCase());
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
    setTimeout(() => { modal.classList.add('open'); }, 10);
}


// ══════════════════════════════════════════════
// CONSULTATION QUESTION FLOW
// ══════════════════════════════════════════════
const CQ_QUESTIONS = [
    {
        id: "skinType", headline: "What's your skin type?",
        subtitle: "Not sure? Pick what feels closest \u2014 we'll refine it together",
        options: ["Normal", "Oily", "Dry", "Combination", "Sensitive"]
    },
    {
        id: "concern", headline: "What's your biggest skin concern?",
        subtitle: "We'll focus your routine around this goal",
        options: ["Acne & Breakouts", "Dark spots & Pigmentation", "Wrinkles & Fine lines", "Redness & Irritation", "Dullness & Uneven tone", "Large pores"]
    },
    {
        id: "sensitivity", headline: "How sensitive is your skin?",
        subtitle: "This helps us choose gentler formulas if needed",
        options: ["Not sensitive at all", "Mildly sensitive", "Very sensitive \u2014 reacts to most products", "I'm not sure"]
    },
    {
        id: "age", headline: "What's your age range?",
        subtitle: "Skincare needs change beautifully with age",
        options: ["Under 20", "20\u201329", "30\u201339", "40\u201349", "50+"]
    },
    {
        id: "budget", headline: "What's your skincare budget?",
        subtitle: "",
        options: ["Low \u2014 drugstore & affordable", "Medium \u2014 mid-range brands", "High \u2014 luxury & clinical", "No budget \u2014 give me the best"]
    },
    {
        id: "goal", headline: "What's your skincare goal?",
        subtitle: "Sum it up in one phrase if you can",
        options: ["Clear skin with fewer breakouts", "Glowing, hydrated complexion", "Slow down visible aging", "Reduce redness and calm skin", "Even skin tone"]
    }
];

let cqAnswers = {};
let cqStep = 0;
let cqActive = false;

function startConsultationFlow() {
    cqAnswers = {};
    cqStep = 0;
    cqActive = true;
    const flow = document.getElementById('consultationFlow');
    const chatArea = document.getElementById('chatArea');
    const inputBar = document.querySelector('.drawer-input-bar');
    flow.style.display = 'flex';
    chatArea.style.display = 'none';
    if (inputBar) inputBar.style.display = 'none';
    renderCQStep();
}

function endConsultationFlow() {
    cqActive = false;
    const flow = document.getElementById('consultationFlow');
    const chatArea = document.getElementById('chatArea');
    const inputBar = document.querySelector('.drawer-input-bar');
    flow.style.display = 'none';
    chatArea.style.display = '';
    if (inputBar) inputBar.style.display = '';
}

function renderCQStep() {
    const area = document.getElementById('cqQuestionArea');
    const total = CQ_QUESTIONS.length;
    const progressFill = document.getElementById('cqProgressFill');
    const stepLabel = document.getElementById('cqStepLabel');
    const backBtn = document.getElementById('cqBackBtn');
    const watermark = document.querySelector('.cq-watermark');

    // Check if we're at the summary
    if (cqStep >= total) {
        progressFill.style.width = '100%';
        stepLabel.textContent = 'Summary';
        backBtn.classList.add('visible');
        if (watermark) watermark.style.transform = `translate(-50%, calc(-50% - ${total * 1.5}px))`;
        renderCQSummary(area);
        return;
    }

    const q = CQ_QUESTIONS[cqStep];
    progressFill.style.width = ((cqStep + 1) / total * 100) + '%';
    stepLabel.textContent = `Step ${cqStep + 1} of ${total}`;
    backBtn.classList.toggle('visible', cqStep > 0);
    if (watermark) watermark.style.transform = `translate(-50%, calc(-50% - ${cqStep * 1.5}px))`;

    const selectedVal = cqAnswers[q.id] || '';

    let html = `<div class="cq-card">`;
    html += `<div class="cq-headline">${q.headline}</div>`;
    if (q.subtitle) html += `<div class="cq-subtitle">${q.subtitle}</div>`;
    html += `<div class="cq-options">`;
    q.options.forEach((opt, i) => {
        const isSel = selectedVal === opt;
        html += `<div class="cq-option${isSel ? ' selected' : ''}" data-value="${opt}">
            <div class="cq-badge">${i + 1}</div>
            <div class="cq-option-text">${opt}</div>
            <div class="cq-arrow">${isSel ? '✓' : '›'}</div>
        </div>`;
    });
    html += `</div>`;

    // Write your own
    html += `<div class="cq-divider">or</div>`;
    html += `<div class="cq-custom" id="cqCustomCard">
        <div class="cq-custom-icon">✏️</div>
        <div class="cq-custom-placeholder">Write your own answer...</div>
        <div class="cq-custom-input-row">
            <input class="cq-custom-input" id="cqCustomInput" placeholder="Type your answer..." />
            <button class="cq-custom-send" id="cqCustomSend">→</button>
        </div>
    </div>`;

    // Skip
    html += `<button class="cq-skip" id="cqSkipBtn">Skip this question →</button>`;
    html += `</div>`; // close cq-card
    area.innerHTML = html;

    // Attach listeners
    area.querySelectorAll('.cq-option').forEach(opt => {
        opt.addEventListener('click', () => {
            cqAnswers[q.id] = opt.dataset.value;
            // Brief select animation then advance
            area.querySelectorAll('.cq-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            opt.querySelector('.cq-arrow').textContent = '✓';
            setTimeout(() => advanceCQ('forward'), 300);
        });
    });

    const customCard = document.getElementById('cqCustomCard');
    customCard.addEventListener('click', (e) => {
        if (customCard.classList.contains('expanded')) return;
        customCard.classList.add('expanded');
        customCard.querySelector('.cq-custom-placeholder').style.display = 'none';
        setTimeout(() => document.getElementById('cqCustomInput').focus(), 100);
    });

    const customSend = document.getElementById('cqCustomSend');
    const customInput = document.getElementById('cqCustomInput');
    const submitCustom = () => {
        const val = customInput.value.trim();
        if (val) {
            cqAnswers[q.id] = val;
            advanceCQ('forward');
        }
    };
    customSend.addEventListener('click', (e) => { e.stopPropagation(); submitCustom(); });
    customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } });

    // Skip with 1.5s delay
    const skipBtn = document.getElementById('cqSkipBtn');
    setTimeout(() => skipBtn.classList.add('visible'), 1500);
    skipBtn.addEventListener('click', () => {
        if (!cqAnswers[q.id]) cqAnswers[q.id] = 'Skipped';
        advanceCQ('forward');
    });
}

function advanceCQ(direction) {
    const area = document.getElementById('cqQuestionArea');
    const card = area.querySelector('.cq-card, .cq-summary');
    if (card) {
        card.classList.add(direction === 'forward' ? 'exit-left' : 'exit-right');
        setTimeout(() => {
            if (direction === 'forward') cqStep++;
            else cqStep = Math.max(0, cqStep - 1);
            renderCQStep();
            // Apply correct entrance animation
            const newCard = area.querySelector('.cq-card, .cq-summary');
            if (newCard && direction === 'back') {
                newCard.style.animation = 'cqSlideInFromLeft 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both';
            }
        }, 250);
    } else {
        if (direction === 'forward') cqStep++;
        else cqStep = Math.max(0, cqStep - 1);
        renderCQStep();
    }
}

function renderCQSummary(area) {
    const leafSvg = `<svg width="100" height="110" viewBox="0 0 180 200" fill="none">
        <path d="M90 200 Q90 140 90 80" stroke="#C9A84C" stroke-width="2" stroke-linecap="round"/>
        <path d="M90 120 Q110 105 125 90 Q108 100 90 108" stroke="#C9A84C" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M90 140 Q70 125 55 110 Q72 120 90 128" stroke="#C9A84C" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M60 200 Q58 160 50 110" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
        <path d="M120 200 Q122 160 130 110" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
        <circle cx="90" cy="75" r="6" stroke="#C9A84C" stroke-width="1.5" fill="none"/>
        <circle cx="90" cy="75" r="2.5" fill="#C9A84C" opacity="0.6"/>
    </svg>`;

    const labels = { skinType: 'SKIN TYPE', concern: 'CONCERN', sensitivity: 'SENSITIVITY', age: 'AGE RANGE', budget: 'BUDGET', goal: 'GOAL' };
    let rowsHtml = '';
    for (const q of CQ_QUESTIONS) {
        const val = cqAnswers[q.id] || 'Not specified';
        rowsHtml += `<div class="cq-summary-row">
            <span class="cq-summary-label">${labels[q.id]}</span>
            <span class="cq-summary-dots"></span>
            <span class="cq-summary-value">${val}</span>
        </div>`;
    }

    area.innerHTML = `<div class="cq-summary">
        <div class="cq-summary-illustration">${leafSvg}</div>
        <div class="cq-summary-heading">Your skin profile is ready</div>
        <div class="cq-summary-sub">Based on your answers, here's what GlowGuide knows about you:</div>
        <div class="cq-summary-rows">${rowsHtml}</div>
        <button class="cq-cta" id="cqCtaBtn">Build My Routine ✨</button>
        <div class="cq-cta-hint">Takes about 30 seconds to generate</div>
    </div>`;

    document.getElementById('cqCtaBtn').addEventListener('click', () => {
        // Compile answers into SYSTEM NOTE so AI skips Group 1
        let prompt = `SYSTEM NOTE: The user has already completed the structured intake form. Their answers are provided below. Do NOT ask any of these questions again. Do NOT ask about skin type, sensitivity, goals, budget, steps, experience or diet \u2014 these are already answered. Proceed directly to follow-up questions about skin history, past products, and wellness habits, then generate the routine.\n\n`;
        prompt += `User's intake answers:\n`;
        prompt += `- Skin Type: ${cqAnswers.skinType || 'Not specified'}\n`;
        prompt += `- Main Concern: ${cqAnswers.concern || 'Not specified'}\n`;
        prompt += `- Sensitivity: ${cqAnswers.sensitivity || 'Not specified'}\n`;
        prompt += `- Age Range: ${cqAnswers.age || 'Not specified'}\n`;
        prompt += `- Budget: ${cqAnswers.budget || 'Not specified'}\n`;
        prompt += `- Goal: ${cqAnswers.goal || 'Not specified'}`;

        // Save budget & profile info
        const profileUpdate = {
            skinType: cqAnswers.skinType || '',
            concern: cqAnswers.concern || '',
            budget: cqAnswers.budget || '',
            sensitivity: cqAnswers.sensitivity || '',
            age: cqAnswers.age || '',
            goal: cqAnswers.goal || '',
            lastConsult: today()
        };
        LS.set('glowguide_profile', { ...LS.get('glowguide_profile', {}), ...profileUpdate });
        saveProfileToFirestore(profileUpdate);

        // Fix 1 — Background fire-and-forget: generate a warm 2-3 sentence personal summary
        (async () => {
            try {
                const summaryRes = await fetch('/api/simple-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system: 'You are a personal skincare advisor. Write a concise, warm, second-person skin summary (2-3 sentences) based on the profile data. Be specific and actionable. No headers, no formatting, no extra text — just the sentences.',
                        message: `Skin Type: ${cqAnswers.skinType}\nMain Concern: ${cqAnswers.concern}\nSensitivity: ${cqAnswers.sensitivity}\nAge Range: ${cqAnswers.age}\nBudget: ${cqAnswers.budget}\nGoal: ${cqAnswers.goal}`
                    })
                });
                if (summaryRes.ok) {
                    const summaryData = await summaryRes.json();
                    const summaryText = (summaryData.response || '').trim();
                    if (summaryText) {
                        const existing = LS.get('glowguide_profile', {});
                        LS.set('glowguide_profile', { ...existing, summary: summaryText });
                        saveProfileToFirestore({ summary: summaryText });
                    }
                }
            } catch (e) {
                console.warn('[GlowGuide] Summary generation failed (non-blocking):', e.message);
            }
        })();

        // Close flow, show chat, send message
        endConsultationFlow();
        const welcomeEl = document.getElementById('welcomeState');
        if (welcomeEl) welcomeEl.remove();
        document.getElementById('messageInput').value = prompt;
        sendMessage();
    });
}

// Hook back button
document.getElementById('cqBackBtn')?.addEventListener('click', () => advanceCQ('back'));

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

        console.log('[GlowGuide] File selected:', file.name, file.size, file.type);

        // Show instant preview bubble in chat using object URL (no waiting for base64)
        window.pendingImageObjectURL = URL.createObjectURL(file);

        const reader = new FileReader();
        reader.onload = function(e) {
            const fullDataUrl = e.target.result;
            // Strip the "data:image/jpeg;base64," prefix — send only the raw base64
            window.pendingImageData = fullDataUrl.split(',')[1];
            window.pendingImageType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
            console.log('[GlowGuide] Image converted to base64:', window.pendingImageData.length, 'chars, type:', window.pendingImageType);
            document.getElementById('previewImg').src = fullDataUrl;
            document.getElementById('imagePreview').style.display = 'flex';
            // Auto-send if this photo upload came from the no-photo card
            if (window._pendingAnalysisMessage) {
                document.getElementById('messageInput').value = window._pendingAnalysisMessage;
                window._pendingAnalysisMessage = null;
                setTimeout(() => sendMessage(), 350);
            }
        };
        reader.readAsDataURL(file);
    });

    if (removeImageBtn) removeImageBtn.addEventListener('click', () => { 
        currentImage = null; 
        window.pendingImageData = null;
        window.pendingImageType = null;
        if (window.pendingImageObjectURL) { URL.revokeObjectURL(window.pendingImageObjectURL); window.pendingImageObjectURL = null; }
        imageInput.value = ''; 
        document.getElementById('imagePreview').style.display = 'none'; 
    });

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
        await saveCurrentSession();
        startNewSession();
        showWelcomeState();
    });

    // Quick chips — intercept 'consultation' prompts to show premium flow
    document.querySelectorAll('.quick-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (chip.dataset.prompt && chip.dataset.prompt.toLowerCase().includes('consultation')) {
                startConsultationFlow();
            } else {
                document.getElementById('messageInput').value = chip.dataset.prompt; sendMessage();
            }
        });
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

let isSending = false;

// ── FIX 2: Streaming send with live token display ─────────────
async function sendMessage() {
    if (isSending) return;
    const msgInput = document.getElementById('messageInput');
    const message = msgInput.value.trim();
    if (!message && !window.pendingImageData && !currentPdfContent) return;

    // No-photo analysis guard
    const analysisKeywords = ['analyze', 'analysis', 'check my skin', 'look at my skin', "what's wrong with my skin", 'skin photo', 'examine my skin', 'scan my skin', 'assess my skin'];
    const wantsAnalysis = message && analysisKeywords.some(k => message.toLowerCase().includes(k));
    if (wantsAnalysis && !window.pendingImageData) {
        msgInput.value = '';
        window._pendingAnalysisMessage = message;
        renderNoPhotoCard();
        return;
    }

    isSending = true;
    if (!currentSessionId) startNewSession();

    const welcomeEl = document.getElementById('welcomeState');
    if (welcomeEl) welcomeEl.remove();

    // Show photo preview bubble immediately
    if (window.pendingImageObjectURL) {
        const previewDiv = document.createElement('div');
        previewDiv.className = 'message user-message';
        previewDiv.innerHTML = `<div class="message-content image-preview-bubble">
            <img src="${window.pendingImageObjectURL}" alt="Skin photo" />
            <span class="image-caption">Skin photo uploaded</span>
        </div>`;
        document.getElementById('chatMessages').appendChild(previewDiv);
        if (message) addMessage(message, 'user');
        scrollChat();
        setTimeout(() => { URL.revokeObjectURL(window.pendingImageObjectURL); window.pendingImageObjectURL = null; }, 60000);
    } else {
        if (message) addMessage(message, 'user');
    }

    saveToHistory({ role: 'user', content: message, timestamp: timeStr() });
    const hasPendingImage = !!window.pendingImageData;
    const userMsgContent = message || (hasPendingImage ? '[Skin photo shared]' : '[Document shared]');
    // Generate a stable key for image persistence before we clear pendingImageData
    const msgImageKey = hasPendingImage && currentSessionId
        ? currentSessionId + '_' + Date.now()
        : null;
    currentSessionMessages.push({ role: 'user', content: userMsgContent, timestamp: timeStr(),
        ...(msgImageKey ? { imageKey: msgImageKey } : {}) });
    if (currentSessionMessages.length === 1 && message) generateSessionTitle(message);

    const imageToSend    = window.pendingImageData;
    const imageTypeToSend = window.pendingImageType || 'image/jpeg';
    const pdfToSend      = currentPdfContent;
    currentImage = null;
    window.pendingImageData = null;
    window.pendingImageType = null;
    currentPdfContent = null;
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('pdfPreview').style.display = 'none';
    if (document.getElementById('imageInput')) document.getElementById('imageInput').value = '';
    if (document.getElementById('pdfInput'))   document.getElementById('pdfInput').value = '';

    msgInput.value = '';
    msgInput.style.height = 'auto';

    // Compress and cache image in localStorage for session restore (fire-and-forget)
    if (imageToSend && msgImageKey) {
        compressImageForStorage(imageToSend)
            .then(compressed => saveImageToLocal(msgImageKey, compressed))
            .catch(e => console.warn('[GlowGuide] Image compress failed:', e.message));
    }

    // Show typing / progress bubble immediately ─ user sees activity at once
    const aiBubble = createAIBubble();
    if (imageToSend) {
        updateProgressBubble(aiBubble, 1, '📸 Photo received — running analysis...');
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                image: imageToSend || null,
                imageType: imageTypeToSend,
                pdfContent: pdfToSend || null,
                skinProfile: LS.get('glowguide_profile', null),
                sessionHistory: currentSessionMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'HTTP ' + response.status);
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText    = '';
        let corrected   = null;
        let sseBuffer   = '';
        let streamStarted = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();

                if (raw === '[DONE]') break;
                if (raw.startsWith('[ERROR]')) {
                    aiBubble.innerHTML = '<div class="message-content"><p>Something went wrong. Please try again.</p></div>';
                    break;
                }

                try {
                    const parsed = JSON.parse(raw);

                    // FIX 5 — progress stages for image analysis
                    if (parsed.status === 'analyzing' && parsed.stage === 2) {
                        updateProgressBubble(aiBubble, 2, '🔬 Running skin analysis model...');
                    } else if (parsed.status === 'generating') {
                        updateProgressBubble(aiBubble, 3, '✍️ Writing your personalized report...');
                    } else if (parsed.corrected) {
                        // Validation-corrected final text
                        corrected = parsed.corrected;
                    } else if (parsed.token) {
                        if (!streamStarted) {
                            // Replace progress/typing bubble with live text container
                            aiBubble.innerHTML = '<div class="message-content streaming-content"></div>';
                            streamStarted = true;
                        }
                        fullText += parsed.token;
                        // Show raw text as it streams — final render happens at DONE
                        aiBubble.querySelector('.streaming-content').textContent = fullText;
                        scrollChat();
                    }
                } catch (_) {}
            }
        }

        // Use server-corrected text if validation failed during streaming
        const finalText = corrected || fullText;

        // Final render — replace raw text with richly formatted card
        if (finalText) {
            aiBubble.innerHTML = '';
            parseAndRender(finalText, aiBubble);
            saveToHistory({ role: 'assistant', content: finalText, timestamp: timeStr() });
            currentSessionMessages.push({ role: 'assistant', content: finalText, timestamp: timeStr() });
            saveCurrentSession();
            extractAndSaveProfile(finalText);

            const hasRoutine = ['morning routine', 'evening routine', 'morning:', 'evening:', 'cleanser', 'moisturizer', 'sunscreen'].some(k => finalText.toLowerCase().includes(k));
            if (hasRoutine) {
                extractAndSaveRoutine(finalText);
                await searchAndDisplayProducts(finalText);
            }
        }

    } catch (err) {
        aiBubble.innerHTML = '<div class="message-content" style="background:#fff0f0"><p>Sorry, something went wrong: ' + err.message + '</p></div>';
        console.error('[sendMessage] error:', err);
    } finally {
        isSending = false;
    }
}

/** Creates an AI message bubble with a typing indicator, appended to chat. */
function createAIBubble() {
    const chatMessages = document.getElementById('chatMessages');
    const bubble = document.createElement('div');
    bubble.className = 'message ai-message';
    bubble.innerHTML =
        '<div class="message-content">' +
        '<div class="typing-indicator">' +
        '<span></span><span></span><span></span>' +
        '</div></div>';
    chatMessages.appendChild(bubble);
    scrollChat();
    return bubble;
}

/** Updates the AI bubble to show an analysis progress step (FIX 5). */
function updateProgressBubble(bubble, stage, stageMsg) {
    const steps = [
        { icon: '📸', text: 'Photo received' },
        { icon: '🔬', text: 'Running skin analysis model...' },
        { icon: '✍️', text: 'Writing your personalized report...' }
    ];
    const stepsHtml = steps.slice(0, stage).map((s, i) => {
        const isDone   = i < stage - 1;
        const isActive = i === stage - 1;
        return `<div class="progress-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}">
            <span class="progress-step-icon">${isDone ? '✓' : s.icon}</span>
            <span>${s.text}</span>
        </div>`;
    }).join('');
    const pct = Math.round((stage / 3) * 75) + '%'; // caps at 75 until streaming
    bubble.innerHTML = `<div class="message-content"><div class="analysis-progress">
        ${stepsHtml}
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}"></div></div>
    </div></div>`;
    scrollChat();
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
    // Strip [ROUTINE]...[/ROUTINE] blocks, [CHAT] tags, markdown symbols, and pipe-separated step lines before saving as readable notes
    const cleanNotes = text
        .replace(/\[ROUTINE\][\s\S]*/gi, '')         // strip [ROUTINE] to end
        .replace(/\[CHAT\]/gi, '').replace(/\[\/CHAT\]/gi, '')
        .replace(/^(SUMMARY|MORNING|EVENING|AFTERNOON):\s*/gim, '')
        .replace(/^\s*\d+\.\s+\S+\s*\|.*$/gm, '')
        .replace(/^[-*]\s+/gm, '').replace(/\*\*/g, '')
        .replace(/\n{3,}/g, '\n\n').trim().slice(0, 400);
    const updated = { ...existing, skinType, lastConsult: today(), consultCount: (existing.consultCount || 0) + 1, notes: cleanNotes };
    if (lower.includes('acne') || lower.includes('breakout')) updated.concern = 'Acne / Breakouts';
    else if (lower.includes('dark spot') || lower.includes('hyperpigment')) updated.concern = 'Dark Spots';
    else if (lower.includes('anti-aging') || lower.includes('wrinkle')) updated.concern = 'Anti-Aging';
    else if (lower.includes('redness') || lower.includes('rosacea')) updated.concern = 'Redness';
    LS.set('glowguide_profile', updated);
    saveProfileToFirestore(updated); // dual-write to Firestore
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
    // Convert "- " bullets to styled gold dots
    f = f.replace(/^- (.+)$/gm, '<span class="sr-bullet"><span class="sr-bullet-dot"></span>$1</span>');
    f = f.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
    return `<p>${f}</p>`;
}

// ══════════════════════════════════════════════
// SMART RESPONSE RENDERER
// ══════════════════════════════════════════════

/**
 * Parse rawText and render the appropriate card.
 * @param {string} rawText  - Full AI response text
 * @param {HTMLElement|null} targetBubble - Streaming placeholder to remove after render.
 */
function parseAndRender(rawText, targetBubble = null) {
    if (!rawText) return;
    let rendered = false;

    // Type 0: [ANALYSIS] — skin photo analysis card (highest priority)
    if (rawText.includes('[ANALYSIS]')) {
        const content = rawText.match(/\[ANALYSIS\]([\s\S]*?)\[\/ANALYSIS\]/)?.[1];
        if (content) { renderAnalysisCard(content); rendered = true; }
    }

    // Type 1: [OPTIONS]
    if (!rendered && rawText.includes('[OPTIONS]')) {
        const content = rawText.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/)?.[1];
        if (content) { renderOptionCard(content); rendered = true; }
    }

    // Type 2: [ROUTINE] — may be followed by a [CHAT] CTA in the same response
    if (!rendered && rawText.includes('[ROUTINE]')) {
        const content = rawText.match(/\[ROUTINE\]([\s\S]*?)\[\/ROUTINE\]/)?.[1];
        if (content) {
            renderRoutineCards(content);
            rendered = true;
            // Also render any [CHAT] redirect that follows the routine
            if (rawText.includes('[CHAT]')) {
                const chatContent = rawText.match(/\[CHAT\]([\s\S]*?)\[\/CHAT\]/)?.[1];
                if (chatContent) renderChatBubble(chatContent);
            }
        }
    }

    // Type 3: [INFO]
    if (!rendered && rawText.includes('[INFO]')) {
        const content = rawText.match(/\[INFO\]([\s\S]*?)\[\/INFO\]/)?.[1];
        if (content) { renderInfoBubble(content); rendered = true; }
    }

    // Type 4: [CHAT]
    if (!rendered && rawText.includes('[CHAT]')) {
        const content = rawText.match(/\[CHAT\]([\s\S]*?)\[\/CHAT\]/)?.[1];
        if (content) { renderChatBubble(content); rendered = true; }
    }

    // Fallback: strip tags and render as chat bubble
    if (!rendered) {
        console.warn('[Response Parser] AI provided no valid format tags. Falling back to plain chat.');
        const strippedText = rawText.replace(/\[\/?(OPTIONS|ROUTINE|INFO|CHAT|ANALYSIS)\]/g, '').trim();
        renderChatBubble(strippedText);
    }

    // Remove the streaming placeholder bubble — freshly rendered elements are already appended
    if (targetBubble && targetBubble.parentNode) {
        targetBubble.remove();
    }
}

function renderChatBubble(content) {
    addMessage(content.trim(), 'ai');
}

// Render no-photo option card with custom per-option behaviors
function renderNoPhotoCard() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const div = document.createElement('div');
    div.className = 'message ai-message no-photo-card';
    div.innerHTML = `
        <div class="message-content sr-option-card">
            <div class="cq-headline" style="font-size:20px;margin-top:16px">To analyze your skin I'll need a photo</div>
            <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#8A8A8A;font-style:italic;text-align:center;margin-top:4px;">Choose an option below or upload using the 📷 icon</div>
            <div class="cq-options" style="margin-top:16px">
                <div class="cq-option sr-chat-option" data-action="upload">
                    <div class="cq-badge">1</div><div class="cq-option-text">📸 Upload a photo now</div><div class="cq-arrow">›</div>
                </div>
                <div class="cq-option sr-chat-option" data-action="describe">
                    <div class="cq-badge">2</div><div class="cq-option-text">💬 Describe my skin instead</div><div class="cq-arrow">›</div>
                </div>
                <div class="cq-option sr-chat-option" data-action="profile">
                    <div class="cq-badge">3</div><div class="cq-option-text">🔍 Use my saved skin profile</div><div class="cq-arrow">›</div>
                </div>
                <div class="cq-option sr-chat-option" data-action="cancel">
                    <div class="cq-badge">4</div><div class="cq-option-text">❌ Cancel</div><div class="cq-arrow">›</div>
                </div>
            </div>
        </div>`;
    chatMessages.appendChild(div);
    scrollChat();

    div.querySelectorAll('.sr-chat-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const action = opt.dataset.action;
            opt.querySelectorAll('.sr-chat-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            if (opt.querySelector('.cq-arrow')) opt.querySelector('.cq-arrow').textContent = '✓';

            if (action === 'upload') {
                // Trigger photo picker — after selection, _pendingAnalysisMessage will be resent
                setTimeout(() => { document.getElementById('imageInput')?.click(); }, 250);
            } else if (action === 'describe') {
                window._pendingAnalysisMessage = null;
                const msg = 'The user wants a skin analysis but has no photo. Please ask them to describe their skin concerns in detail using your structured question format so you can provide analysis and recommendations without a photo.';
                document.getElementById('messageInput').value = msg;
                setTimeout(() => sendMessage(), 300);
            } else if (action === 'profile') {
                const profile = LS.get('glowguide_profile', null);
                if (!profile || !profile.skinType) {
                    showToast('No saved profile found. Please upload a photo or describe your skin.');
                    opt.classList.remove('selected');
                    if (opt.querySelector('.cq-arrow')) opt.querySelector('.cq-arrow').textContent = '›';
                } else {
                    window._pendingAnalysisMessage = null;
                    document.getElementById('messageInput').value = `Please provide analysis and routine recommendations based on this saved skin profile: ${JSON.stringify(profile)}`;
                    setTimeout(() => sendMessage(), 300);
                }
            } else if (action === 'cancel') {
                window._pendingAnalysisMessage = null;
                div.remove();
            }
        });
    });
}

function renderAnalysisCard(content) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    const get = (key) => {
        const line = lines.find(l => l.startsWith(key + ':'));
        return line ? line.slice(key.length + 1).trim() : '';
    };

    const summary = get('SUMMARY');
    const skinType = get('SKIN_TYPE');
    const texture = get('TEXTURE');
    const urgent = get('URGENT');
    const next = get('NEXT');

    // Parse CONCERNS
    let inConcerns = false, inPositive = false;
    const concerns = [], positives = [];
    for (const line of lines) {
        if (line === 'CONCERNS:') { inConcerns = true; inPositive = false; continue; }
        if (line === 'POSITIVE:') { inPositive = true; inConcerns = false; continue; }
        if (line.startsWith('URGENT:') || line.startsWith('NEXT:') || line.startsWith('SUMMARY:') || line.startsWith('SKIN_TYPE:') || line.startsWith('TEXTURE:')) { inConcerns = false; inPositive = false; continue; }
        if (inConcerns && line.startsWith('-')) {
            const parts = line.slice(1).split('|').map(s => s.trim());
            if (parts.length >= 2) concerns.push({ name: parts[0], severity: (parts[1] || 'mild').toLowerCase(), desc: parts[2] || '' });
        }
        if (inPositive && line.startsWith('-')) positives.push(line.slice(1).trim());
    }

    const severityClass = s => s === 'severe' ? 'severity-severe' : s === 'moderate' ? 'severity-moderate' : 'severity-mild';

    const concernsHTML = concerns.map(c => `
        <div class="concern-row">
            <span class="concern-name">${c.name}</span>
            <span class="severity-badge ${severityClass(c.severity)}">${c.severity}</span>
            ${c.desc ? `<span class="concern-desc">${c.desc}</span>` : ''}
        </div>`).join('');

    const positiveHTML = positives.map(p => `<div class="positive-item">&#10003; ${p}</div>`).join('');

    const urgentHTML = urgent ? `
        <div class="analysis-urgent">
            <strong>&#128680; Urgent</strong><br>${urgent}<br>
            <em>Recommendation: See a dermatologist</em>
        </div>` : '';

    // Store analysis data on window for saveToSkinProfile
    const analysisData = { summary, skinType, texture, concerns, positives, urgent };

    const div = document.createElement('div');
    div.className = 'message ai-message';
    div.innerHTML = `
        <div class="message-content" style="padding:0;background:transparent;box-shadow:none">
            <div class="skin-analysis-card">
                <div class="analysis-header">
                    <span class="analysis-icon">&#128269;</span>
                    <span>Skin Analysis Results</span>
                </div>
                ${summary ? `<div class="analysis-summary">${summary}</div>` : ''}
                <div class="analysis-stats">
                    <div class="stat-chip">
                        <span class="stat-label">Skin Type</span>
                        <span class="stat-value">${skinType || '—'}</span>
                    </div>
                    <div class="stat-chip">
                        <span class="stat-label">Texture</span>
                        <span class="stat-value">${texture || '—'}</span>
                    </div>
                </div>
                ${concernsHTML ? `
                <div class="analysis-section">
                    <div class="section-title">⚠️ Concerns Found</div>
                    ${concernsHTML}
                </div>` : ''}
                ${positiveHTML ? `
                <div class="analysis-section positives">
                    <div class="section-title">✅ What looks good</div>
                    ${positiveHTML}
                </div>` : ''}
                ${urgentHTML}
                <button class="save-profile-btn" onclick="saveToSkinProfile(this, ${JSON.stringify(analysisData).replace(/"/g, '&quot;')})">&#128190; Save as My Skin Profile</button>
            </div>
            ${next ? `<div style="background:var(--white);padding:14px 18px;border-radius:4px 16px 16px 16px;box-shadow:var(--shadow);margin-top:8px;font-size:13.5px;line-height:1.65;color:var(--text)">${next}</div>` : ''}
        </div>`;
    chatMessages.appendChild(div);
    scrollChat();
}

// Fix 2 & 3 — Save analysis to skin profile
async function saveToSkinProfile(btn, analysisData) {
    // Build a summary string: use SUMMARY field, or derive from top concerns
    const summaryText = analysisData.summary ||
        (analysisData.concerns?.length
            ? `Your skin analysis identified ${analysisData.concerns.map(c => c.name).join(', ')}. ${analysisData.positives?.length ? 'On the positive side: ' + analysisData.positives[0] + '.' : ''}`
            : '');

    const profile = {
        skinType: analysisData.skinType,
        texture: analysisData.texture,
        concerns: analysisData.concerns,
        positives: analysisData.positives,
        urgent: analysisData.urgent,
        summary: summaryText,
        analyzedAt: new Date().toISOString(),
        source: 'photo-analysis'
    };

    // Save to localStorage
    LS.set('glowguide_profile', { ...LS.get('glowguide_profile', {}), ...profile, skinType: analysisData.skinType, lastPhotoAnalysis: profile.analyzedAt });

    // Save to Firestore
    await saveProfileToFirestore(profile);

    // Update button
    btn.textContent = '\u2705 Saved to Profile';
    btn.disabled = true;
    btn.style.background = '#2A4F3C';

    showToast('\u2705 Skin profile saved! View it on your Home dashboard.');
}

// Global toast notification
function showToast(message) {
    const existing = document.getElementById('gg-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'gg-toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:#1C3829;color:#fff;padding:12px 24px;border-radius:100px;font-family:DM Sans,sans-serif;font-size:13px;font-weight:500;z-index:99999;opacity:0;transition:all 0.3s ease;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.25)';
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function renderInfoBubble(content) {
    // Info bubble is basically the same as a chat bubble, just formatted
    // Convert BULLET: to standard dash so formatMessage handles it
    let text = content.trim().replace(/^BULLET:\s*/gm, '- ');
    addMessage(text, 'ai');
}

function renderRoutineCards(content) {
    // Defensive: strip any lines containing brand names, prices, or URLs
    const brandRx = /cerave|neutrogena|the ordinary|paula'?s choice|cosrx|la[ -]roche|skinceuticals|drunk elephant|tatcha|glossier|inkey list|\$[\d]|€[\d]|£[\d]|https?:\/\//i;
    const cleanContent = content.split('\n')
        .filter(line => !brandRx.test(line))
        .join('\n');

    // 1. Extract and save the routine data
    extractAndSaveRoutine(`[ROUTINE]${cleanContent}[/ROUTINE]`);

    // 2. Render a "Routine Created" card in the chat
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const div = document.createElement('div');
    div.className = 'message ai-message';
    div.innerHTML = `
        <div class="message-content">
            <div class="routine-created-card">
                <div class="routine-card-icon">🌿</div>
                <div class="routine-card-body">
                    <h4 style="margin:0; font-family:'Cormorant Garamond', serif; font-size:20px;">Your Routine is Ready!</h4>
                    <p style="margin:4px 0 12px; font-size:13px; opacity:0.8;">I've built your personalized daily ritual based on our consultation.</p>
                    <button class="cta-btn small-btn" onclick="navigate('page-routines')">View My Routine</button>
                </div>
            </div>
        </div>
    `;
    chatMessages.appendChild(div);
    scrollChat();
}

function renderOptionCard(content) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    let question = '';
    let subtitle = '';
    let options = [];

    const lines = content.split('\n');
    lines.forEach(line => {
        const t = line.trim();
        if (t.startsWith('QUESTION:')) {
            question = t.replace('QUESTION:', '').trim();
        } else if (t.startsWith('SUBTITLE:')) {
            subtitle = t.replace('SUBTITLE:', '').trim();
        } else if (t.startsWith('- ')) {
            options.push(t.substring(2).trim());
        }
    });

    if (!question && options.length === 0) {
        return renderChatBubble(content); // Fallback
    }

    // Render the option card
    const div = document.createElement('div');
    div.className = 'message ai-message';
    let html = `<div class="message-content sr-option-card">`;
    html += `<div class="cq-headline" style="font-size:22px;margin-top:16px">${question}</div>`;
    if (subtitle) {
        html += `<div style="font-family:'DM Sans', sans-serif;font-size:13px;color:#8A8A8A;font-style:italic;text-align:center;margin-top:4px;">${subtitle}</div>`;
    }
    html += `<div class="cq-options" style="margin-top:16px">`;
    options.forEach((opt, i) => {
        html += `<div class="cq-option sr-chat-option" data-value="${opt.replace(/"/g, '&quot;')}">
            <div class="cq-badge">${i + 1}</div>
            <div class="cq-option-text">${opt}</div>
            <div class="cq-arrow">\u203a</div>
        </div>`;
    });
    html += `</div>`;
    // Write your own
    html += `<div class="cq-divider">or</div>`;
    html += `<div class="cq-custom sr-custom" onclick="this.classList.add('expanded');this.querySelector('.cq-custom-placeholder').style.display='none';this.querySelector('.cq-custom-input').focus()">
        <div class="cq-custom-icon">\u270f\ufe0f</div>
        <div class="cq-custom-placeholder">Write your own answer...</div>
        <div class="cq-custom-input-row">
            <input class="cq-custom-input sr-custom-input" placeholder="Type your answer..." />
            <button class="cq-custom-send sr-custom-send">\u2192</button>
        </div>
    </div>`;
    html += `</div>`; // close sr-option-card
    html += `<a class="sr-skip-link">Skip &rarr;</a>`;
    div.innerHTML = html;
    chatMessages.appendChild(div);
    scrollChat();

    // Attach click handlers
    div.querySelectorAll('.sr-chat-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const val = opt.dataset.value;
            div.querySelectorAll('.sr-chat-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            opt.querySelector('.cq-arrow').textContent = '\u2713';
            setTimeout(() => {
                document.getElementById('messageInput').value = val;
                sendMessage();
            }, 300);
        });
    });

    // Custom input handler
    const customSend = div.querySelector('.sr-custom-send');
    const customInput = div.querySelector('.sr-custom-input');
    if (customSend && customInput) {
        const submit = () => {
            const val = customInput.value.trim();
            if (val) { document.getElementById('messageInput').value = val; sendMessage(); }
        };
        customSend.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    // Skip link handler
    const skipLink = div.querySelector('.sr-skip-link');
    if (skipLink) {
        setTimeout(() => { skipLink.style.opacity = '1'; }, 1500);
        skipLink.addEventListener('click', () => {
            document.getElementById('messageInput').value = 'Skip';
            sendMessage();
        });
    }
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
    const name   = (p.name || p.title || 'Product').substring(0, 60);
    const brand  = p.brand || p.source || '';
    const initial = (brand || name).charAt(0).toUpperCase();
    const link   = p.link || p.url || '#';
    const price  = p.price ? (typeof p.price === 'number' ? formatPrice(p.price, p.currency || 'USD') : p.price) : null;
    const badge  = p.badge || null;
    const rating = p.rating ? Math.round(p.rating) : 0;
    const stars  = rating > 0 ? '\u2605'.repeat(Math.min(rating,5)) + '\u2606'.repeat(Math.max(0, 5-rating)) : '';
    const reviews = p.reviewCount ? p.reviewCount.toLocaleString() : (p.reviews ? String(p.reviews) : null);
    const imgUrl = p.image || p.thumbnail || '';
    const encodedProduct = encodeURIComponent(JSON.stringify({ name: p.name || name, brand: p.brand || brand, price: p.price, currency: p.currency, url: link }));
    return `<div class="product-card2">
        ${badge ? `<span class="pmc-badge">${badge}</span>` : ''}
        <div class="pmc-image" ${imgUrl ? `style="background-image:url('${imgUrl}');background-size:cover;background-position:center;"` : ''}>
            ${!imgUrl ? `<span class="pmc-initial">${initial}</span>` : ''}
        </div>
        ${brand ? `<div class="pmc-brand">${brand}</div>` : ''}
        <div class="pmc-name">${name}</div>
        ${p.keyIngredient ? `<span class="pmc-ing-chip">${p.keyIngredient}</span>` : ''}
        ${stars ? `<div class="pmc-rating"><span class="pmc-stars">${stars}</span><span class="pmc-rating-num">${p.rating}</span>${reviews ? `<span class="pmc-review-count">(${reviews})</span>` : ''}</div>` : ''}
        ${price ? `<div class="pmc-price">${price}</div>` : ''}
        <div class="pmc-btns">
            <a href="${link}" target="_blank" rel="noopener noreferrer" class="pmc-btn-view">View →</a>
            <button class="pmc-btn-buy" onclick="openBuyModal('${encodedProduct}')">&#128722; Buy</button>
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
    setupDevOptions();
    setupSidebar();
    setupDrawer();
    setupChat();
    setupSessionHistory();

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
