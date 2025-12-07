# Dota 2 Farming Pattern Parser

This project uses the [Clarity](https://github.com/skadistats/clarity) library to parse Dota 2 replay files (`.dem`) and extract movement and farming statistics for a specific player. It outputs the data in JSON format for analysis.

## Overview

The tool tracks a specific hero based on their Player ID and records the following data points over the course of the match (sampled periodically):

-   **Time** (`t`): Relative time in seconds.
-   **Position** (`x`, `y`): World coordinates of the hero.
-   **Tally** (`lastHits`): Total last hits.
-   **Gold Sources**:
    -   `creepGold`: Gold earned from creep kills.
    -   `neutralGold`: Gold earned from neutral creep kills.
    -   `heroKillGold`: Gold earned from hero kills.

This data is useful for visualizing farming patterns and movement efficiency.

## Prerequisites

-   Java JDK 17 or higher.
-   The project includes a Gradle wrapper (`gradlew`), so you do not need to install Gradle manually.

## Usage

To run the parser, use the `pathRun` Gradle task. You must provide three arguments:

1.  **Replay Path**: The absolute path to the `.dem` file.
2.  **Player ID**: The internal integer ID of the player to track.
3.  **Output Path**: The path where the JSON results will be saved.

### Command Syntax

**Windows:**

```cmd
gradlew.bat pathRun --args "<path-to-replay> <player-id> <path-to-output-json>"
```

**Linux / Mac:**

```bash
./gradlew pathRun --args "<path-to-replay> <player-id> <path-to-output-json>"
```

### Example

```cmd
gradlew.bat pathRun --args "C:\Dev\dotagod\PathFinding\8563191677.dem 0 C:\Dev\dotagod\PathFinding\custom.json"
```

### Important: Player IDs

Dota 2 internal Player IDs are not always sequential 0-9. They often follow a specific pattern for Radiant and Dire teams:

*   **Radiant**: 0, 1, 2, 3, 4 (or sometimes 0, 2, 4, 6, 8 in older/custom contexts, verify with `dtinspector` if unsure).
*   **Dire**: 5, 6, 7, 8, 9 (or sometimes 10, 12, 14, 16, 18).

The tool prints found heroes and their IDs to the console when it starts processing. If you are unsure which ID to use, run the command with a dummy ID (e.g., 0) and check the console output for:
`[HERO] PlayerID=... Entity=...`

## Output Format

The output is a JSON array containing sample objects:

```json
[
  {
    "t": 0.000,
    "x": -1200.500,
    "y": 500.250,
    "lastHits": 0,
    "creepGold": 0,
    "neutralGold": 0,
    "heroKillGold": 0
  },
  ...
]
```

## Future Improvements

The current command structure is temporary. Future updates will aim to simplify the CLI arguments and potentially auto-detect players or teams.
