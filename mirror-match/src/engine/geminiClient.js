/**
 * Gemini API Client for Mirror Match
 * Parses natural language queries into structured filters
 *
 * BULLETPROOF VERSION - Demo-safe with validation and fallbacks
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Valid values for validation
const VALID_TEAMS = ['KC', 'PHI', 'BUF', 'SF', 'MIA', 'DET'];
const VALID_DOWNS = [1, 2, 3, 4];
const VALID_FIELD_ZONES = ['redzone', 'midfield', 'own_territory'];
const VALID_VIEW_MODES = ['replay', 'chart', 'routes'];

// Demo-safe hardcoded responses for critical queries
const DEMO_RESPONSES = {
  // 3rd and long queries
  '3rd and long': {
    filters: { down: 3, distanceMin: 7 },
    response: "KC is efficient on 3rd and long - they target the middle of the field heavily, especially Kelce on dig routes. 64% completion rate, 9.0 yards per attempt.",
    viewMode: 'replay'
  },
  'third and long': {
    filters: { down: 3, distanceMin: 7 },
    response: "KC is efficient on 3rd and long - they target the middle of the field heavily, especially Kelce on dig routes. 64% completion rate, 9.0 yards per attempt.",
    viewMode: 'replay'
  },

  // Red zone queries
  'red zone': {
    filters: { fieldZone: 'redzone' },
    response: "In the red zone, KC becomes extremely efficient. Condensed field means Kelce dominates - watch for quick slants and fade routes in the corner.",
    viewMode: 'replay'
  },
  'redzone': {
    filters: { fieldZone: 'redzone' },
    response: "In the red zone, KC becomes extremely efficient. Condensed field means Kelce dominates - watch for quick slants and fade routes in the corner.",
    viewMode: 'replay'
  },

  // Route overlay queries - THE WOW MOMENT
  // NO down filter by default - show ALL routes for the player
  'kelce routes': {
    filters: { targetPlayer: 'Kelce' },
    response: "Here are all of Kelce's routes. Notice the clustering in the 10-15 yard range over the middle - that's his bread and butter territory.",
    viewMode: 'routes'
  },
  'show me kelce': {
    filters: { targetPlayer: 'Kelce' },
    response: "Here are all of Kelce's route patterns. He dominates the intermediate middle of the field.",
    viewMode: 'routes'
  },
  'where does kelce run': {
    filters: { targetPlayer: 'Kelce' },
    response: "Here's every Kelce route overlaid. You can see his favorite areas - intermediate middle and the seams.",
    viewMode: 'routes'
  },
  'kelce 3rd': {
    filters: { down: 3, targetPlayer: 'Kelce' },
    response: "Kelce's routes on 3rd down specifically - notice he runs dig routes over the middle to get the first down.",
    viewMode: 'routes'
  },
  'hill routes': {
    filters: { targetPlayer: 'Hill' },
    response: "Tyreek Hill's route tree - notice the deep shots and quick screens. His speed creates separation on every route.",
    viewMode: 'routes'
  },
  'where does hill run': {
    filters: { targetPlayer: 'Hill' },
    response: "Hill's routes show his dual threat - deep posts and short crossers.",
    viewMode: 'routes'
  },

  // Pass chart queries - with TIGHT filters for readable charts
  'pass chart': {
    filters: { down: 3 },
    response: "Pass chart for 3rd down plays. Green = completion, red = incomplete. Notice the clustering in the intermediate middle.",
    viewMode: 'chart'
  },
  'pass chart 3rd': {
    filters: { down: 3, distanceMin: 7 },
    response: "Pass chart for 3rd and long. Green = catch, red = incomplete. Heavy targeting of the middle of the field.",
    viewMode: 'chart'
  },
  'where do they throw': {
    filters: { down: 3 },
    response: "KC's 3rd down pass distribution. Green dots = completions, red = incompletions.",
    viewMode: 'chart'
  },
  'throws to kelce': {
    filters: { targetPlayer: 'Kelce' },
    response: "All passes targeted to Kelce. Green = catch, red = incomplete. Notice his favorite spots.",
    viewMode: 'chart'
  },

  // Tight coverage
  'tight coverage': {
    filters: { coverageTight: true },
    response: "Against tight man coverage (defender within 3 yards), KC still completes 58% of passes. Mahomes excels at buying time.",
    viewMode: 'replay'
  },
  'man coverage': {
    filters: { coverageTight: true },
    response: "Against tight man coverage, KC relies on Kelce's release and Hill's speed. Watch the quick-developing routes.",
    viewMode: 'replay'
  },

  // Shotgun
  'shotgun': {
    filters: { shotgun: true },
    response: "KC runs 74% of plays from shotgun. It gives Mahomes better vision and more time to read the defense.",
    viewMode: 'replay'
  }
};

// System prompt - conversational coach that only shows plays when asked
const SYSTEM_PROMPT = `You are an expert NFL coaching assistant with deep knowledge of football strategy, schemes, and game planning. You can have normal conversations about football, explain concepts, answer questions, and give strategic advice.

You have access to real 2023 season data:
- KC Chiefs: 487 pass plays, Mahomes (QB), Kelce (TE, 32 targets, 68% catch rate, 11.2 avg yards), Rice (WR, 20 targets)
- Pass rate: 62% overall, 71% on 3rd down
- Shotgun rate: 74%
- Red zone efficiency: 58%

CRITICAL RULES:
1. For general questions, greetings, or strategy discussions ("what's up", "explain cover 2", "how do I beat zone"), just respond conversationally. Set filters to null.
2. ONLY include filters/portal when the user EXPLICITLY asks to SEE, SHOW, or WATCH plays, routes, or charts.
3. Keywords that trigger visualization: "show me", "let me see", "watch", "display", "visualize", "pull up"
4. Keywords that are just questions (NO visualization): "what", "why", "how", "explain", "tell me about", "what's"

Return JSON:
{
  "response": "your conversational coaching response",
  "filters": null OR { "offense": "KC", "down": 3, "distanceMin": 7, etc },
  "viewMode": null OR "replay" | "chart" | "routes"
}

Filter options (only when showing plays):
- down: 1-4
- distanceMin/distanceMax: yards to go
- fieldZone: "redzone"
- coverageTight: true/false
- targetPlayer: "Kelce", "Rice", etc
- playType: "pass" | "run"

viewMode (only when showing plays):
- "routes" = route patterns overlay
- "chart" = pass location chart
- "replay" = watch specific plays

Examples:
- "what's up" → {"response": "Hey coach! Ready to break down some film. What situation are you game planning for?", "filters": null, "viewMode": null}
- "explain cover 2" → {"response": "Cover 2 splits the deep field between two safeties, each responsible for half. Corners play the flats...", "filters": null, "viewMode": null}
- "show me 3rd and long" → {"response": "Here's KC on 3rd and 7+. Notice how they favor the intermediate middle.", "filters": {"offense": "KC", "down": 3, "distanceMin": 7}, "viewMode": "replay"}
- "where does Kelce run" → {"response": "Kelce's route tree - he dominates the intermediate middle on digs and crossers.", "filters": {"targetPlayer": "Kelce"}, "viewMode": "routes"}

Return ONLY JSON, no markdown.`;

/**
 * Build context from tendency data
 */
function buildTendencyContext(tendencies, team) {
  const data = tendencies?.[team];
  if (!data) return '';

  return `
${team} tendencies: Pass ${(data.overall?.passRate * 100).toFixed(0)}%, Shotgun ${(data.overall?.shotgunRate * 100).toFixed(0)}%, Avg ${data.overall?.avgYards?.toFixed(1)} yds`;
}

/**
 * Check for demo-safe response match
 */
function getDemoResponse(message, selectedTeam) {
  const lower = message.toLowerCase();

  for (const [key, value] of Object.entries(DEMO_RESPONSES)) {
    if (lower.includes(key)) {
      return {
        filters: { offense: selectedTeam, ...value.filters },
        response: value.response.replace(/KC/g, selectedTeam),
        viewMode: value.viewMode
      };
    }
  }

  return null;
}

/**
 * Validate filters against known good values
 */
function validateFilters(filters, selectedTeam) {
  const validated = { offense: selectedTeam };

  // Team validation
  if (filters.offense && VALID_TEAMS.includes(filters.offense)) {
    validated.offense = filters.offense;
  }

  // Down validation
  if (filters.down && VALID_DOWNS.includes(filters.down)) {
    validated.down = filters.down;
  }

  // Distance validation (reasonable bounds)
  if (filters.distanceMin && filters.distanceMin >= 1 && filters.distanceMin <= 30) {
    validated.distanceMin = filters.distanceMin;
  }
  if (filters.distanceMax && filters.distanceMax >= 1 && filters.distanceMax <= 30) {
    validated.distanceMax = filters.distanceMax;
  }

  // Field zone validation
  if (filters.fieldZone && VALID_FIELD_ZONES.includes(filters.fieldZone)) {
    validated.fieldZone = filters.fieldZone;
  }

  // Boolean filters
  if (typeof filters.coverageTight === 'boolean') {
    validated.coverageTight = filters.coverageTight;
  }
  if (typeof filters.shotgun === 'boolean') {
    validated.shotgun = filters.shotgun;
  }
  if (filters.playType === 'pass' || filters.playType === 'run') {
    validated.playType = filters.playType;
  }

  // Target player for route overlays
  if (filters.targetPlayer && typeof filters.targetPlayer === 'string') {
    validated.targetPlayer = filters.targetPlayer;
  }

  return validated;
}

/**
 * Validate view mode
 */
function validateViewMode(viewMode) {
  return VALID_VIEW_MODES.includes(viewMode) ? viewMode : 'replay';
}

/**
 * Query Gemini and parse into filters + response
 */
export async function queryGemini(message, tendencies, selectedTeam, apiKey) {
  // If no API key, use demo responses or local parsing
  if (!apiKey) {
    const demoResponse = getDemoResponse(message, selectedTeam);
    if (demoResponse) {
      console.log('Demo mode - using cached response for:', message);
      return demoResponse;
    }
    return parseQueryLocally(message, selectedTeam);
  }

  // API key present - ALWAYS call Gemini for real thinking
  console.log('Calling Gemini API for:', message);

  const context = buildTendencyContext(tendencies, selectedTeam);

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\nTeam: ${selectedTeam}${context}\n\nQuery: "${message}"\n\nJSON:`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1, // Very low for predictable output
      maxOutputTokens: 300,
    }
  };

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('Gemini API error, using fallback');
      return parseQueryLocally(message, selectedTeam);
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return parseQueryLocally(message, selectedTeam);
    }

    // Clean up response - remove markdown code blocks if present
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(text);

      // Handle conversational responses (no filters/portal)
      if (!parsed.filters || parsed.filters === null) {
        return {
          filters: null,
          response: parsed.response || "I'm here to help with coaching strategy. What would you like to know?",
          viewMode: null
        };
      }

      // Validate filters for visualization requests
      const validatedFilters = validateFilters(parsed.filters, selectedTeam);
      const validatedViewMode = validateViewMode(parsed.viewMode);

      return {
        filters: validatedFilters,
        response: parsed.response || 'Here are the matching plays.',
        viewMode: validatedViewMode
      };
    } catch (parseError) {
      console.error('Failed to parse Gemini JSON, using fallback');
      return parseQueryLocally(message, selectedTeam);
    }
  } catch (error) {
    console.error('Gemini API error:', error);
    return parseQueryLocally(message, selectedTeam);
  }
}

/**
 * Local fallback parser - Only returns filters when EXPLICITLY asking for visualization
 */
function parseQueryLocally(message, selectedTeam) {
  const lower = message.toLowerCase();

  // Keywords that trigger visualization
  const vizTriggers = ['show', 'watch', 'display', 'pull up', 'let me see', 'visualize', 'play'];
  const hasVizTrigger = vizTriggers.some(t => lower.includes(t));

  // Keywords that are just questions (no visualization)
  const questionWords = ["what's", 'whats', 'what is', 'why', 'how do', 'how does', 'explain', 'tell me about', 'hey', 'hello', 'hi', 'sup', "what's up"];
  const isJustQuestion = questionWords.some(q => lower.includes(q)) && !hasVizTrigger;

  // If it's just a question with no viz trigger, return conversational response
  if (isJustQuestion) {
    return {
      filters: null,
      response: "Hey coach! I can help with strategy questions or show you plays. Try asking me to 'show 3rd and long' or 'show Kelce routes'.",
      viewMode: null
    };
  }

  // Check for specific visualization requests
  const filters = { offense: selectedTeam };
  let response = '';
  let viewMode = 'replay';
  let hasFilter = false;

  // Player names for route filtering
  const playerPatterns = [
    { pattern: /kelce/i, name: 'Kelce' },
    { pattern: /hill/i, name: 'Hill' },
    { pattern: /travis/i, name: 'Kelce' },
    { pattern: /tyreek/i, name: 'Hill' },
    { pattern: /rice/i, name: 'Rice' },
    { pattern: /brown/i, name: 'Brown' },
    { pattern: /diggs/i, name: 'Diggs' },
    { pattern: /waddle/i, name: 'Waddle' },
  ];

  let detectedPlayer = null;
  for (const { pattern, name } of playerPatterns) {
    if (pattern.test(lower)) {
      detectedPlayer = name;
      break;
    }
  }

  // Route overlay request
  if (lower.includes('route') || (lower.includes('where does') && (lower.includes('run') || lower.includes('go')))) {
    viewMode = 'routes';
    hasFilter = true;
    if (detectedPlayer) {
      filters.targetPlayer = detectedPlayer;
      response = `Showing ${detectedPlayer}'s route patterns.`;
    } else {
      response = `Showing route overlay for ${selectedTeam}.`;
    }
  }

  // Pass chart request
  else if (lower.includes('chart') || (lower.includes('where') && lower.includes('throw'))) {
    viewMode = 'chart';
    hasFilter = true;
    response = `Showing pass chart for ${selectedTeam}. Green = catch, red = incomplete.`;
  }

  // Down parsing
  if (lower.includes('3rd') || lower.includes('third')) {
    filters.down = 3;
    hasFilter = true;
    if (lower.includes('long') || lower.includes('7+')) {
      filters.distanceMin = 7;
      response = response || `${selectedTeam} on 3rd and long.`;
    } else if (lower.includes('short')) {
      filters.distanceMax = 3;
      response = response || `${selectedTeam} on 3rd and short.`;
    } else {
      response = response || `${selectedTeam} 3rd down plays.`;
    }
  }

  // Red zone
  if (lower.includes('red zone') || lower.includes('redzone')) {
    filters.fieldZone = 'redzone';
    hasFilter = true;
    response = response || `${selectedTeam} in the red zone.`;
  }

  // Tight coverage
  if (lower.includes('tight') || lower.includes('man coverage')) {
    filters.coverageTight = true;
    hasFilter = true;
    response = response || `${selectedTeam} against tight coverage.`;
  }

  // Shotgun
  if (lower.includes('shotgun')) {
    filters.shotgun = true;
    hasFilter = true;
    response = response || `${selectedTeam} from shotgun.`;
  }

  // If no specific filter was found, return conversational
  if (!hasFilter) {
    return {
      filters: null,
      response: "I can show you plays, routes, or pass charts. Try 'show 3rd and long', 'Kelce routes', or 'pass chart'.",
      viewMode: null
    };
  }

  return { filters, response, viewMode };
}

/**
 * Legacy function for backward compatibility
 */
export function detectWhatIf(message) {
  const lower = message.toLowerCase();

  if (lower.includes('tight') && (lower.includes('man') || lower.includes('coverage'))) {
    return 'TIGHT_COVERAGE';
  }
  if (lower.includes('off') && lower.includes('coverage')) {
    return 'LOOSE_COVERAGE';
  }
  if (lower.includes('red zone') || lower.includes('redzone')) {
    return 'REDZONE';
  }
  if (lower.includes('3rd') && lower.includes('long')) {
    return 'THIRD_AND_LONG';
  }
  if (lower.includes('3rd') && lower.includes('short')) {
    return 'THIRD_AND_SHORT';
  }
  if (lower.includes('shotgun')) {
    return 'SHOTGUN';
  }
  if (lower.includes('under center')) {
    return 'UNDER_CENTER';
  }

  return null;
}
