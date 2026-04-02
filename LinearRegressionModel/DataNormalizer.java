package ncaa;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class DataNormalizer {

    private static final double BLOWOUT_CAP = 40.0;

    public static void main(String[] args) throws IOException {
        normalizeData("merged-differential-model-2026.csv", "normalized-differential-model-2026.csv");
    }

    private static void normalizeData(String inputPath, String outputPath) throws IOException {
        List<String[]> data = new ArrayList<>();
        String[] header = null;

        int predictorStart = 2;
        int predictorEndExclusive = -1;
        int adjustDiffIndex = -1;

        double[] sums = null;
        double[] sumSquares = null;
        int rowCount = 0;

        try (BufferedReader reader = new BufferedReader(new FileReader(inputPath))) {
            String line;
            boolean firstLine = true;

            while ((line = reader.readLine()) != null) {
                if (line.trim().isEmpty()) {
                    continue;
                }

                String[] parts = line.split(",");

                if (firstLine) {
                    header = parts;
                    firstLine = false;

                    if (parts.length < 6) {
                        throw new IOException("Expected at least 6 columns in header, found " + parts.length);
                    }

                    // Layout:
                    // 0 = team1
                    // 1 = team2
                    // 2..(n-3) = predictors (all t1/t2 stats, whatever count exists)
                    // n-2 = adjust_diff
                    // n-1 = total_points
                    predictorEndExclusive = parts.length - 2;
                    adjustDiffIndex = parts.length - 2;

                    int predictorCount = predictorEndExclusive - predictorStart;
                    if (predictorCount <= 0 || predictorCount % 2 != 0) {
                        throw new IOException(
                            "Unexpected column layout. Predictor block must be positive and even-sized. " +
                            "Header columns found: " + parts.length
                        );
                    }

                    sums = new double[parts.length];
                    sumSquares = new double[parts.length];
                    continue;
                }

                if (parts.length != header.length) {
                    throw new IOException(
                        "Row has " + parts.length + " columns but header has " + header.length + ": " + line
                    );
                }

                for (int i = predictorStart; i < predictorEndExclusive; i++) {
                    double value = Double.parseDouble(parts[i]);
                    sums[i] += value;
                    sumSquares[i] += value * value;
                }

                data.add(parts);
                rowCount++;
            }
        }

        if (rowCount == 0) {
            throw new IOException("No data rows found in input file.");
        }

        double[] means = new double[sums.length];
        double[] stdDevs = new double[sums.length];

        for (int i = predictorStart; i < predictorEndExclusive; i++) {
            means[i] = sums[i] / rowCount;
            double variance = (sumSquares[i] / rowCount) - (means[i] * means[i]);
            stdDevs[i] = variance <= 0.0 ? 1.0 : Math.sqrt(variance);
        }

        for (String[] row : data) {
            for (int i = predictorStart; i < predictorEndExclusive; i++) {
                double value = Double.parseDouble(row[i]);
                double normalizedValue = (value - means[i]) / stdDevs[i];
                row[i] = String.valueOf(normalizedValue);
            }

            double diff = Double.parseDouble(row[adjustDiffIndex]);

            if (diff > BLOWOUT_CAP) {
                diff = BLOWOUT_CAP;
            } else if (diff < -BLOWOUT_CAP) {
                diff = -BLOWOUT_CAP;
            }

            row[adjustDiffIndex] = String.valueOf(diff);
        }

        try (FileWriter writer = new FileWriter(outputPath)) {
            if (header != null) {
                writer.write(String.join(",", header));
                writer.write("\n");
            }

            for (String[] row : data) {
                writer.write(String.join(",", row));
                writer.write("\n");
            }
        }

        System.out.println("Normalization complete.");
        System.out.println("Rows processed: " + rowCount);
        System.out.println("Predictor normalization: z-score");
        System.out.println("Target normalization: none");
        System.out.println("Blowout cap: +/-" + BLOWOUT_CAP);
        System.out.println("Predictor columns normalized: " + predictorStart + " to " + (predictorEndExclusive - 1));
        System.out.println("Target column capped: " + adjustDiffIndex);
    }
}