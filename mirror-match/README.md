# Coach AI

AI-powered NFL coaching assistant that analyzes play data and visualizes tendencies in 3D.

## What It Does

Ask questions in plain English, watch plays animate on a 3D football field, and get coaching insights powered by Gemini AI.

**Demo Flow:**
1. Coach types a query ("Show me Kelce's routes on 3rd down")
2. AI responds with coaching insight
3. 3D field renders matching plays with route overlays
4. Coach can replay, step through frames, or ask follow-up questions

## Features

- **Natural Language Queries** - Ask about any team, player, or situation
- **3D Play Visualization** - Watch plays animate with player tracking data
- **Route Overlays** - See receiver route trees for any skill player
- **Real NFL Data** - 2023 season tracking data from NFL Big Data Bowl 2026
- **Coaching Insights** - Gemini AI provides actionable defensive adjustments

## Tech Stack

- **Frontend**: React + Vite
- **3D Rendering**: Three.js
- **AI**: Google Gemini 2.0 Flash
- **Data**: NFL Big Data Bowl 2026 tracking data

## Getting Started

```bash
# Install dependencies
npm install

# Add your Gemini API key
echo "VITE_GEMINI_API_KEY=your_key_here" > .env

# Start development server
npm run dev
```

## Example Queries

- "Show me Kelce's routes"
- "KC red zone plays"
- "How do I defend 3rd and long?"
- "Show me longest throws"
- "Touchdown plays"

## Controls

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| [ / ] | Step frame back/forward |
| < / > | Previous/Next play |
| R | Reset camera |
| WASD | Move camera |
| Q/E | Camera up/down |

## Architecture

```
React App
├── Field3D (Three.js) ─── 3D field, players, ball, camera
├── ChatInterface ──────── User input, AI responses
└── Gemini Client ──────── Query parsing, coaching insights
        │
        ▼
Tendency Engine ────────── Filter plays, compute stats
```

## Data

Uses NFL tracking data with 10fps player positions. Each play includes:
- Player x, y coordinates per frame
- Ball trajectory
- Play metadata (down, distance, result)

---

Built for Google Gemini API Developer Competition 2026
