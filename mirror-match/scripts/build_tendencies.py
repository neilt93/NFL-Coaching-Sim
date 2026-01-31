#!/usr/bin/env python3
"""
Build tendency analysis from 2025 nflverse play-by-play data.
Extracts KC and PHI plays and computes pass/run tendencies.
"""

import pandas as pd
import json
from pathlib import Path

DATA_FILE = Path(__file__).parent.parent / "data" / "play_by_play_2025.csv"
OUTPUT_FILE = Path(__file__).parent.parent / "public" / "tendencies.json"

def compute_tendencies(plays):
    """Compute tendency stats from a set of plays."""
    total = len(plays)
    if total == 0:
        return None

    pass_plays = plays[plays['play_type'] == 'pass']
    run_plays = plays[plays['play_type'] == 'run']

    pass_count = len(pass_plays)
    run_count = len(run_plays)
    pass_run_total = pass_count + run_count

    if pass_run_total == 0:
        return None

    # Pass location breakdown
    pass_left = len(pass_plays[pass_plays['pass_location'] == 'left'])
    pass_mid = len(pass_plays[pass_plays['pass_location'] == 'middle'])
    pass_right = len(pass_plays[pass_plays['pass_location'] == 'right'])

    # Shotgun usage
    shotgun_plays = plays[plays['shotgun'] == 1]

    # Yards gained
    avg_yards = plays['yards_gained'].mean()
    pass_avg_yards = pass_plays['yards_gained'].mean() if len(pass_plays) > 0 else 0
    run_avg_yards = run_plays['yards_gained'].mean() if len(run_plays) > 0 else 0

    return {
        'sampleSize': int(pass_run_total),
        'passRate': round(pass_count / pass_run_total, 3),
        'runRate': round(run_count / pass_run_total, 3),
        'passLeft': round(pass_left / pass_count, 3) if pass_count > 0 else 0,
        'passMiddle': round(pass_mid / pass_count, 3) if pass_count > 0 else 0,
        'passRight': round(pass_right / pass_count, 3) if pass_count > 0 else 0,
        'shotgunRate': round(len(shotgun_plays) / pass_run_total, 3),
        'avgYards': round(avg_yards, 1) if pd.notna(avg_yards) else 0,
        'passAvgYards': round(pass_avg_yards, 1) if pd.notna(pass_avg_yards) else 0,
        'runAvgYards': round(run_avg_yards, 1) if pd.notna(run_avg_yards) else 0,
    }

def main():
    print("Loading 2025 play-by-play data...")
    df = pd.read_csv(DATA_FILE, low_memory=False)
    print(f"Total plays: {len(df)}")

    # Filter to KC and PHI offensive plays
    teams = ['KC', 'PHI']
    team_plays = df[df['posteam'].isin(teams)]
    print(f"KC + PHI plays: {len(team_plays)}")

    # Only regular plays (not special teams)
    regular_plays = team_plays[team_plays['play_type'].isin(['pass', 'run'])]
    print(f"Pass/Run plays: {len(regular_plays)}")

    output = {}

    for team in teams:
        team_df = regular_plays[regular_plays['posteam'] == team]
        print(f"\n{team}: {len(team_df)} plays")

        team_data = {
            'team': team,
            'totalPlays': len(team_df),
            'overall': compute_tendencies(team_df),
            'byDown': {},
            'byDistance': {},
            'byFormation': {},
        }

        # By down
        for down in [1, 2, 3, 4]:
            down_plays = team_df[team_df['down'] == down]
            tendencies = compute_tendencies(down_plays)
            if tendencies:
                team_data['byDown'][str(down)] = tendencies

        # By distance (short: 1-3, medium: 4-7, long: 8+)
        short = team_df[(team_df['ydstogo'] >= 1) & (team_df['ydstogo'] <= 3)]
        medium = team_df[(team_df['ydstogo'] >= 4) & (team_df['ydstogo'] <= 7)]
        long_dist = team_df[team_df['ydstogo'] >= 8]

        for name, plays in [('short', short), ('medium', medium), ('long', long_dist)]:
            tendencies = compute_tendencies(plays)
            if tendencies:
                team_data['byDistance'][name] = tendencies

        # By formation (shotgun vs under center)
        shotgun = team_df[team_df['shotgun'] == 1]
        under_center = team_df[team_df['shotgun'] == 0]

        for name, plays in [('shotgun', shotgun), ('underCenter', under_center)]:
            tendencies = compute_tendencies(plays)
            if tendencies:
                team_data['byFormation'][name] = tendencies

        # 3rd down specific (the money situation)
        third_down = team_df[team_df['down'] == 3]
        team_data['thirdDown'] = {
            'overall': compute_tendencies(third_down),
            'short': compute_tendencies(third_down[(third_down['ydstogo'] >= 1) & (third_down['ydstogo'] <= 3)]),
            'medium': compute_tendencies(third_down[(third_down['ydstogo'] >= 4) & (third_down['ydstogo'] <= 7)]),
            'long': compute_tendencies(third_down[third_down['ydstogo'] >= 8]),
        }

        output[team] = team_data

    # Write output
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote {OUTPUT_FILE}")
    print(f"Size: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    main()
