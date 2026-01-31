#!/usr/bin/env python3
"""Create a compact dataset with ~50 plays for fast browser loading."""

import json
from pathlib import Path

INPUT_FILE = Path(__file__).parent.parent / "src" / "data" / "plays.json"
OUTPUT_FILE = Path(__file__).parent.parent / "public" / "plays.json"

def main():
    # Load full data
    with open(INPUT_FILE) as f:
        data = json.load(f)

    # Take first 100 plays with reasonable frame counts
    good_plays = [p for p in data["plays"] if p["numFrames"] >= 10][:100]

    # Further optimize - reduce frame data
    for play in good_plays:
        for player in play["players"]:
            # Keep only x, y for each frame
            player["frames"] = [
                {"f": fr["f"], "x": fr["x"], "y": fr["y"]}
                for fr in player["frames"]
            ]

    # Ensure output dir exists
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Write compact version
    with open(OUTPUT_FILE, 'w') as f:
        json.dump({"plays": good_plays}, f)

    print(f"Created {OUTPUT_FILE}")
    print(f"Plays: {len(good_plays)}")
    print(f"Size: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")

    # Show sample info
    if good_plays:
        p = good_plays[0]
        print(f"Sample play: {p['gameId']}/{p['playId']} - {len(p['players'])} players, {p['numFrames']} frames")

if __name__ == "__main__":
    main()
