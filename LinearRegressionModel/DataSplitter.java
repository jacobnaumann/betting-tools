package ncaa;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class DataSplitter {

    public static void main(String[] args) throws IOException {
        splitDataChronologically(
            "normalized-differential-model-2026.csv",
            "normalized-differential-model-training-2026.csv",
            "normalized-differential-model-testing-2026.csv",
            0.90
        );
    }

    private static void splitDataChronologically(String inputPath,
                                                 String trainingPath,
                                                 String testingPath,
                                                 double trainingRatio) throws IOException {
        List<String[]> data = new ArrayList<>();
        String[] header = null;

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
                    continue;
                }

                data.add(parts);
            }
        }

        if (header == null) {
            throw new IOException("Input file is empty: " + inputPath);
        }

        int trainingSize = (int) (data.size() * trainingRatio);

        try (FileWriter writer = new FileWriter(trainingPath)) {
            writer.write(String.join(",", header));
            writer.write("\n");

            for (int i = 0; i < trainingSize; i++) {
                writer.write(String.join(",", data.get(i)));
                writer.write("\n");
            }
        }

        try (FileWriter writer = new FileWriter(testingPath)) {
            writer.write(String.join(",", header));
            writer.write("\n");

            for (int i = trainingSize; i < data.size(); i++) {
                writer.write(String.join(",", data.get(i)));
                writer.write("\n");
            }
        }

        System.out.println("Chronological split complete.");
        System.out.println("Training rows: " + trainingSize);
        System.out.println("Testing rows: " + (data.size() - trainingSize));
    }
}