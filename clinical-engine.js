'use strict';
// ══════════════════════════════════════════════════════════════════
// GlowGuide Clinical Recommendation Engine — Layer 2
// ══════════════════════════════════════════════════════════════════

const ingredientsDb = require('./data/ingredients-clinical.json');

// ── Step ordering for routine construction ──
const STEP_ORDER = {
    cleanser: 1,
    exfoliant_toner: 2,
    essence: 3,
    serum: 4,
    treatment_serum: 5,
    serum_or_moisturizer: 4,
    eye_cream: 6,
    spot_treatment: 7,
    moisturizer: 8,
    face_oil: 9,
    spf: 10,
};

const STEP_NAMES = {
    cleanser: 'Cleanser',
    exfoliant_toner: 'Exfoliate / Tone',
    essence: 'Essence',
    serum: 'Serum',
    treatment_serum: 'Treatment Serum',
    serum_or_moisturizer: 'Serum / Moisturizer',
    eye_cream: 'Eye Cream',
    spot_treatment: 'Spot Treatment',
    moisturizer: 'Moisturizer',
    face_oil: 'Face Oil',
    spf: 'SPF Sunscreen',
};

// ── Severity label ──
function severityLabel(score) {
    if (score >= 0.7) return 'severe';
    if (score >= 0.4) return 'moderate';
    return 'mild';
}

// ── Step utilities ──
function getStepNumber(stepKey) {
    return STEP_ORDER[stepKey] || 5;
}
function getStepName(stepKey) {
    return STEP_NAMES[stepKey] || stepKey.replace(/_/g, ' ');
}

// ── Concentration for experience level ──
function getConcentrationForExperience(ingredientKey, experience = 'beginner') {
    const ing = ingredientsDb[ingredientKey];
    if (!ing) return null;
    const gates = ing.experience_gates;
    if (!gates) return null;
    return gates[experience] || gates['beginner'] || null;
}

// ── Interaction checker ──
function checkInteractions(selectedIngredients) {
    const warnings = [];
    for (const ingName of selectedIngredients) {
        const ing = ingredientsDb[ingName];
        if (!ing) continue;
        const conflicts = ing.do_not_combine_same_step || [];
        for (const conflict of conflicts) {
            if (selectedIngredients.includes(conflict)) {
                const dup = warnings.some(
                    w => (w.ingredient1 === ingName && w.ingredient2 === conflict) ||
                         (w.ingredient1 === conflict && w.ingredient2 === ingName)
                );
                if (!dup) {
                    warnings.push({
                        ingredient1: ingName,
                        ingredient2: conflict,
                        fix: `Do not apply ${ingName} and ${conflict} in the same step. Separate AM/PM, or wait 20–30 min between applications.`,
                    });
                }
            }
        }
    }
    return warnings;
}

// ── Build routine steps from selected ingredients ──
function buildRoutineFromIngredients(selectedIngredients, skinProfile) {
    const experience = skinProfile.experience || 'beginner';
    const morningBuckets = {};
    const eveningBuckets = {};

    for (const ingName of selectedIngredients) {
        const ing = ingredientsDb[ingName];
        if (!ing) continue;
        const timing = ing.routine_timing || ['morning', 'evening'];
        const step = ing.routine_step || 'serum';

        const addTo = (bucket) => {
            if (!bucket[step]) bucket[step] = [];
            if (!bucket[step].includes(ingName)) bucket[step].push(ingName);
        };

        if (timing.includes('morning') || timing.includes('morning_only')) {
            addTo(morningBuckets);
        }
        if (timing.includes('evening') || timing.includes('evening_only')) {
            addTo(eveningBuckets);
        }
        if (timing.includes('evening') && !timing.includes('morning_only')) {
            addTo(eveningBuckets);
        }
    }

    // Always include SPF step in morning (placeholder)
    if (!morningBuckets['spf']) {
        morningBuckets['spf'] = ['Zinc Oxide'];
    }
    // Always include cleanser step both routines
    if (!morningBuckets['cleanser']) morningBuckets['cleanser'] = ['face wash'];
    if (!eveningBuckets['cleanser']) eveningBuckets['cleanser'] = ['face wash'];
    // Always include moisturizer in evening
    if (!eveningBuckets['moisturizer'] && !eveningBuckets['serum_or_moisturizer']) {
        eveningBuckets['moisturizer'] = ['Ceramides'];
    }

    const buildStepArray = (buckets) => {
        return Object.entries(buckets)
            .sort((a, b) => getStepNumber(a[0]) - getStepNumber(b[0]))
            .map(([stepKey, ingredients], idx) => {
                const primaryIngredient = ingredients[0];
                const ing = ingredientsDb[primaryIngredient];
                return {
                    stepNumber: idx + 1,
                    stepKey,
                    stepName: getStepName(stepKey),
                    ingredients,
                    primaryIngredient,
                    concentration: ing ? getConcentrationForExperience(primaryIngredient, experience) : null,
                    mechanism: ing ? ing.mechanism : null,
                    approvedClaims: ing ? (ing.approved_claims || []) : [],
                };
            });
    };

    return {
        morning: buildStepArray(morningBuckets),
        evening: buildStepArray(eveningBuckets),
        morningCount: Object.keys(morningBuckets).length,
        eveningCount: Object.keys(eveningBuckets).length,
    };
}

// ── Evidence summary for a single ingredient ──
function buildEvidenceSummary(ingredientKey) {
    const ing = ingredientsDb[ingredientKey];
    if (!ing) return null;
    return {
        name: ingredientKey,
        cosing_ref: ing.cosing_ref || null,
        pubchem_cid: ing.pubchem_cid || null,
        eu_approved: ing.eu_approved !== false,
        eu_max_concentration: ing.eu_max_concentration_face || 'no regulatory limit',
        incidecoder_score: ing.incidecoder_score || null,
        mechanism: ing.mechanism || '',
        clinical_studies: ing.clinical_studies || [],
        approved_claims: ing.approved_claims || [],
        pregnancy_safe: ing.pregnancy_safe || null,
        contraindications: ing.contraindications || [],
        cosdna_acne_score: ing.cosdna_acne_score,
        cosdna_irritant_score: ing.cosdna_irritant_score,
        comedogenic_rating: ing.comedogenic_rating,
    };
}

// ── Core recommendation builder ──
function buildRecommendation(skinProfile) {
    const conditions = [];
    if ((skinProfile.acne || 0) > 0.3)        conditions.push('acne');
    if ((skinProfile.pigmentation || 0) > 0.3) conditions.push('pigmentation');
    if ((skinProfile.wrinkles || 0) > 0.3)     conditions.push('wrinkles');
    if ((skinProfile.pores || 0) > 0.3)        conditions.push('pores');
    const type = skinProfile.skinType || 'normal';
    if (type === 'dry' || type === 'very_dry')  conditions.push('dryness');
    if (type === 'oily')                        conditions.push('oily');
    if (type === 'sensitive')                   conditions.push('sensitive');
    if (conditions.length === 0)               conditions.push('all_types');

    const experience = skinProfile.experience || 'beginner';
    const overallSeverity = skinProfile.overallSeverity || 0.3;
    const severity = severityLabel(overallSeverity);

    // Score each ingredient by relevance to profile
    const scored = Object.entries(ingredientsDb).map(([name, ing]) => {
        let score = 0;
        const uses = ing.use_for_conditions || [];

        for (const cond of conditions) {
            if (uses.includes(cond)) score += 10;
        }
        // Penalize SPF filters unless we specifically add them later
        if (ing.routine_step === 'spf') score -= 5;

        // Penalize high irritancy for beginners
        if (experience === 'beginner') {
            score -= (ing.cosdna_irritant_score || 0) * 4;
        }
        // Penalize comedogenic for acne-prone
        if (conditions.includes('acne')) {
            score -= (ing.comedogenic_rating || 0) * 6;
        }
        // Avoid completely for skin type
        const avoid = ing.avoid_for_skin_types || [];
        if (avoid.includes(type)) score -= 25;
        // Penalize not-for-beginners
        if (ing.not_for_beginners && experience === 'beginner') score -= 20;

        return { name, score, ing };
    })
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score);

    // Limit by experience level
    const maxIngredients = experience === 'beginner' ? 6 :
                           experience === 'intermediate' ? 9 : 13;
    const selected = scored.slice(0, maxIngredients).map(i => i.name);

    // Ensure Ceramides / HA always present (foundational)
    if (!selected.includes('Ceramides'))        selected.push('Ceramides');
    if (!selected.includes('Hyaluronic Acid'))  selected.push('Hyaluronic Acid');

    const routine = buildRoutineFromIngredients(selected, skinProfile);
    const interactions = checkInteractions(selected);

    // Build avoid list (comedogenic or irritating for the profile)
    const avoidList = Object.entries(ingredientsDb)
        .filter(([, ing]) => {
            if (conditions.includes('acne') && (ing.comedogenic_rating || 0) >= 3) return true;
            if (experience === 'beginner' && (ing.cosdna_irritant_score || 0) >= 3) return true;
            const avoid = ing.avoid_for_skin_types || [];
            if (avoid.includes(type)) return true;
            return false;
        })
        .slice(0, 10)
        .map(([name]) => name);

    // Good ingredients (relevant but not necessarily selected – "look for these")
    const goodList = scored.slice(0, 18).map(i => i.name);

    // Evidence block for selected
    const evidenceMap = {};
    for (const name of selected) {
        evidenceMap[name] = buildEvidenceSummary(name);
    }

    return {
        selectedIngredients: selected,
        routine,
        interactions,
        avoidList,
        goodList,
        severity,
        overallSeverity,
        conditions,
        experience,
        skinType: type,
        evidenceMap,
    };
}

module.exports = {
    buildRecommendation,
    checkInteractions,
    buildRoutineFromIngredients,
    getConcentrationForExperience,
    buildEvidenceSummary,
    severityLabel,
    getStepNumber,
    getStepName,
    ingredientsDb,
};
