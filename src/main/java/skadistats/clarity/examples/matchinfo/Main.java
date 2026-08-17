package skadistats.clarity.examples.matchinfo;

import skadistats.clarity.Clarity;
import skadistats.clarity.model.Entity;
import skadistats.clarity.processor.entities.OnEntityCreated;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.source.MappedFileSource;
import skadistats.clarity.source.Source;
import skadistats.clarity.wire.shared.demo.proto.Demo;

import java.io.FileWriter;
import java.io.IOException;
import java.util.*;

/**
 * Extract match information from a Dota 2 replay to JSON format.
 * Usage: matchinfoRun <replay.dem> <output.json>
 */
public class Main {

    private static class PlayerInfo {
        public int playerId;
        public String playerName;
        public String heroName;
        public int teamId; // 2 = Radiant, 3 = Dire
        public int kills;
        public int deaths;
        public int assists;
        public int lastHits;
        public int denies;
        public int gpm;
        public int xpm;
        public int level;
        public int goldTotal;
    }

    private static class MatchInfo {
        public String matchId;
        public String gameMode;
        public String gameVersion;
        public int duration; // in seconds
        public String winner; // "Radiant" or "Dire"
        public List<PlayerInfo> players = new ArrayList<>();
        public int totalKills;
        public int radiantKills;
        public int direKills;
    }

    private final String outputPath;
    private final MatchInfo matchInfo = new MatchInfo();
    private final Map<Integer, PlayerInfo> playerMap = new HashMap<>();

    private Entity dataRadiant;
    private Entity dataDire;
    private Entity gameRules;
    private boolean matchEnded = false;
    private int lastTick = 0;

    public Main(String outputPath) {
        this.outputPath = outputPath;
    }

    // --- helpers ---

    private Float getFloatProp(Entity e, String... names) {
        if (e == null)
            return null;
        for (String n : names) {
            try {
                Float v = e.getProperty(n);
                if (v != null)
                    return v;
            } catch (IllegalArgumentException ignored) {
            }
        }
        return null;
    }

    private Integer getIntProp(Entity e, String... names) {
        if (e == null)
            return null;
        for (String n : names) {
            try {
                Integer v = e.getProperty(n);
                if (v != null)
                    return v;
            } catch (IllegalArgumentException ignored) {
            }
        }
        return null;
    }

    private String getStringProp(Entity e, String... names) {
        if (e == null)
            return null;
        for (String n : names) {
            try {
                String v = e.getProperty(n);
                if (v != null)
                    return v;
            } catch (IllegalArgumentException ignored) {
            }
        }
        return null;
    }

    // --- processors ---

    @OnEntityCreated
    public void onEntityCreated(Context ctx, Entity e) {
        String dtName = e.getDtClass().getDtName();

        if ("CDOTA_DataRadiant".equals(dtName)) {
            dataRadiant = e;
        } else if ("CDOTA_DataDire".equals(dtName)) {
            dataDire = e;
        } else if ("CDOTAGamerulesProxy".equals(dtName)) {
            gameRules = e;
        } else if (dtName.startsWith("CDOTA_Unit_Hero_")) {
            String heroName = dtName.replace("CDOTA_Unit_Hero_", "").replace("_", " ");
            Integer pid = getIntProp(e, "m_iPlayerID");

            if (pid != null && pid >= 0 && pid < 24) {
                PlayerInfo player = playerMap.computeIfAbsent(pid, k -> new PlayerInfo());
                player.playerId = pid;
                player.heroName = heroName;

                // Determine team (Radiant = 0,1,2,3,4 / Dire = 5,6,7,8,9 in player slots)
                // But m_iPlayerID can be different (0,2,4,6,8 for radiant, 10,12,14,16,18 for
                // dire)
                if (pid <= 8) {
                    player.teamId = 2; // Radiant
                } else {
                    player.teamId = 3; // Dire
                }
            }
        }
    }

    @OnTickEnd
    public void onTickEnd(Context ctx, boolean synthetic) {
        lastTick = ctx.getTick();

        if (gameRules != null && !matchEnded) {
            Integer gameState = getIntProp(gameRules, "m_nGameState");
            // Game state 6 = POST_GAME
            if (gameState != null && gameState >= 6) {
                matchEnded = true;
                extractFinalStats();
            }
        }
    }

    private void extractFinalStats() {
        // Extract game information
        if (gameRules != null) {
            Integer matchId = getIntProp(gameRules, "m_unMatchID64");
            if (matchId != null) {
                matchInfo.matchId = String.valueOf(matchId);
            }

            Integer gameMode = getIntProp(gameRules, "m_iGameMode");
            matchInfo.gameMode = getGameModeName(gameMode != null ? gameMode : 0);

            Float gameTime = getFloatProp(gameRules, "m_fGameTime");
            if (gameTime != null) {
                matchInfo.duration = Math.round(gameTime);
            }

            Integer winner = getIntProp(gameRules, "m_nGameWinner");
            if (winner != null) {
                matchInfo.winner = winner == 2 ? "Radiant" : "Dire";
            }
        }

        // Extract player stats
        for (int i = 0; i < 10; i++) {
            Entity teamEntity;
            int index;
            int playerId;

            if (i < 5) {
                teamEntity = dataRadiant;
                index = i;
                playerId = i * 2; // 0, 2, 4, 6, 8
            } else {
                teamEntity = dataDire;
                index = i - 5;
                playerId = 10 + (i - 5) * 2; // 10, 12, 14, 16, 18
            }

            PlayerInfo player = playerMap.get(playerId);
            if (player == null) {
                player = new PlayerInfo();
                player.playerId = playerId;
                player.heroName = "Unknown";
                player.teamId = i < 5 ? 2 : 3;
                playerMap.put(playerId, player);
            }

            if (teamEntity != null) {
                String prefix = String.format("m_vecDataTeam.%04d.", index);

                player.playerName = getStringProp(teamEntity, prefix + "m_iszPlayerName");
                if (player.playerName == null || player.playerName.isEmpty()) {
                    player.playerName = "Player " + (i + 1);
                }

                player.kills = getIntProp(teamEntity, prefix + "m_iKills", prefix + "m_iHeroKills");
                if (player.kills == null)
                    player.kills = 0;

                player.deaths = getIntProp(teamEntity, prefix + "m_iDeaths");
                if (player.deaths == null)
                    player.deaths = 0;

                player.assists = getIntProp(teamEntity, prefix + "m_iAssists");
                if (player.assists == null)
                    player.assists = 0;

                player.lastHits = getIntProp(teamEntity, prefix + "m_iLastHitCount");
                if (player.lastHits == null)
                    player.lastHits = 0;

                player.denies = getIntProp(teamEntity, prefix + "m_iDenyCount", prefix + "m_iDenies");
                if (player.denies == null)
                    player.denies = 0;

                // Calculate GPM and XPM
                if (matchInfo.duration > 0) {
                    Integer totalGold = getIntProp(teamEntity, prefix + "m_iTotalEarnedGold");
                    if (totalGold != null) {
                        player.gpm = (int) ((totalGold * 60.0f) / matchInfo.duration);
                        player.goldTotal = totalGold;
                    } else {
                        player.gpm = 0;
                        player.goldTotal = 0;
                    }

                    Integer totalXP = getIntProp(teamEntity, prefix + "m_iTotalEarnedXP");
                    if (totalXP != null) {
                        player.xpm = (int) ((totalXP * 60.0f) / matchInfo.duration);
                    } else {
                        player.xpm = 0;
                    }
                }

                player.level = getIntProp(teamEntity, prefix + "m_iLevel");
                if (player.level == null)
                    player.level = 1;
            }

            matchInfo.players.add(player);
        }

        // Calculate total kills
        matchInfo.radiantKills = matchInfo.players.stream()
                .filter(p -> p.teamId == 2)
                .mapToInt(p -> p.kills)
                .sum();

        matchInfo.direKills = matchInfo.players.stream()
                .filter(p -> p.teamId == 3)
                .mapToInt(p -> p.kills)
                .sum();

        matchInfo.totalKills = matchInfo.radiantKills + matchInfo.direKills;
    }

    private String getGameModeName(int mode) {
        switch (mode) {
            case 0:
                return "None";
            case 1:
                return "All Pick";
            case 2:
                return "Captain's Mode";
            case 3:
                return "Random Draft";
            case 4:
                return "Single Draft";
            case 5:
                return "All Random";
            case 22:
                return "Ranked All Pick";
            case 23:
                return "Turbo";
            default:
                return "Unknown (" + mode + ")";
        }
    }

    private void writeJson() throws IOException {
        try (FileWriter fw = new FileWriter(outputPath)) {
            fw.write("{\n");

            // Match info
            fw.write(String.format("  \"matchId\": \"%s\",\n",
                    matchInfo.matchId != null ? matchInfo.matchId : "unknown"));
            fw.write(String.format("  \"gameMode\": \"%s\",\n", matchInfo.gameMode));
            fw.write(String.format("  \"duration\": %d,\n", matchInfo.duration));
            fw.write(String.format("  \"durationFormatted\": \"%d:%02d\",\n",
                    matchInfo.duration / 60, matchInfo.duration % 60));
            fw.write(String.format("  \"winner\": \"%s\",\n",
                    matchInfo.winner != null ? matchInfo.winner : "Unknown"));
            fw.write(String.format("  \"totalKills\": %d,\n", matchInfo.totalKills));
            fw.write(String.format("  \"radiantKills\": %d,\n", matchInfo.radiantKills));
            fw.write(String.format("  \"direKills\": %d,\n", matchInfo.direKills));

            // Players array
            fw.write("  \"players\": [\n");
            for (int i = 0; i < matchInfo.players.size(); i++) {
                PlayerInfo p = matchInfo.players.get(i);
                fw.write("    {\n");
                fw.write(String.format("      \"playerId\": %d,\n", p.playerId));
                fw.write(String.format(Locale.US, "      \"playerName\": \"%s\",\n",
                        escapeJson(p.playerName)));
                fw.write(String.format(Locale.US, "      \"heroName\": \"%s\",\n", p.heroName));
                fw.write(String.format("      \"team\": \"%s\",\n", p.teamId == 2 ? "radiant" : "dire"));
                fw.write(String.format("      \"kills\": %d,\n", p.kills));
                fw.write(String.format("      \"deaths\": %d,\n", p.deaths));
                fw.write(String.format("      \"assists\": %d,\n", p.assists));
                fw.write(String.format("      \"lastHits\": %d,\n", p.lastHits));
                fw.write(String.format("      \"denies\": %d,\n", p.denies));
                fw.write(String.format("      \"gpm\": %d,\n", p.gpm));
                fw.write(String.format("      \"xpm\": %d,\n", p.xpm));
                fw.write(String.format("      \"level\": %d,\n", p.level));
                fw.write(String.format("      \"goldTotal\": %d\n", p.goldTotal));
                fw.write("    }");

                if (i < matchInfo.players.size() - 1) {
                    fw.write(",");
                }
                fw.write("\n");
            }
            fw.write("  ]\n");

            fw.write("}\n");
        }
        System.out.printf("Match info saved to %s%n", outputPath);
    }

    private String escapeJson(String str) {
        if (str == null)
            return "";
        return str.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: matchinfoRun <replay.dem> <output.json>");
            System.exit(1);
        }

        String replayPath = args[0];
        String outputPath = args[1];

        Source source = new MappedFileSource(replayPath);
        Main processor = new Main(outputPath);

        SimpleRunner runner = new SimpleRunner(source);
        runner.runWith(processor);

        processor.writeJson();
    }
}
