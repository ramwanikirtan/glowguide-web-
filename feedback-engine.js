'use strict';
// ══════════════════════════════════════════════════════════════════
// GlowGuide Feedback Engine — Layer 4
// Tracks routine adherence and adjusts recommendations over time.
// Server-side logic only; browser storage handled by app.js.
// ══════════════════════════════════════════════════════════════════

// ─── Local-storage keys (for reference by app.js) ───────────────
const FEEDBACK_KEYS = {
    ROUTINE_SAVED_AT:   'gg_routine_saved_at',
    CHECKIN_RESPONSES:  'gg_checkin_responses',
    DISMISSED_UNTIL:    'gg_checkin_dismissed_until',
    EXPERIENCE_LEVEL:   'gg_experience_level',
    ROUTINE_VERSION:    'gg_routine_version',
};

// ── Days until first check-in & subsequent reminders ──
const CHECKIN_INTERVALS = { first: 28, subsequent: 28 };

/**
 * Check whether a check-in is due.
 * @param {string|null} savedAt   ISO string of when routine was saved
 * @param {string|null} dismissedUntil  ISO string of snooze date
 * @returns {{ due: boolean, daysIn: number }}
 */
function isCheckinDue(savedAt, dismissedUntil = null) {
    if (!savedAt) return { due: false, daysIn: 0 };
    const daysIn = Math.floor((Date.now() - new Date(savedAt).getTime()) / 86400000);
    if (dismissedUntil && new Date(dismissedUntil).getTime() > Date.now()) {
        return { due: false, daysIn };
    }
    return { due: daysIn >= CHECKIN_INTERVALS.first, daysIn };
}

/**
 * Map a user's check-in response into actionable advice + UI variant.
 * @param {string} response  'much_better' | 'some_progress' | 'no_change' | 'got_worse'
 * @param {object} skinProfile  Current profile from ml_pipeline
 * @returns {{ type: string, headline: string, detail: string, action: string|null }}
 */
function getAdjustmentAdvice(response, skinProfile = {}) {
    const exp = skinProfile.experience || 'beginner';

    const nextLevel = (current) => {
        if (current === 'beginner')     return 'intermediate';
        if (current === 'intermediate') return 'advanced';
        return 'advanced';
    };

    switch (response) {
        case 'much_better':
            return {
                type: 'success',
                headline: '🎉 Great progress!',
                detail: exp !== 'advanced'
                    ? `Your skin is responding well. You're ready to graduate to the ${nextLevel(exp)} level — we can increase concentrations for faster results.`
                    : 'Your skin is thriving. Maintain your current routine and photograph your skin monthly to track progress.',
                action: exp !== 'advanced' ? 'upgrade_experience' : null,
                newExperience: exp !== 'advanced' ? nextLevel(exp) : exp,
            };

        case 'some_progress':
            return {
                type: 'info',
                headline: '🙂 You\'re on track!',
                detail: 'Give it another 4 weeks. Most actives take 8–12 weeks for full effect. Consistency matters more than any ingredient.',
                action: 'extend_checkin',
            };

        case 'no_change':
            return {
                type: 'warning',
                headline: '😐 No visible change yet.',
                detail: 'Consider adding a targeted treatment — Retinol for anti-aging, or Azelaic Acid for pigmentation. A dermatologist can also prescribe prescription-strength tretinoin for faster results.',
                action: 'add_treatment',
            };

        case 'got_worse':
            return {
                type: 'danger',
                headline: '⚠️ Stop and simplify.',
                detail: 'Stop ALL actives immediately. Revert to: gentle cleanser → light moisturizer → SPF (AM only). Wait 2 weeks for barrier recovery, then reintroduce one ingredient at a time. Consult a dermatologist if no improvement.',
                action: 'simplify_routine',
            };

        default:
            return null;
    }
}

/**
 * Based on prior responses, determine if experience level should be upgraded.
 * @param {Array<{response:string, date:string}>} history
 * @param {string} currentExperience
 * @returns {string} recommended experience level
 */
function computeExperienceProgression(history, currentExperience) {
    if (!history || history.length === 0) return currentExperience;

    const goodResponses = history.filter(r =>
        r.response === 'much_better' || r.response === 'some_progress'
    ).length;

    const badResponses = history.filter(r =>
        r.response === 'got_worse'
    ).length;

    if (badResponses > 0) return 'beginner';
    if (goodResponses >= 2 && currentExperience === 'beginner')     return 'intermediate';
    if (goodResponses >= 3 && currentExperience === 'intermediate') return 'advanced';
    return currentExperience;
}

/**
 * Build a short personal progress message for display in the hero card.
 * @param {Array} history
 * @returns {string|null}
 */
function buildProgressSummary(history) {
    if (!history || history.length === 0) return null;
    const latest = history[history.length - 1];
    const weeks = history.length * 4;
    const map = {
        much_better: `${weeks} weeks in — your skin is visibly improving. 🌟`,
        some_progress: `${weeks} weeks in — steady progress. Keep going. 💪`,
        no_change: `${weeks} weeks in — consider adding a targeted treatment.`,
        got_worse: `Routine was simplified after a reaction. Rebuild gradually.`,
    };
    return map[latest.response] || null;
}

module.exports = {
    FEEDBACK_KEYS,
    CHECKIN_INTERVALS,
    isCheckinDue,
    getAdjustmentAdvice,
    computeExperienceProgression,
    buildProgressSummary,
};
