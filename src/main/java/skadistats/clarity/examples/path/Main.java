package skadistats.clarity.examples.path;

import skadistats.clarity.model.Entity;
import skadistats.clarity.processor.entities.OnEntityCreated;
import skadistats.clarity.processor.reader.OnTickStart;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.source.MappedFileSource;
import skadistats.clarity.source.Source;

import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class Main {

    private static class Sample {
        public float t;
        public float x;
        public float y;

        public int lastHits;
        public int creepKillGold;
        public int neutralKillGold;
        public int heroKillGold;
    }

    // Time limit: 22 minutes
    private static final float MAX_TIME_SECONDS = 21.5f * 60f;
    private static final int SAMPLE_EVERY_N_TICKS = 8;
    private static final float TICKRATE = 30.0f;

    private final int playerSlot;
    private final String outputPath;

    private final List<Sample> samples = new ArrayList<>();
    private Entity trackedHero;
    private int trackedHeroPlayerId = -1;

    private Entity dataRadiant;
    private Entity dataDire;
    private int lastSampledTick = -1;
    private Float firstTime = null;

    public Main(int playerSlot, String outputPath) {
        this.playerSlot = playerSlot;
        this.outputPath = outputPath;
    }

    // --- helpers ---

    private Float getFloatProp(Entity e, String... names) {
        if (e == null) return null;
        for (String n : names) {
            try {
                Float v = e.getProperty(n);
                if (v != null) return v;
            } catch (IllegalArgumentException ignored) {
                // property not present
            }
        }
        return null;
    }

    private Integer getIntProp(Entity e, String... names) {
        if (e == null) return null;
        for (String n : names) {
            try {
                Integer v = e.getProperty(n);
                if (v != null) return v;
            } catch (IllegalArgumentException ignored) {
                // property not present
            }
        }
        return null;
    }

    // Compute team entity + index inside m_vecDataTeam based on trackedHeroPlayerId
    private Integer getTeamIntStat(String suffix) {
        if (trackedHeroPlayerId < 0) return null;

        Entity teamEntity;
        int index;

        // From your logs: Radiant IDs = 0,2,4,6,8  → index = id / 2
        // Dire IDs = 10,12,14,16,18              → index = (id - 10) / 2
        if (trackedHeroPlayerId <= 8) {
            teamEntity = dataRadiant;
            index = trackedHeroPlayerId / 2;
        } else {
            teamEntity = dataDire;
            index = (trackedHeroPlayerId - 10) / 2;
        }

        if (teamEntity == null || index < 0 || index > 4) {
            return null;
        }

        String key = String.format("m_vecDataTeam.%04d.%s", index, suffix);
        return getIntProp(teamEntity, key);
    }

    // --- processors ---

    @OnEntityCreated
    public void onEntityCreated(Context ctx, Entity e) {
        String dtName = e.getDtClass().getDtName();

        if ("CDOTA_DataRadiant".equals(dtName)) {
            dataRadiant = e;
        }

        if ("CDOTA_DataDire".equals(dtName)) {
            dataDire = e;
        }

        if (dtName.startsWith("CDOTA_Unit_Hero_")) {
            Integer pid = getIntProp(e, "m_iPlayerID");

            System.out.printf(
                "[HERO] PlayerID=%s  Entity=%s  entIndex=%d%n",
                pid == null ? "?" : pid,
                dtName,
                e.getIndex()
            );

            // We track the hero whose PlayerID == playerSlot argument
            if (pid != null && pid == playerSlot) {
                trackedHero = e;
                trackedHeroPlayerId = pid;
                System.out.printf(
                    ">>> Tracking hero %s (playerSlot=%d, PlayerID=%d, entIndex=%d)%n",
                    dtName, playerSlot, pid, e.getIndex()
                );
            }
        }
    }

    @OnTickStart
    public void onTickStart(Context ctx, boolean synthetic) {
        if (trackedHero == null) return;

        int tick = ctx.getTick();
        float currentTime = tick / TICKRATE;

        if (firstTime == null) firstTime = currentTime;
        float relativeTime = currentTime - firstTime;

        if (relativeTime > MAX_TIME_SECONDS) return;

        if (lastSampledTick != -1 && (tick - lastSampledTick) < SAMPLE_EVERY_N_TICKS) return;
        lastSampledTick = tick;

        // Position
        Integer cellX = getIntProp(trackedHero, "CBodyComponent.m_cellX", "m_cellX");
        Integer cellY = getIntProp(trackedHero, "CBodyComponent.m_cellY", "m_cellY");

        Float vecX = getFloatProp(trackedHero,
            "CBodyComponent.m_vecOrigin.x",
            "CBodyComponent.m_vecOrigin[0]",
            "CBodyComponent.m_vecX",
            "m_vecX",
            "m_vecOrigin[0]"
        );
        Float vecY = getFloatProp(trackedHero,
            "CBodyComponent.m_vecOrigin.y",
            "CBodyComponent.m_vecOrigin[1]",
            "CBodyComponent.m_vecY",
            "m_vecY",
            "m_vecOrigin[1]"
        );

        float worldX;
        float worldY;

        if (cellX != null && cellY != null) {
            float lx = vecX != null ? vecX : 0f;
            float ly = vecY != null ? vecY : 0f;
            worldX = cellX * 128.0f + lx;
            worldY = cellY * 128.0f + ly;
        } else {
            Float fx = getFloatProp(trackedHero, "m_vecOrigin[0]");
            Float fy = getFloatProp(trackedHero, "m_vecOrigin[1]");
            if (fx == null || fy == null) return;
            worldX = fx;
            worldY = fy;
        }

        // Stats from CDOTA_DataRadiant / CDOTA_DataDire via PlayerID mapping
        Integer lh = getTeamIntStat("m_iLastHitCount");
        Integer creep = getTeamIntStat("m_iCreepKillGold");
        Integer neutral = getTeamIntStat("m_iNeutralKillGold");
        Integer heroG = getTeamIntStat("m_iHeroKillGold");

        Sample s = new Sample();
        s.t = relativeTime;
        s.x = worldX;
        s.y = worldY;

        s.lastHits = lh != null ? lh : 0;
        s.creepKillGold = creep != null ? creep : 0;
        s.neutralKillGold = neutral != null ? neutral : 0;
        s.heroKillGold = heroG != null ? heroG : 0;

        samples.add(s);
    }

    private void writeJson() throws IOException {
        try (FileWriter fw = new FileWriter(outputPath)) {
            fw.write("[\n");
            for (int i = 0; i < samples.size(); i++) {
                Sample s = samples.get(i);

                fw.write(String.format(Locale.US,
                    "  {\"t\": %.3f, \"x\": %.3f, \"y\": %.3f, \"lastHits\": %d, \"creepGold\": %d, \"neutralGold\": %d, \"heroKillGold\": %d}",
                    s.t, s.x, s.y,
                    s.lastHits,
                    s.creepKillGold,
                    s.neutralKillGold,
                    s.heroKillGold
                ));

                if (i < samples.size() - 1) {
                    fw.write(",\n");
                } else {
                    fw.write("\n");
                }
            }
            fw.write("]\n");
        }
        System.out.printf("Saved %d samples to %s%n", samples.size(), outputPath);
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("Usage: pathRun <replay.dem> <player_slot_m_iPlayerID> <output.json>");
            System.exit(1);
        }

        String replayPath = args[0];
        int playerSlot = Integer.parseInt(args[1]);  // here: use PlayerID (0,2,4,6,8,10,12,...)
        String outputPath = args[2];

        Source source = new MappedFileSource(replayPath);
        Main processor = new Main(playerSlot, outputPath);

        SimpleRunner runner = new SimpleRunner(source);
        runner.runWith(processor);

        processor.writeJson();
    }
}
