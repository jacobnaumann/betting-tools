package ncaa;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public class DatasetMerger {

    private static String statsHeader = "";

    public static void main(String[] args) throws IOException {
        Map<String, String> teamStats = readTeamStats("2025-26-TEAM-STATS-CHATGPT.csv");
        mergeDatasets("FINAL-RESULTS-2026-BY-DATE.csv", teamStats, "merged-differential-model-2026.csv");
    }

    private static Map<String, String> readTeamStats(String filePath) throws IOException {
        Map<String, String> teamStats = new HashMap<>();

        try (BufferedReader reader = new BufferedReader(new FileReader(filePath))) {
            String header = reader.readLine();

            if (header == null) {
                throw new IOException("Stats file is empty.");
            }

            // Remove BOM if present
            header = header.replace("\uFEFF", "");

            String[] headerParts = header.split(",");
            if (headerParts.length < 2) {
                throw new IOException("Stats file header is malformed.");
            }

            // Everything after team_original is treated as a stat column.
            // This now automatically supports the removal of "rating".
            statsHeader = String.join(",", Arrays.copyOfRange(headerParts, 1, headerParts.length));

            String line;
            int lineNum = 1;

            while ((line = reader.readLine()) != null) {
                lineNum++;

                if (line.trim().isEmpty()) {
                    continue;
                }

                String[] parts = line.split(",");

                if (parts.length != headerParts.length) {
                    System.out.println("Skipping malformed stats line " + lineNum + ": " + line);
                    continue;
                }

                String team = normalizeTeamName(parts[0].trim());
                String stats = String.join(",", Arrays.copyOfRange(parts, 1, parts.length));

                teamStats.put(team, stats);
            }
        }

        System.out.println("Loaded team stats for " + teamStats.size() + " teams.");
        System.out.println("Stats columns being merged: " + statsHeader);
        return teamStats;
    }

    private static void mergeDatasets(String resultsPath,
                                      Map<String, String> teamStats,
                                      String outputPath) throws IOException {

        try (BufferedReader reader = new BufferedReader(new FileReader(resultsPath));
             BufferedWriter writer = new BufferedWriter(new FileWriter(outputPath))) {

            String header = reader.readLine();

            if (header == null) {
                throw new IOException("Results file is empty.");
            }

            String mergedHeader =
                    "team1,team2," +
                    prefixHeader(statsHeader, "t1_") + "," +
                    prefixHeader(statsHeader, "t2_") + "," +
                    "adjust_diff,total_points";

            writer.write(mergedHeader);
            writer.newLine();

            String line;
            int lineNum = 1;
            int mergedCount = 0;

            while ((line = reader.readLine()) != null) {
                lineNum++;

                if (line.trim().isEmpty()) {
                    continue;
                }

                String[] parts = line.split(",");

                if (parts.length < 4) {
                    System.out.println("Skipping malformed result row " + lineNum + ": " + line);
                    continue;
                }

                String team1Raw = parts[0].trim();
                String team2Raw = parts[1].trim();
                String adjustDiff = parts[2].trim();
                String totalPoints = parts[3].trim();

                String stats1 = lookupTeamStats(team1Raw, teamStats);
                String stats2 = lookupTeamStats(team2Raw, teamStats);

                if (stats1 == null) {
                    throw new RuntimeException("Missing stats for team: " + team1Raw + " (line " + lineNum + ")");
                }

                if (stats2 == null) {
                    throw new RuntimeException("Missing stats for team: " + team2Raw + " (line " + lineNum + ")");
                }

                String mergedLine =
                        team1Raw + "," +
                        team2Raw + "," +
                        stats1 + "," +
                        stats2 + "," +
                        adjustDiff + "," +
                        totalPoints;

                writer.write(mergedLine);
                writer.newLine();
                mergedCount++;
            }

            System.out.println("Merged rows written: " + mergedCount);
        }
    }

    private static String lookupTeamStats(String teamName, Map<String, String> teamStats) {
        String normalized = normalizeTeamName(teamName);

        String direct = teamStats.get(normalized);
        if (direct != null) {
            return direct;
        }

        String[] variants = new String[] {
                normalized.replace(" st", " state"),
                normalized.replace(" state", " st"),
                normalized.replace(" la", " louisiana"),
                normalized.replace(" louisiana", " la"),
                normalized.replace(" uconn", " connecticut"),
                normalized.replace(" usc upstate", " south carolina upstate"),
                normalized.replace(" unc wilmington", " north carolina wilmington"),
                normalized.replace(" unc greensboro", " north carolina greensboro"),
                normalized.replace(" siue", " southern illinois edwardsville"),
                normalized.replace(" ualbany", " albany"),
                normalized.replace(" byu", " brigham young")
        };

        for (String variant : variants) {
            String found = teamStats.get(variant);
            if (found != null) {
                return found;
            }
        }

        return null;
    }

    private static String prefixHeader(String header, String prefix) {
        String[] parts = header.split(",");

        for (int i = 0; i < parts.length; i++) {
            parts[i] = prefix + parts[i].trim();
        }

        return String.join(",", parts);
    }

    private static String normalizeTeamName(String name) {
        return name
                .toLowerCase()
                .replace("'", "")
                .replace(".", "")
                .replace("&", "and")
                .replace("-", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }
}