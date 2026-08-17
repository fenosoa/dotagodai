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
    private Entity playerResource;
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
        } else if ("CDOTA_PlayerResource".equals(dtName)) {
            playerResource = e;
        } else if (dtName.startsWith("CDOTA_Unit_Hero_")) {
            String heroName = dtName.replace("CDOTA_Unit_Hero_", "").replace("_", " ");
            Integer pid = getIntProp(e, "m_iPlayerID");

            if (pid != null && pid >= 0 && pid < 24) {
                PlayerInfo player = playerMap.computeIfAbsent(pid, k -> new PlayerInfo());
                player.playerId = pid;

                // Keep the *first* hero seen for this playerId. Illusions/clones
                // (Terrorblade, Naga Siren, Manta Style, ...) are separate entities
                // of the same CDOTA_Unit_Hero_* class created later in the match and
                // would otherwise overwrite the player's real hero name.
                if (player.heroName == null) {
                    player.heroName = heroName;
                }

                // Rough fallback team guess in case CDOTA_PlayerResource (read
                // authoritatively below, in extractFinalStats) isn't available.
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

    // Fallback for replays where m_nGameState never reaches POST_GAME while
    // ticks are being processed (property naming/timing varies across game
    // versions/recording conditions): compute stats from whatever state was
    // last observed once the whole replay has been read.
    public void finalizeIfNeeded() {
        if (!matchEnded) {
            matchEnded = true;
            extractFinalStats();
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

        // Build the roster from the real playerIds actually observed on hero
        // entities -- don't assume a fixed m_iPlayerID numbering scheme (it
        // varies: classic 0,2,4,6,8/10,12,14,16,18, or sequential 0-9 split by
        // team). CDOTA_PlayerResource.m_vecPlayerData gives authoritative name +
        // team for each, indexed directly by playerId.
        List<Integer> playerIds = new ArrayList<>(playerMap.keySet());
        Collections.sort(playerIds);

        for (int pid : playerIds) {
            applyAuthoritativePlayerData(playerMap.get(pid), pid);
        }

        // Detailed per-match stats (kills/gold/...) live in a *team-relative*
        // slot (0-4) on CDOTA_DataRadiant/CDOTA_DataDire -- a different indexing
        // scheme from m_iPlayerID. Since we now know each player's team
        // authoritatively, derive that slot by ranking players within their own
        // team by playerId, rather than assuming a numbering convention.
        List<Integer> radiantIds = new ArrayList<>();
        List<Integer> direIds = new ArrayList<>();
        for (int pid : playerIds) {
            (playerMap.get(pid).teamId == 2 ? radiantIds : direIds).add(pid);
        }

        applyTeamStats(dataRadiant, radiantIds);
        applyTeamStats(dataDire, direIds);

        for (int pid : playerIds) {
            matchInfo.players.add(playerMap.get(pid));
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

    // Reads per-match stats (kills/gold/...) for a team from its ordered player
    // list -- position in the list (sorted by playerId) becomes the team-relative
    // slot (0-4) used by CDOTA_DataRadiant/CDOTA_DataDire's m_vecDataTeam array.
    private void applyTeamStats(Entity teamEntity, List<Integer> orderedPlayerIds) {
        if (teamEntity == null) {
            return;
        }

        for (int slot = 0; slot < orderedPlayerIds.size(); slot++) {
            PlayerInfo player = playerMap.get(orderedPlayerIds.get(slot));
            String prefix = String.format("m_vecDataTeam.%04d.", slot);

            Integer kills = getIntProp(teamEntity, prefix + "m_iKills", prefix + "m_iHeroKills");
            player.kills = kills != null ? kills : 0;

            Integer deaths = getIntProp(teamEntity, prefix + "m_iDeaths");
            player.deaths = deaths != null ? deaths : 0;

            Integer assists = getIntProp(teamEntity, prefix + "m_iAssists");
            player.assists = assists != null ? assists : 0;

            Integer lastHits = getIntProp(teamEntity, prefix + "m_iLastHitCount");
            player.lastHits = lastHits != null ? lastHits : 0;

            Integer denies = getIntProp(teamEntity, prefix + "m_iDenyCount", prefix + "m_iDenies");
            player.denies = denies != null ? denies : 0;

            if (matchInfo.duration > 0) {
                Integer totalGold = getIntProp(teamEntity, prefix + "m_iTotalEarnedGold");
                player.goldTotal = totalGold != null ? totalGold : 0;
                player.gpm = totalGold != null ? (int) ((totalGold * 60.0f) / matchInfo.duration) : 0;

                Integer totalXP = getIntProp(teamEntity, prefix + "m_iTotalEarnedXP");
                player.xpm = totalXP != null ? (int) ((totalXP * 60.0f) / matchInfo.duration) : 0;
            }

            Integer level = getIntProp(teamEntity, prefix + "m_iLevel");
            player.level = level != null ? level : 1;
        }
    }

    // Fills in identity fields (name, team, hero) from sources that are indexed
    // directly by m_iPlayerID and don't depend on guessing which numbering
    // convention a given replay uses: CDOTA_PlayerResource.m_vecPlayerData is
    // always indexed 0-9 by player slot, matching m_iPlayerID on hero entities.
    private void applyAuthoritativePlayerData(PlayerInfo player, int playerId) {
        String prefix = String.format("m_vecPlayerData.%04d.", playerId);

        String realName = getStringProp(playerResource, prefix + "m_iszPlayerName");
        if (realName != null && !realName.isEmpty()) {
            player.playerName = realName;
        } else if (player.playerName == null) {
            player.playerName = "Player " + (playerId + 1);
        }

        Integer team = getIntProp(playerResource, prefix + "m_iPlayerTeam");
        if (team != null) {
            player.teamId = team; // 2 = Radiant, 3 = Dire
        }

        if (player.heroName == null) {
            player.heroName = "Unknown";
        }
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

        processor.finalizeIfNeeded();
        processor.writeJson();
    }
}
