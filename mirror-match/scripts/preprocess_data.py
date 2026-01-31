#!/usr/bin/env python3
"""
Pre-process NFL Big Data Bowl 2026 data into optimized JSON for Mirror Match.
Converts CSV tracking data into a compact format for browser visualization.
"""

import pandas as pd
import json
import os
from pathlib import Path

# Paths
DATA_DIR = Path(__file__).parent.parent / "nfl-big-data-bowl-2026-prediction" / "train"
OUTPUT_DIR = Path(__file__).parent.parent / "src" / "data"

def load_week_data(week_num):
    """Load input and output data for a specific week."""
    input_file = DATA_DIR / f"input_2023_w{week_num:02d}.csv"
    output_file = DATA_DIR / f"output_2023_w{week_num:02d}.csv"

    if not input_file.exists():
        return None, None

    print(f"Loading week {week_num}...")
    input_df = pd.read_csv(input_file)
    output_df = pd.read_csv(output_file) if output_file.exists() else None

    return input_df, output_df

def process_play(play_df):
    """Convert a single play's data into the format needed for visualization."""
    # Get play metadata from first row
    first_row = play_df.iloc[0]

    # Group by player
    players = []
    for nfl_id, player_df in play_df.groupby('nfl_id'):
        player_df = player_df.sort_values('frame_id')
        first_player_row = player_df.iloc[0]

        # Build frame array
        frames = []
        for _, row in player_df.iterrows():
            frames.append({
                "f": int(row['frame_id']),
                "x": round(row['x'], 1),
                "y": round(row['y'], 1),
                "s": round(row['s'], 1) if pd.notna(row['s']) else 0,
                "d": round(row['dir'], 0) if pd.notna(row['dir']) else 0,
            })

        players.append({
            "nflId": int(nfl_id),
            "name": first_player_row['player_name'],
            "position": first_player_row['player_position'],
            "side": first_player_row['player_side'],
            "role": first_player_row['player_role'],
            "frames": frames
        })

    return {
        "gameId": int(first_row['game_id']),
        "playId": int(first_row['play_id']),
        "direction": first_row['play_direction'],
        "yardline": int(first_row['absolute_yardline_number']),
        "ballLandX": round(first_row['ball_land_x'], 1) if pd.notna(first_row['ball_land_x']) else None,
        "ballLandY": round(first_row['ball_land_y'], 1) if pd.notna(first_row['ball_land_y']) else None,
        "numFrames": int(first_row['num_frames_output']),
        "players": players
    }

def main():
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_plays = []

    # Process weeks 1-3 for now (enough data for demo)
    for week in range(1, 4):
        input_df, output_df = load_week_data(week)
        if input_df is None:
            continue

        # Get unique plays
        play_groups = input_df.groupby(['game_id', 'play_id'])

        for (game_id, play_id), play_df in play_groups:
            try:
                play_data = process_play(play_df)
                all_plays.append(play_data)
            except Exception as e:
                print(f"Error processing play {game_id}/{play_id}: {e}")
                continue

        print(f"Week {week}: processed {len(play_groups)} plays")

    print(f"\nTotal plays: {len(all_plays)}")

    # Write output
    output_file = OUTPUT_DIR / "plays.json"
    with open(output_file, 'w') as f:
        json.dump({"plays": all_plays}, f)

    print(f"Wrote {output_file} ({output_file.stat().st_size / 1024 / 1024:.1f} MB)")

    # Also create a smaller sample file for quick testing
    sample_plays = all_plays[:20]
    sample_file = OUTPUT_DIR / "plays_sample.json"
    with open(sample_file, 'w') as f:
        json.dump({"plays": sample_plays}, f, indent=2)

    print(f"Wrote {sample_file} ({sample_file.stat().st_size / 1024:.1f} KB)")

if __name__ == "__main__":
    main()
