/**
 * Gemini API Client for Mirror Match
 * Handles natural language queries about NFL tendencies
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// System prompt for the AI coach
const SYSTEM_PROMPT = `You are an expert NFL coaching assistant analyzing team tendencies. You have access to real 2025 season data for the Kansas City Chiefs (KC) and Philadelphia Eagles (PHI).

When answering questions:
1. Be concise and data-driven (1-3 sentences max)
2. Reference specific percentages and statistics when available
3. Focus on actionable coaching insights
4. For "what if" scenarios, explain how the defense adjustment would likely affect the offense

Current tendency data is provided in the context. Use it to give accurate, specific answers.`;

/**
 * Build context from tendency data
 */
function buildTendencyContext(tendencies, team) {
  const data = tendencies?.[team];
  if (!data) return '';

  return `
${team} 2025 Season Tendencies:
- Total plays analyzed: ${data.totalPlays}
- Overall pass rate: ${(data.overall.passRate * 100).toFixed(0)}%
- Overall run rate: ${(data.overall.runRate * 100).toFixed(0)}%
- Shotgun usage: ${(data.overall.shotgunRate * 100).toFixed(0)}%
- Average yards per play: ${data.overall.avgYards}
- Pass average: ${data.overall.passAvgYards} yards
- Run average: ${data.overall.runAvgYards} yards
- Pass direction: Left ${(data.overall.passLeft * 100).toFixed(0)}%, Middle ${(data.overall.passMiddle * 100).toFixed(0)}%, Right ${(data.overall.passRight * 100).toFixed(0)}%

3rd Down Tendencies:
- Short (1-3 yds): ${data.thirdDown?.short ? (data.thirdDown.short.passRate * 100).toFixed(0) + '% pass' : 'N/A'}
- Medium (4-7 yds): ${data.thirdDown?.medium ? (data.thirdDown.medium.passRate * 100).toFixed(0) + '% pass' : 'N/A'}
- Long (8+ yds): ${data.thirdDown?.long ? (data.thirdDown.long.passRate * 100).toFixed(0) + '% pass' : 'N/A'}

By Down:
${Object.entries(data.byDown || {}).map(([down, stats]) =>
  `- ${down}${getOrdinal(parseInt(down))} down: ${(stats.passRate * 100).toFixed(0)}% pass, ${stats.avgYards} avg yards`
).join('\n')}
`;
}

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Query Gemini API with tendency context
 */
export async function queryGemini(message, tendencies, selectedTeam, apiKey) {
  if (!apiKey) {
    throw new Error('Gemini API key is required');
  }

  const context = buildTendencyContext(tendencies, selectedTeam);

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\n${context}\n\nUser question: ${message}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 256,
      topP: 0.9,
    }
  };

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API request failed');
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No response from Gemini');
    }

    return text;
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

/**
 * Parse structured response for play selection (future enhancement)
 */
export function parsePlayQuery(response) {
  // Could extract structured data like:
  // - down, distance
  // - formation filter
  // - play type preference
  // For now, just return the text response
  return {
    narration: response,
    query: null,
  };
}

/**
 * What-If Engine - Defensive adjustment multipliers
 */
const WHAT_IF_ADJUSTMENTS = {
  'A_GAP_BLITZ': {
    label: 'A-Gap Blitz',
    description: 'Interior pressure forces quick throws',
    multipliers: {
      completionPct: 0.80,   // drops ~20%
      avgYards: 0.57,        // drops ~43%
      sackRate: 2.0,         // doubles
      passRate: 1.05,        // slightly more pass (hot routes)
    }
  },
  'COVER_2': {
    label: 'Cover 2',
    description: 'Two-deep safeties take away deep shots',
    multipliers: {
      passRight: 0.7,
      passLeft: 0.7,
      passMid: 1.4,
      avgYards: 0.85,
      completionPct: 1.05,
    }
  },
  'COVER_3': {
    label: 'Cover 3',
    description: 'Three-deep zone limits big plays',
    multipliers: {
      avgYards: 0.80,
      completionPct: 1.0,
      passRate: 0.95,
    }
  },
  'MAN_COVERAGE': {
    label: 'Man Coverage',
    description: 'Tight coverage on all receivers',
    multipliers: {
      completionPct: 0.85,
      avgYards: 0.9,
      sackRate: 1.3,
    }
  },
  'BLITZ': {
    label: 'Blitz',
    description: 'Extra pass rushers create pressure',
    multipliers: {
      completionPct: 0.82,
      avgYards: 0.65,
      sackRate: 1.8,
    }
  },
  'SPY': {
    label: 'QB Spy',
    description: 'Defender shadows the quarterback',
    multipliers: {
      rushYards: 0.7,
      scrambleRate: 0.5,
    }
  }
};

/**
 * Detect what-if adjustment from user query
 */
export function detectWhatIf(message) {
  const lower = message.toLowerCase();

  if (!lower.includes('what if') && !lower.includes('if i') && !lower.includes('if we')) {
    return null;
  }

  // Check for specific adjustments
  if (lower.includes('a gap') || lower.includes('a-gap')) {
    return 'A_GAP_BLITZ';
  }
  if (lower.includes('cover 2') || lower.includes('cover-2') || lower.includes('cover two')) {
    return 'COVER_2';
  }
  if (lower.includes('cover 3') || lower.includes('cover-3') || lower.includes('cover three')) {
    return 'COVER_3';
  }
  if (lower.includes('man') && (lower.includes('coverage') || lower.includes('to man'))) {
    return 'MAN_COVERAGE';
  }
  if (lower.includes('blitz')) {
    return 'BLITZ';
  }
  if (lower.includes('spy')) {
    return 'SPY';
  }

  // Generic blitz/pressure detection
  if (lower.includes('pressure') || lower.includes('rush')) {
    return 'BLITZ';
  }

  return null;
}

/**
 * Apply what-if adjustment to base tendencies
 */
export function applyWhatIf(baseTendencies, adjustmentKey) {
  const adjustment = WHAT_IF_ADJUSTMENTS[adjustmentKey];
  if (!adjustment || !baseTendencies) return null;

  const adjusted = { ...baseTendencies };
  const deltas = {};

  for (const [key, multiplier] of Object.entries(adjustment.multipliers)) {
    if (typeof adjusted[key] === 'number') {
      const original = adjusted[key];
      adjusted[key] = parseFloat((original * multiplier).toFixed(3));
      deltas[key] = {
        original,
        adjusted: adjusted[key],
        change: adjusted[key] - original,
        percentChange: ((multiplier - 1) * 100).toFixed(0),
      };
    }
  }

  return {
    adjustment,
    adjusted,
    deltas,
  };
}

/**
 * Get adjustment info by key
 */
export function getAdjustmentInfo(adjustmentKey) {
  return WHAT_IF_ADJUSTMENTS[adjustmentKey] || null;
}
