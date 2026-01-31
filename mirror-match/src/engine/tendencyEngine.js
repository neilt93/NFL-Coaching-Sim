/**
 * Tendency Engine - Real data filtering for what-if scenarios
 *
 * Instead of heuristic multipliers, we filter the actual play data
 * and recompute stats from real subsets.
 */

/**
 * Filter plays by criteria
 */
export function filterPlays(plays, filters = {}) {
  return plays.filter(play => {
    // Down filter
    if (filters.down && play.down !== filters.down) return false;

    // Distance filter (range)
    if (filters.distanceMin && play.yardsToGo < filters.distanceMin) return false;
    if (filters.distanceMax && play.yardsToGo > filters.distanceMax) return false;

    // Field zone filter
    if (filters.fieldZone && play.fieldZone !== filters.fieldZone) return false;

    // Coverage tightness filter
    if (filters.coverageTight !== undefined) {
      if (!play.coverageTightness) return false;
      if (filters.coverageTight && play.coverageTightness > 3) return false;  // tight = < 3 yards
      if (!filters.coverageTight && play.coverageTightness <= 3) return false; // loose = > 3 yards
    }

    // Team filter
    if (filters.offense && play.offense !== filters.offense) return false;
    if (filters.defense && play.defense !== filters.defense) return false;

    // Play type filter
    if (filters.playType && play.playType !== filters.playType) return false;

    // Shotgun filter
    if (filters.shotgun !== undefined && play.shotgun !== filters.shotgun) return false;

    // Target player filter - for route overlays
    if (filters.targetPlayer) {
      const target = play.players?.find(p => p.role === 'Targeted Receiver');
      if (!target) return false;
      // Match by last name (case insensitive)
      const playerName = target.name || target.displayName || '';
      if (!playerName.toLowerCase().includes(filters.targetPlayer.toLowerCase())) return false;
    }

    return true;
  });
}

/**
 * Compute tendencies from a set of plays
 */
export function computeTendencies(plays) {
  if (!plays || plays.length === 0) {
    return null;
  }

  const passPlays = plays.filter(p => p.playType === 'pass');
  const runPlays = plays.filter(p => p.playType === 'run');
  const completions = passPlays.filter(p => p.yardsGained > 0);

  // Pass direction breakdown
  const passLeft = passPlays.filter(p => p.passLocation === 'left').length;
  const passMid = passPlays.filter(p => p.passLocation === 'middle').length;
  const passRight = passPlays.filter(p => p.passLocation === 'right').length;
  const passTotal = passLeft + passMid + passRight || 1;

  // Coverage stats
  const playsWithCoverage = plays.filter(p => p.coverageTightness !== null);
  const avgCoverage = playsWithCoverage.length > 0
    ? playsWithCoverage.reduce((sum, p) => sum + p.coverageTightness, 0) / playsWithCoverage.length
    : null;

  return {
    sampleSize: plays.length,
    passRate: passPlays.length / plays.length,
    runRate: runPlays.length / plays.length,
    completionPct: passPlays.length > 0 ? completions.length / passPlays.length : 0,
    avgYards: plays.reduce((sum, p) => sum + (p.yardsGained || 0), 0) / plays.length,
    passAvgYards: passPlays.length > 0
      ? passPlays.reduce((sum, p) => sum + (p.yardsGained || 0), 0) / passPlays.length
      : 0,
    runAvgYards: runPlays.length > 0
      ? runPlays.reduce((sum, p) => sum + (p.yardsGained || 0), 0) / runPlays.length
      : 0,
    passLeft: passLeft / passTotal,
    passMiddle: passMid / passTotal,
    passRight: passRight / passTotal,
    shotgunRate: plays.filter(p => p.shotgun).length / plays.length,
    avgCoverage,
  };
}

/**
 * Get a representative play from a subset
 * Picks the play closest to median yards gained
 */
export function getRepresentativePlay(plays) {
  if (!plays || plays.length === 0) return null;

  // Sort by yards gained
  const sorted = [...plays].sort((a, b) => (a.yardsGained || 0) - (b.yardsGained || 0));

  // Pick median
  const midIndex = Math.floor(sorted.length / 2);
  return sorted[midIndex];
}

/**
 * What-If Scenarios - Real Data Filtering
 *
 * Each what-if maps to a real filter criteria
 */
export const WHAT_IF_FILTERS = {
  'TIGHT_COVERAGE': {
    label: 'Tight Man Coverage',
    description: 'Plays where defender was within 3 yards of receiver at snap',
    filter: { coverageTight: true },
  },
  'LOOSE_COVERAGE': {
    label: 'Off Coverage',
    description: 'Plays where defender was 3+ yards from receiver at snap',
    filter: { coverageTight: false },
  },
  'REDZONE': {
    label: 'Red Zone',
    description: 'Plays inside the 20 yard line',
    filter: { fieldZone: 'redzone' },
  },
  'THIRD_AND_LONG': {
    label: '3rd & Long',
    description: '3rd down with 7+ yards to go',
    filter: { down: 3, distanceMin: 7 },
  },
  'THIRD_AND_SHORT': {
    label: '3rd & Short',
    description: '3rd down with 3 or fewer yards to go',
    filter: { down: 3, distanceMax: 3 },
  },
  'SHOTGUN': {
    label: 'Shotgun Plays',
    description: 'Plays from shotgun formation',
    filter: { shotgun: true },
  },
  'UNDER_CENTER': {
    label: 'Under Center',
    description: 'Plays from under center',
    filter: { shotgun: false },
  },
};

/**
 * Detect what-if from user message
 */
export function detectWhatIf(message) {
  const lower = message.toLowerCase();

  if (lower.includes('tight') && (lower.includes('man') || lower.includes('coverage'))) {
    return 'TIGHT_COVERAGE';
  }
  if (lower.includes('off') && lower.includes('coverage')) {
    return 'LOOSE_COVERAGE';
  }
  if (lower.includes('loose') && lower.includes('coverage')) {
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

/**
 * Apply what-if and compute comparison
 */
export function applyWhatIf(allPlays, baseFilters, whatIfKey) {
  const whatIf = WHAT_IF_FILTERS[whatIfKey];
  if (!whatIf) return null;

  // Get base plays
  const basePlays = filterPlays(allPlays, baseFilters);
  const baseTendencies = computeTendencies(basePlays);

  // Get what-if plays (base filters + what-if filter)
  const whatIfFilters = { ...baseFilters, ...whatIf.filter };
  const whatIfPlays = filterPlays(allPlays, whatIfFilters);
  const whatIfTendencies = computeTendencies(whatIfPlays);

  if (!baseTendencies || !whatIfTendencies) {
    return null;
  }

  // Compute deltas
  const deltas = {};
  const metrics = ['passRate', 'completionPct', 'avgYards', 'passAvgYards'];

  for (const metric of metrics) {
    const base = baseTendencies[metric] || 0;
    const adjusted = whatIfTendencies[metric] || 0;
    const change = adjusted - base;
    const percentChange = base !== 0 ? ((adjusted - base) / base) * 100 : 0;

    deltas[metric] = {
      original: base,
      adjusted: adjusted,
      change: change,
      percentChange: percentChange.toFixed(0),
    };
  }

  return {
    whatIf,
    basePlays: basePlays.length,
    whatIfPlays: whatIfPlays.length,
    baseTendencies,
    whatIfTendencies,
    deltas,
    representativePlay: getRepresentativePlay(whatIfPlays),
  };
}
