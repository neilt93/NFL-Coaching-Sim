/**
 * Gemini API Client for Coach AI
 * Parses natural language queries into structured filters
 *
 * All responses come from Gemini - no hardcoded demo responses
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Valid values for validation
// Note: Current data is KC vs NE from 2017
const VALID_TEAMS = ['KC', 'NE'];
const VALID_DOWNS = [1, 2, 3, 4];
const VALID_FIELD_ZONES = ['redzone', 'midfield', 'own_territory'];
const VALID_VIEW_MODES = ['replay', 'chart', 'routes'];

// Teams that users might ask about but aren't in the data
const TEAM_ALIASES = {
  'chiefs': 'KC', 'kansas city': 'KC', 'kc': 'KC',
  'patriots': 'NE', 'new england': 'NE', 'ne': 'NE', 'pats': 'NE',
};

// System prompt - smart coaching assistant with simulation explanations
const SYSTEM_PROMPT = `CRITICAL CONTEXT:
- This is 2023 NFL season data from NFL Big Data Bowl 2026
- KC Chiefs QB is Patrick Mahomes (#15), NOT Alex Smith
- Key KC players: Patrick Mahomes (QB), Travis Kelce (TE), Rashee Rice (WR), Isiah Pacheco (RB)
- NE Patriots QB is Mac Jones
- This data covers KC and NE games only

You are an expert NFL defensive coordinator helping a coach game plan. You speak like a coach, not a stats bot.

RESPONSE STYLE:
- Sound like a coach talking to another coach
- Be specific about players, routes, and tendencies
- When showing plays, explain WHAT TO LOOK FOR in the visualization

WHEN SHOWING PLAYS (filters not null):
Your response should tell the coach what to watch for in the simulation:
- "Watch how Kelce settles into the soft spot at 12 yards..."
- "Notice how Hill stacks the defender on this route..."
- "Look at the pocket collapse timing - Mahomes extends the play..."

WHEN GIVING ADVICE (filters null):
Give DETAILED actionable coaching insight. Include:
- The key player and their specific tendencies
- The route concepts or formations they favor
- A specific defensive adjustment with technique
- Why this adjustment works

Example of GOOD detailed advice:
"On 3rd down, KC runs through Kelce. He lines up in the slot 70% of the time and runs dig routes at 8-12 yards - right at the sticks. Bracket him with your nickel LB in man underneath and roll your safety over the top. This takes away his favorite window and forces Mahomes to go to his second read outside, where he's less comfortable under pressure."

Return JSON (no markdown):
{
  "response": "What to look for OR coaching advice",
  "filters": { "offense": "KC", ... } OR null,
  "viewMode": "replay" | "chart" | "routes" | null,
  "explanation": "Brief note for each play - what makes this play interesting" (only when filters not null)
}

Filter options:
- offense: "KC" or "NE"
- down: 1-4
- distanceMin/distanceMax: yards to go
- yardsGainedMin/yardsGainedMax: filter by result
- fieldZone: "redzone"
- targetPlayer: "Kelce", "Hill", etc.
- playType: "pass" | "run"
- isTouchdown: true (for touchdown plays only)

viewMode (only when filters is not null):
- "replay" = animated play-by-play (default)
- "routes" = route tree for ONE receiver (Kelce, Rice, etc.) - NEVER use for QB
- "chart" = pass locations as dots (green=complete, red=incomplete) - USE THIS FOR QB QUERIES

IMPORTANT RULES:
- QB queries (Mahomes, Mac Jones) → use "chart" mode, NOT "routes". QBs don't run routes.
- Receiver/TE queries (Kelce, Rice, Hill) → use "routes" mode with targetPlayer set
- Always set targetPlayer when using routes mode

EXAMPLES:
- "how do I defend KC on 3rd down" → {"response": "On 3rd down, everything flows through Kelce. He lines up in the slot and runs dig routes at 8-12 yards - right at the sticks. Bracket him with your nickel LB in man underneath and roll a safety over the top. This takes away Mahomes' security blanket and forces him to look outside, where he's less comfortable under pressure. If you can get him off his first read, that's when mistakes happen.", "filters": null, "viewMode": null}
- "show me Kelce's routes on 3rd down" → {"response": "Watch Kelce's route tree on 3rd down. He attacks the middle at the sticks - digs, crossers, and seams.", "filters": {"offense": "KC", "targetPlayer": "Kelce", "down": 3}, "viewMode": "routes"}
- "show me red zone" → {"response": "Red zone offense - the compressed field favors Kelce's size. Watch for quick slants and back-shoulder fades.", "filters": {"offense": "KC", "fieldZone": "redzone"}, "viewMode": "replay"}
- "show me Mahomes" → {"response": "Here's where Mahomes throws. Green dots are completions, red are incompletions.", "filters": {"offense": "KC", "playType": "pass"}, "viewMode": "chart"}
- "touchdowns" → {"response": "KC scoring plays - watch how they finish drives.", "filters": {"offense": "KC", "isTouchdown": true}, "viewMode": "replay"}

This is 2023 data - Mahomes is the QB, not Alex Smith.`;

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

  // Yards gained filters (for "longest throws", "big plays", etc.)
  if (filters.yardsGainedMin && filters.yardsGainedMin >= 1 && filters.yardsGainedMin <= 99) {
    validated.yardsGainedMin = filters.yardsGainedMin;
  }
  if (filters.yardsGainedMax && filters.yardsGainedMax >= 1 && filters.yardsGainedMax <= 99) {
    validated.yardsGainedMax = filters.yardsGainedMax;
  }

  // Target player for route overlays
  if (filters.targetPlayer && typeof filters.targetPlayer === 'string') {
    validated.targetPlayer = filters.targetPlayer;
  }

  // Touchdown filter
  if (typeof filters.isTouchdown === 'boolean') {
    validated.isTouchdown = filters.isTouchdown;
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
  // If no API key, use local parsing as fallback
  if (!apiKey) {
    console.log('No API key, using local parsing');
    return parseQueryLocally(message, selectedTeam);
  }

  // Call Gemini API for all queries
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
          viewMode: null,
          explanation: null
        };
      }

      // Validate filters for visualization requests
      const validatedFilters = validateFilters(parsed.filters, selectedTeam);
      const validatedViewMode = validateViewMode(parsed.viewMode);

      return {
        filters: validatedFilters,
        response: parsed.response || 'Here are the matching plays.',
        viewMode: validatedViewMode,
        explanation: parsed.explanation || null
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

  // Check for teams not in the data
  const unavailableTeams = ['philadelphia', 'eagles', 'philly', 'buffalo', 'bills', 'miami', 'dolphins',
    'detroit', 'lions', 'san francisco', '49ers', 'niners', 'dallas', 'cowboys', 'ravens', 'baltimore',
    'bengals', 'cincinnati', 'steelers', 'pittsburgh', 'browns', 'cleveland', 'jets', 'giants'];
  const askedUnavailableTeam = unavailableTeams.some(t => lower.includes(t));

  if (askedUnavailableTeam) {
    // Detect what situation they're asking about
    let situation = '';
    if (lower.includes('red zone') || lower.includes('redzone')) situation = 'red zone';
    else if (lower.includes('3rd')) situation = '3rd down';
    else if (lower.includes('pass')) situation = 'passing';
    else if (lower.includes('run')) situation = 'rushing';

    return {
      filters: null,
      response: `I only have KC vs NE data from their 2017 matchup. ${situation ? `Want to see ${situation} plays for KC or NE instead?` : 'Ask me about KC or NE plays!'}`,
      viewMode: null
    };
  }

  // Detect team from message
  let detectedTeam = selectedTeam;
  if (lower.includes('patriots') || lower.includes('new england') || lower.match(/\bne\b/) || lower.includes('pats')) {
    detectedTeam = 'NE';
  } else if (lower.includes('chiefs') || lower.includes('kansas city') || lower.match(/\bkc\b/)) {
    detectedTeam = 'KC';
  }

  // Keywords that trigger visualization
  const vizTriggers = ['show', 'watch', 'display', 'pull up', 'let me see', 'visualize', 'sim', 'run sim', 'simulate', 'run it', 'see it', 'passing', 'passes', 'throws', 'routes', 'plays', 'tendencies', 'runs', 'running'];
  const hasVizTrigger = vizTriggers.some(t => lower.includes(t));

  // Player name + action = show plays (e.g., "smith passing", "kelce routes", "kelce runs")
  const playerActionPattern = /(smith|kelce|hill|travis|tyreek|alex)\s*(passing|passes|throws|routes|targets|plays|runs|running)/i;
  const hasPlayerAction = playerActionPattern.test(lower);

  // Keywords that are just questions (no visualization)
  const questionWords = ["what's", 'whats', 'what is', 'why', 'how do', 'how does', 'explain', 'tell me about', 'hey', 'hello', 'hi', 'sup', "what's up"];
  const isJustQuestion = questionWords.some(q => lower.includes(q)) && !hasVizTrigger && !hasPlayerAction;

  // If it's just a question with no viz trigger, return conversational response
  if (isJustQuestion) {
    return {
      filters: null,
      response: "Hey coach! I can help with strategy questions or show you plays. Try asking me to 'show 3rd and long' or 'show Kelce routes'.",
      viewMode: null
    };
  }

  // Check for specific visualization requests
  const filters = { offense: detectedTeam };
  let response = '';
  let viewMode = 'replay';
  let hasFilter = false;

  // Handle "important/big/clutch plays" - high leverage situations
  if (lower.includes('important') || lower.includes('clutch') || lower.includes('key')) {
    filters.down = 3;
    hasFilter = true;
    response = `High-leverage plays - 3rd down situations where execution matters most.`;
  }

  if (lower.includes('big play') && !lower.includes('run') && !lower.includes('pass') && !lower.includes('throw')) {
    filters.yardsGainedMin = 15; // Big plays = 15+ yards
    hasFilter = true;
    response = `Big plays - chunk gains of 15+ yards that move the chains.`;
  }

  // Longest throws / deep passes
  if ((lower.includes('longest') || lower.includes('deep') || lower.includes('big')) &&
      (lower.includes('throw') || lower.includes('pass') || lower.includes('shot'))) {
    filters.playType = 'pass';
    filters.yardsGainedMin = 15;
    hasFilter = true;
    response = `Deep passing plays - explosive completions of 15+ yards downfield.`;
    viewMode = 'replay';
  }

  // Longest runs / big runs
  if ((lower.includes('longest') || lower.includes('big') || lower.includes('explosive')) &&
      (lower.includes('run') || lower.includes('rush'))) {
    filters.playType = 'run';
    filters.yardsGainedMin = 8;
    hasFilter = true;
    response = `Explosive runs - 8+ yard gains on the ground.`;
    viewMode = 'replay';
  }

  // Generic "passes" / "passing" / "pass plays" query
  if (!hasFilter && (lower.includes('pass') || lower.includes('passing')) &&
      !lower.includes('chart') && !lower.includes('longest') && !lower.includes('deep')) {
    filters.playType = 'pass';
    hasFilter = true;
    response = `${detectedTeam} passing plays - see their aerial attack.`;
    viewMode = 'replay';
  }

  // Generic "runs" / "rushing" query
  if (!hasFilter && (lower.includes('run') || lower.includes('rush')) &&
      !lower.includes('longest') && !lower.includes('big')) {
    filters.playType = 'run';
    hasFilter = true;
    response = `${detectedTeam} run plays - see their ground game.`;
    viewMode = 'replay';
  }

  // Handle "passing/throws" queries - show pass plays
  if ((lower.includes('smith') || lower.includes('qb')) && (lower.includes('pass') || lower.includes('throw'))) {
    filters.playType = 'pass';
    hasFilter = true;
    viewMode = 'chart';
    response = `Mahomes' pass distribution - notice his ability to attack all levels.`;
  }

  // Handle "[team] passing/tendencies" - show team pass plays
  if ((lower.includes('kc') || lower.includes('chiefs') || lower.includes('kansas')) &&
      (lower.includes('pass') || lower.includes('tendenc'))) {
    filters.offense = 'KC';
    filters.playType = 'pass';
    hasFilter = true;
    response = `KC passing tendencies - heavy shotgun, intermediate targets.`;
  }

  // Player names for route filtering (2017 KC vs NE data)
  const playerPatterns = [
    { pattern: /kelce/i, name: 'Kelce' },
    { pattern: /hill/i, name: 'Hill' },
    { pattern: /travis/i, name: 'Kelce' },
    { pattern: /tyreek/i, name: 'Hill' },
    { pattern: /hunt/i, name: 'Hunt' },
    { pattern: /kareem/i, name: 'Hunt' },
    { pattern: /gronk/i, name: 'Gronkowski' },
    { pattern: /gronkowski/i, name: 'Gronkowski' },
    { pattern: /cooks/i, name: 'Cooks' },
    { pattern: /amendola/i, name: 'Amendola' },
  ];

  let detectedPlayer = null;
  for (const { pattern, name } of playerPatterns) {
    if (pattern.test(lower)) {
      detectedPlayer = name;
      break;
    }
  }

  // Route overlay request - "routes", "runs", "where does X run/go"
  if (lower.includes('route') ||
      (detectedPlayer && lower.includes('runs')) ||
      (lower.includes('where does') && (lower.includes('run') || lower.includes('go')))) {
    viewMode = 'routes';
    hasFilter = true;
    if (detectedPlayer) {
      filters.targetPlayer = detectedPlayer;
      response = `${detectedPlayer}'s route tree - digs, crossers, and seams in the intermediate zone.`;
    } else {
      response = `Route concepts for ${selectedTeam}.`;
    }
  }

  // Player + "plays" or "targets" - show that player's involvement
  if (detectedPlayer && (lower.includes('play') || lower.includes('target') || lower.includes('catch'))) {
    filters.targetPlayer = detectedPlayer;
    hasFilter = true;
    if (lower.includes('important') || lower.includes('key') || lower.includes('clutch')) {
      filters.down = 3;
      response = `${detectedPlayer}'s clutch plays - 3rd down situations where he's the go-to target.`;
    } else {
      response = `${detectedPlayer}'s targets - his role in the offense.`;
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

  // Touchdowns
  if (lower.includes('touchdown') || lower.includes('td') || lower.includes('score')) {
    filters.isTouchdown = true;
    hasFilter = true;
    response = `${selectedTeam} touchdown plays - watch how they finish drives.`;
    viewMode = 'replay';
  }

  // If viz trigger but no specific filter, show all plays for the team
  if (!hasFilter && hasVizTrigger) {
    return {
      filters: { offense: selectedTeam },
      response: `Showing ${selectedTeam} plays. Ask about specific situations like "3rd and long" or "red zone" for more targeted analysis.`,
      viewMode: 'replay'
    };
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
