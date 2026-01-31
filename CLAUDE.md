# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mirror Match is an AI coaching simulator for NFL play analysis. Users ask questions in plain English, watch a 3D football field animate the most probable play, then ask "what if" to see how defensive adjustments affect outcomes.

**Demo flow**: Coach types query → 3D field renders play → sidebar shows probabilities → coach asks "what if" → field resets with adjusted play.

## Commands

All commands run from the `mirror-match/` directory:

```bash
npm run dev      # Start development server (Vite)
npm run build    # Production build
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

Data preprocessing (requires Python with pandas):
```bash
python scripts/preprocess_data.py
```

## Architecture

```
Frontend (React)
├── Field3D (Three.js) ─── 3D field, players, ball, camera
├── StatsPanel ─────────── Tendency bars, probabilities, what-if deltas
├── ChatInterface ──────── User input, message history, AI responses
└── Timeline Scrubber ──── Playback controls, frame scrubbing

     │ user query              ▲ structured response
     ▼                         │
Gemini API Layer
     │ query params            ▲ matching plays
     ▼                         │
Tendency Engine (JS) ────── Filter/aggregate plays, select representative play
```

### Core Components

- **App.jsx** - Main orchestrator. Manages play data state, animation frame timing (10fps data, 60fps render with interpolation), playback controls, and keyboard shortcuts. Loads `/plays.json` and `/tendencies.json` on mount.

- **Field3D.jsx** - Three.js 3D renderer. Players as cylinders with team colors, ball as glowing sphere. Handles orbit controls (drag rotate, scroll zoom). Default camera: behind QB looking downfield.

- **StatsPanel.jsx** - Displays team tendencies based on down/distance. Shows pass/run splits, directional tendencies, third-down breakdowns, and what-if delta comparisons.

- **ChatInterface.jsx** - AI coach chat via Gemini 2.0 Flash. Falls back to demo responses without API key. Quick action buttons for common queries.

- **geminiClient.js** - Gemini API integration. Injects tendency context into prompts for data-driven responses.

### Ball Animation Phases

1. **PRE-SNAP** (frames 0-10): Ball at center position, on ground
2. **IN HAND** (frames 10-throwFrame): Ball follows QB position at hand height (y=1.5)
3. **THROWN** (throwFrame-catchFrame): Parabolic arc from QB to receiver
4. **CAUGHT** (catchFrame-end): Ball snaps to receiver, brief flash effect

### Gemini Response Format

The API should return structured JSON for play queries:
```json
{
  "narration": "1-2 sentence coaching analysis",
  "query": { "team": "KC", "down": 3, "distance": [7, 99], "formation": "SHOTGUN" },
  "whatIf": { "adjustment": "A_GAP_BLITZ", "description": "interior pressure" },
  "probabilities": { "passRate": 0.68, "completionPct": 0.68, "avgYards": 8.2 }
}
```

### What-If Adjustments

Defensive adjustments apply multipliers to base tendencies:
- `A_GAP_BLITZ`: completionPct ×0.8, avgYards ×0.57, sackRate ×2.0
- `COVER_2`: passRight ×0.7, passMid ×1.4, avgYards ×0.85
- `MAN_COVERAGE`: completionPct ×0.85, avgYards ×0.9

### Environment

Requires `VITE_GEMINI_API_KEY` in `.env` for AI chat. App works in demo mode without it.

### Coordinate System

Field uses NFL standard yards:
- X: 0-120 (10-110 is playing field, 0-10 and 110-120 are end zones)
- Y: 0-53.33 (sideline to sideline)
- Three.js Y axis is height (players at y=1, ball thrown at y=1.5)
- Scale: 1 unit = 1 yard

### Team Colors

```
KC Chiefs:  primary #E31837 (red), secondary #FFB81C (gold)
PHI Eagles: primary #004C54 (teal), secondary #A5ACAF (silver)
```

### UI Color Palette

```
--bg-primary:     #0a0e1a   (near-black navy)
--bg-secondary:   #111827   (dark panels)
--text-primary:   #e8ecf4   (bright white-blue)
--accent-blue:    #3b82f6   (LOS, links)
--accent-yellow:  #eab308   (first down, highlights)
--field-green:    #1a472a   (field surface)
```

### Data Processing

`scripts/preprocess_data.py` converts NFL Big Data Bowl CSV files to optimized JSON:
- Input: `nfl-big-data-bowl-2026-prediction/train/input_2023_w*.csv`
- Output: `src/data/plays.json` (full) and `plays_sample.json` (20 plays for testing)
- Data is 10fps tracking frames with x, y, speed, direction per player
