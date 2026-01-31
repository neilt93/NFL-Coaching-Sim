#!/usr/bin/env python3
"""
Pre-process NFL Big Data Bowl 2017 data (KC vs NE) into optimized JSON.
Full 22-player tracking + ball position.
"""

import pandas as pd
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "nfl-data-2017" / "Data"
OUTPUT_FILE = Path(__file__).parent.parent / "public" / "plays.json"

def main():
    print("Loading data...")
    tracking = pd.read_csv(DATA_DIR / "tracking_gameId_2017090700.csv")
    plays = pd.read_csv(DATA_DIR / "plays.csv")
    players = pd.read_csv(DATA_DIR / "players.csv")
    games = pd.read_csv(DATA_DIR / "games.csv")

    # Get game info
    game = games[games['gameId'] == 2017090700].iloc[0]
    print(f"Game: {game['homeTeamAbbr']} vs {game['visitorTeamAbbr']}")

    # Filter to this game's plays
    game_plays = plays[plays['gameId'] == 2017090700]
    print(f"Total plays: {len(game_plays)}")

    # Build play data
    all_plays = []

    for _, play_row in game_plays.iterrows():
        play_id = play_row['playId']
        play_tracking = tracking[tracking['playId'] == play_id]

        if len(play_tracking) == 0:
            continue

        # Separate ball and players
        ball_data = play_tracking[play_tracking['team'] == 'ball']
        player_data = play_tracking[play_tracking['team'] != 'ball']

        # Get unique frame IDs
        frame_ids = sorted(play_tracking['frame.id'].unique())

        # Build player frame arrays
        player_list = []
        for nfl_id, p_df in player_data.groupby('nflId'):
            p_df = p_df.sort_values('frame.id')
            first_row = p_df.iloc[0]

            # Get position from players table
            player_info = players[players['nflId'] == nfl_id]
            position = player_info['PositionAbbr'].iloc[0] if len(player_info) > 0 else 'UNK'

            frames = []
            for _, row in p_df.iterrows():
                frames.append({
                    "f": int(row['frame.id']),
                    "x": round(row['x'], 1),
                    "y": round(row['y'], 1),
                })

            player_list.append({
                "nflId": int(nfl_id),
                "name": first_row['displayName'],
                "jersey": int(first_row['jerseyNumber']) if pd.notna(first_row['jerseyNumber']) else 0,
                "team": first_row['team'],  # 'home' or 'away'
                "position": position,
                "frames": frames
            })

        # Build ball frame array
        ball_frames = []
        if len(ball_data) > 0:
            ball_data = ball_data.sort_values('frame.id')
            for _, row in ball_data.iterrows():
                ball_frames.append({
                    "f": int(row['frame.id']),
                    "x": round(row['x'], 1),
                    "y": round(row['y'], 1),
                })

        # Determine which team has the ball
        possession = play_row.get('possessionTeam', '')
        is_home_offense = possession == game['homeTeamAbbr']

        play_entry = {
            "gameId": int(play_row['gameId']),
            "playId": int(play_id),
            "quarter": int(play_row['quarter']) if pd.notna(play_row['quarter']) else 0,
            "down": int(play_row['down']) if pd.notna(play_row['down']) else 0,
            "yardsToGo": int(play_row['yardsToGo']) if pd.notna(play_row['yardsToGo']) else 0,
            "possession": possession,
            "formation": play_row.get('offenseFormation', '') if pd.notna(play_row.get('offenseFormation', '')) else '',
            "personnel": play_row.get('personnel.offense', '') if pd.notna(play_row.get('personnel.offense', '')) else '',
            "passResult": play_row.get('PassResult', '') if pd.notna(play_row.get('PassResult', '')) else '',
            "passLength": play_row.get('PassLength', '') if pd.notna(play_row.get('PassLength', '')) else '',
            "yardsGained": int(play_row['PlayResult']) if pd.notna(play_row.get('PlayResult')) else 0,
            "description": play_row.get('playDescription', ''),
            "numFrames": len(frame_ids),
            "isHomeOffense": is_home_offense,
            "players": player_list,
            "ball": ball_frames
        }

        all_plays.append(play_entry)

    print(f"Processed {len(all_plays)} plays with tracking data")

    # Add game metadata
    output = {
        "game": {
            "gameId": 2017090700,
            "home": game['homeTeamAbbr'],  # NE
            "away": game['visitorTeamAbbr'],  # KC
            "homeScore": int(game['homeScore']) if 'homeScore' in game else 27,
            "awayScore": int(game['awayScore']) if 'awayScore' in game else 42,
        },
        "plays": all_plays
    }

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f)

    print(f"Wrote {OUTPUT_FILE}")
    print(f"Size: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    main()
