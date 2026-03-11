// GlowGuide - Client-Side Page Router
'use strict';

const PAGES = [
    'page-home',
    'page-profile',
    'page-water',
    'page-routines',
    'page-products',
    'page-dermatologist',
    'page-settings'
];

/**
 * Navigates to a specific page
 * @param {string} pageId - The ID of the page to navigate to (e.g., 'page-home')
 */
export function navigate(pageId) {
    if (!PAGES.includes(pageId)) {
        console.warn(`[Router] Unknown page ID: ${pageId}, defaulting to page-home`);
        pageId = 'page-home';
    }

    // 1. Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
        // Add a tiny timeout to allow the fade-out CSS transition before `display: none` kicks in.
        // Actually, pure CSS handles it better if we just toggle classes that handle opacity/display.
        // Given the prompt: Total transition 300ms (150 fade out, 150 fade in).
        // Since `display: none` breaks transitions, we'll let CSS handle opacity visibility or just trust the active class structure.
    });

    // 2. Show the target page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // 3. Update hash in URL
    const hash = '#' + pageId.replace('page-', '');
    if (window.location.hash !== hash) {
        window.location.hash = hash;
    } else {
        // If already on the hash, manually trigger the initialization for safety
        window.dispatchEvent(new Event('hashchange'));
    }

    // 4. Update active state in sidebar nav
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(pageId)) {
            item.classList.add('active');
        }
    });

    // 5. Scroll page content to top
    if (targetPage) {
        targetPage.scrollTop = 0;
    }
    // Also scroll the main app shell if that's what controls it
    document.querySelector('.app-shell')?.scrollTo(0, 0);

    // 6. Save last visited page to localStorage
    try {
        localStorage.setItem('glowguide_last_page', pageId);
    } catch (e) {
        // Ignore LS errors in incognito
    }

    console.log(`[Router] Navigated to ${pageId}`);
}

/**
 * Handle browser back/forward buttons (hashchange event)
 */
function handleHashChange() {
    let hash = window.location.hash.replace('#', '');
    if (!hash) hash = 'home';
    const pageId = `page-${hash}`;

    // Call navigate but without pushing to history again
    if (PAGES.includes(pageId)) {
        navigate(pageId);
    } else {
        navigate('page-home');
    }
}

// 7. Listen to window hashchange event
window.addEventListener('hashchange', handleHashChange);

// 8. On app load: navigate to last visited page or #home if none saved
export function initRouter() {
    // If there's a hash in the URL on load, respect it first
    if (window.location.hash) {
        handleHashChange();
        return;
    }

    // Otherwise check localStorage
    let lastPage = 'page-home';
    try {
        const saved = localStorage.getItem('glowguide_last_page');
        if (saved && PAGES.includes(saved)) {
            lastPage = saved;
        }
    } catch (e) { }

    navigate(lastPage);
}

// Make globally available for onclick handlers in HTML
window.navigate = navigate;
