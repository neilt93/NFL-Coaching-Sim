#!/usr/bin/env python3
"""
Build plays_with_filters.json by joining:
- BDB 2026 INPUT tracking data (snap to ball release)
- BDB 2026 OUTPUT tracking data (ball release to catch)
- nflverse 2023 play-by-play (down, distance, formation, result)

Computes derived metrics:
- coverage_tightness: min distance between target receiver and nearest DB at snap
- field_zone: redzone / midfield / own_territory
- separation_at_catch: distance at ball_land frame
"""

import pandas as pd
import numpy as np
import json
from pathlib import Path
from math import sqrt

# Paths
BASE_DIR = Path(__file__).parent.parent
BDB_DIR = BASE_DIR / "nfl-big-data-bowl-2026-prediction" / "train"
NFLVERSE_FILE = BASE_DIR / "data" / "play_by_play_2023.csv"
OUTPUT_FILE = BASE_DIR / "public" / "plays_filtered.json"

def load_bdb_data(weeks=range(1, 10)):
    """Load BDB input + output tracking data for specified weeks."""
    input_dfs = []
    output_dfs = []

    for week in weeks:
        # Load input (snap to throw)
        input_file = BDB_DIR / f"input_2023_w{week:02d}.csv"
        if input_file.exists():
            print(f"Loading week {week} input...")
            df = pd.read_csv(input_file)
            df['week'] = week
            input_dfs.append(df)

        # Load output (throw to catch)
        output_file = BDB_DIR / f"output_2023_w{week:02d}.csv"
        if output_file.exists():
            print(f"Loading week {week} output...")
            df = pd.read_csv(output_file)
            df['week'] = week
            output_dfs.append(df)

    input_df = pd.concat(input_dfs, ignore_index=True) if input_dfs else pd.DataFrame()
    output_df = pd.concat(output_dfs, ignore_index=True) if output_dfs else pd.DataFrame()

    return input_df, output_df

def load_nflverse_data():
    """Load nflverse play-by-play data."""
    print("Loading nflverse 2023 PBP...")
    cols = ['old_game_id', 'play_id', 'down', 'ydstogo', 'yardline_100',
            'play_type', 'yards_gained', 'shotgun', 'pass_length',
            'pass_location', 'posteam', 'defteam', 'qtr', 'desc']
    df = pd.read_csv(NFLVERSE_FILE, usecols=cols)
    df = df.rename(columns={'old_game_id': 'game_id'})
    return df

def compute_coverage_tightness(play_df):
    """
    Compute min distance between target receiver and nearest DB at frame 1 (snap).
    Returns None if can't compute.
    """
    snap_frame = play_df[play_df['frame_id'] == 1]

    # Find target receiver
    target = snap_frame[snap_frame['player_role'] == 'Targeted Receiver']
    if target.empty:
        return None
    target_x = target['x'].values[0]
    target_y = target['y'].values[0]

    # Find defensive backs
    dbs = snap_frame[snap_frame['player_side'] == 'Defense']
    if dbs.empty:
        return None

    # Compute min distance
    distances = np.sqrt((dbs['x'] - target_x)**2 + (dbs['y'] - target_y)**2)
    return float(distances.min())

def compute_separation_at_target(play_df):
    """
    Compute separation between receiver and nearest DB at the last tracked frame.
    """
    max_frame = play_df['frame_id'].max()
    last_frame = play_df[play_df['frame_id'] == max_frame]

    target = last_frame[last_frame['player_role'] == 'Targeted Receiver']
    if target.empty:
        return None
    target_x = target['x'].values[0]
    target_y = target['y'].values[0]

    dbs = last_frame[last_frame['player_side'] == 'Defense']
    if dbs.empty:
        return None

    distances = np.sqrt((dbs['x'] - target_x)**2 + (dbs['y'] - target_y)**2)
    return float(distances.min())

def get_field_zone(yardline):
    """Categorize field position."""
    if pd.isna(yardline):
        return 'unknown'
    if yardline <= 20:
        return 'redzone'
    elif yardline <= 50:
        return 'midfield'
    else:
        return 'own_territory'

def build_play_data(input_df, output_df, nfl_df):
    """Build the final play dataset with combined input + output frames."""
    plays = []

    # Group input by game and play
    input_grouped = input_df.groupby(['game_id', 'play_id'])

    # Create lookup for output frames
    output_grouped = output_df.groupby(['game_id', 'play_id']) if not output_df.empty else {}

    total = len(input_grouped)

    for i, ((game_id, play_id), input_play_df) in enumerate(input_grouped):
        if i % 500 == 0:
            print(f"Processing play {i}/{total}...")

        # Get nflverse metadata
        nfl_play = nfl_df[(nfl_df['game_id'] == game_id) & (nfl_df['play_id'] == play_id)]

        # Get first row for play-level info
        first_row = input_play_df.iloc[0]

        # Compute metrics from input (pre-throw) data
        coverage_tightness = compute_coverage_tightness(input_play_df)
        separation = compute_separation_at_target(input_play_df)

        # Get max input frame to offset output frames
        max_input_frame = input_play_df['frame_id'].max()

        # Get output frames if available
        try:
            output_play_df = output_grouped.get_group((game_id, play_id))
            has_output = True
        except (KeyError, AttributeError):
            output_play_df = pd.DataFrame()
            has_output = False

        # Build player frames - combining input + output
        players = []
        for nfl_id, player_input_df in input_play_df.groupby('nfl_id'):
            player_input_df = player_input_df.sort_values('frame_id')
            first_player = player_input_df.iloc[0]

            frames = []

            # Add input frames
            for _, row in player_input_df.iterrows():
                frames.append({
                    'f': int(row['frame_id']),
                    'x': round(float(row['x']), 1),
                    'y': round(float(row['y']), 1),
                    's': round(float(row['s']), 1) if pd.notna(row.get('s', None)) else 0,
                })

            # Add output frames (offset by max input frame)
            if has_output and nfl_id in output_play_df['nfl_id'].values:
                player_output_df = output_play_df[output_play_df['nfl_id'] == nfl_id].sort_values('frame_id')
                for _, row in player_output_df.iterrows():
                    frames.append({
                        'f': int(row['frame_id']) + max_input_frame,  # Offset!
                        'x': round(float(row['x']), 1),
                        'y': round(float(row['y']), 1),
                        's': 0,  # Output doesn't have speed
                    })

            players.append({
                'nflId': int(nfl_id),
                'name': first_player['player_name'],
                'position': first_player['player_position'],
                'side': first_player['player_side'],
                'role': first_player['player_role'],
                'team': 'away' if first_player['player_side'] == 'Offense' else 'home',
                'frames': frames
            })

        # Calculate total frames (input + output)
        max_output_frame = output_play_df['frame_id'].max() if has_output and not output_play_df.empty else 0
        total_frames = max_input_frame + max_output_frame

        # Build play object
        play_obj = {
            'gameId': int(game_id),
            'playId': int(play_id),
            'direction': first_row['play_direction'],
            'yardline': int(first_row['absolute_yardline_number']),
            'ballLandX': float(first_row['ball_land_x']) if pd.notna(first_row['ball_land_x']) else None,
            'ballLandY': float(first_row['ball_land_y']) if pd.notna(first_row['ball_land_y']) else None,
            'numFrames': int(total_frames),
            'numInputFrames': int(max_input_frame),
            'numOutputFrames': int(max_output_frame) if has_output else 0,
            'players': players,
            # Computed metrics for filtering
            'coverageTightness': round(coverage_tightness, 1) if coverage_tightness else None,
            'separation': round(separation, 1) if separation else None,
            'fieldZone': get_field_zone(first_row['absolute_yardline_number']),
        }

        # Add nflverse metadata if found
        if not nfl_play.empty:
            nfl_row = nfl_play.iloc[0]
            play_obj['down'] = int(nfl_row['down']) if pd.notna(nfl_row['down']) else 0
            play_obj['yardsToGo'] = int(nfl_row['ydstogo']) if pd.notna(nfl_row['ydstogo']) else 0
            play_obj['playType'] = nfl_row['play_type'] if pd.notna(nfl_row['play_type']) else 'unknown'
            play_obj['yardsGained'] = int(nfl_row['yards_gained']) if pd.notna(nfl_row['yards_gained']) else 0
            play_obj['shotgun'] = bool(nfl_row['shotgun']) if pd.notna(nfl_row['shotgun']) else False
            play_obj['passLength'] = nfl_row['pass_length'] if pd.notna(nfl_row['pass_length']) else None
            play_obj['passLocation'] = nfl_row['pass_location'] if pd.notna(nfl_row['pass_location']) else None
            play_obj['offense'] = nfl_row['posteam'] if pd.notna(nfl_row['posteam']) else 'UNK'
            play_obj['defense'] = nfl_row['defteam'] if pd.notna(nfl_row['defteam']) else 'UNK'
            play_obj['quarter'] = int(nfl_row['qtr']) if pd.notna(nfl_row['qtr']) else 1
            play_obj['description'] = nfl_row['desc'] if pd.notna(nfl_row['desc']) else ''

        plays.append(play_obj)

    return plays

def compute_tendencies(plays):
    """Compute aggregate tendencies from plays."""
    if not plays:
        return {}

    # Group by offense team
    teams = {}
    for play in plays:
        team = play.get('offense', 'UNK')
        if team not in teams:
            teams[team] = []
        teams[team].append(play)

    tendencies = {}
    for team, team_plays in teams.items():
        if len(team_plays) < 10:
            continue

        pass_plays = [p for p in team_plays if p.get('playType') == 'pass']
        run_plays = [p for p in team_plays if p.get('playType') == 'run']

        tendencies[team] = {
            'totalPlays': len(team_plays),
            'overall': {
                'passRate': len(pass_plays) / len(team_plays) if team_plays else 0,
                'runRate': len(run_plays) / len(team_plays) if team_plays else 0,
                'avgYards': sum(p.get('yardsGained', 0) for p in team_plays) / len(team_plays),
                'avgCoverage': sum(p.get('coverageTightness', 0) or 0 for p in team_plays if p.get('coverageTightness')) / max(1, len([p for p in team_plays if p.get('coverageTightness')])),
            }
        }

    return tendencies

def main():
    # Load data - both input and output
    input_df, output_df = load_bdb_data(weeks=range(1, 6))  # First 5 weeks
    nfl_df = load_nflverse_data()

    print(f"Input plays: {input_df.groupby(['game_id', 'play_id']).ngroups}")
    print(f"Output plays: {output_df.groupby(['game_id', 'play_id']).ngroups if not output_df.empty else 0}")
    print(f"nflverse plays: {len(nfl_df)}")

    # Build plays with combined input + output frames
    plays = build_play_data(input_df, output_df, nfl_df)
    print(f"Built {len(plays)} plays with tracking data")

    # Show sample frame counts
    if plays:
        sample = plays[0]
        print(f"Sample play: {sample['numInputFrames']} input + {sample['numOutputFrames']} output = {sample['numFrames']} total frames")

    # Compute tendencies
    tendencies = compute_tendencies(plays)

    # Output
    output = {
        'plays': plays,
        'tendencies': tendencies,
        'filters': {
            'coverageTightness': {'tight': 3, 'normal': 5, 'loose': 7},
            'fieldZone': ['redzone', 'midfield', 'own_territory'],
            'down': [1, 2, 3, 4],
        }
    }

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f)

    print(f"Wrote {OUTPUT_FILE} ({OUTPUT_FILE.stat().st_size / 1024 / 1024:.1f} MB)")

    # Also write tendencies separately for quick loading
    tend_file = BASE_DIR / "public" / "tendencies_2023.json"
    with open(tend_file, 'w') as f:
        json.dump(tendencies, f, indent=2)
    print(f"Wrote {tend_file}")

if __name__ == "__main__":
    main()
