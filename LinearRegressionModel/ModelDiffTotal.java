package ncaa;

import weka.classifiers.Evaluation;
import weka.classifiers.functions.LinearRegression;
import weka.core.Attribute;
import weka.core.DenseInstance;
import weka.core.Instance;
import weka.core.Instances;
import weka.core.converters.CSVLoader;
import weka.filters.Filter;
import weka.filters.unsupervised.attribute.NumericToNominal;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.Scanner;
import java.util.List;
import java.util.Collections;

public class ModelDiffTotal {

    private static final int TEAM1_NAME_INDEX = 0;
    private static final int TEAM2_NAME_INDEX = 1;
    private static final int TEAM1_STATS_START = 2;

    private static final int DEFAULT_CV_FOLDS = 10;
    private static final double DEFAULT_RIDGE = 1.0e-4;

    private Instances loadData(String filename) throws Exception {
        System.out.println("Loading data from file: " + filename);

        File originalFile = new File(filename);
        File sanitizedFile = new File("sanitized-" + filename);

        try (
            BufferedReader reader = new BufferedReader(new FileReader(originalFile));
            FileWriter writer = new FileWriter(sanitizedFile)
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.replace("'", "");
                writer.write(line);
                writer.write("\n");
            }
        }

        CSVLoader loader = new CSVLoader();
        loader.setSource(sanitizedFile);
        Instances data = loader.getDataSet();

        if (!data.attribute(0).isNominal() || !data.attribute(1).isNominal()) {
            data = convertToNominal(data, "1-2");
        }

        validateRawLayout(data);

        System.out.println("Data loaded.");
        System.out.println("Rows: " + data.numInstances());
        System.out.println("Columns: " + data.numAttributes());

        return data;
    }

    private Instances convertToNominal(Instances data, String indices) throws Exception {
        NumericToNominal convert = new NumericToNominal();
        convert.setAttributeIndices(indices);
        convert.setInputFormat(data);
        return Filter.useFilter(data, convert);
    }

    private void validateRawLayout(Instances rawData) {
        if (rawData.numAttributes() < 6) {
            throw new IllegalStateException(
                "Expected at least 6 columns, but found " + rawData.numAttributes()
            );
        }

        // Layout:
        // 0 = team1
        // 1 = team2
        // 2..(n-3) = stat columns for both teams
        // n-2 = adjust_diff
        // n-1 = total_points
        int statColumns = rawData.numAttributes() - 4;
        if (statColumns <= 0 || statColumns % 2 != 0) {
            throw new IllegalStateException(
                "Unexpected dataset layout. Found " + rawData.numAttributes() +
                " columns, which does not produce an even stat block for both teams."
            );
        }
    }

    private int getStatsPerTeam(Instances rawData) {
        return (rawData.numAttributes() - 4) / 2;
    }

    private int getTeam1StatsEnd(Instances rawData) {
        return TEAM1_STATS_START + getStatsPerTeam(rawData) - 1;
    }

    private int getTeam2StatsStart(Instances rawData) {
        return getTeam1StatsEnd(rawData) + 1;
    }

    private int getTeam2StatsEnd(Instances rawData) {
        return getTeam2StatsStart(rawData) + getStatsPerTeam(rawData) - 1;
    }

    private int getAdjustDiffIndex(Instances rawData) {
        return rawData.numAttributes() - 2;
    }

    private int getTargetIndex(Instances rawData) {
        return rawData.numAttributes() - 1;
    }

    private ArrayList<Attribute> buildTotalAttributes(Instances rawData) {
        ArrayList<Attribute> attributes = new ArrayList<>();

        int team1StatsEnd = getTeam1StatsEnd(rawData);
        int team2StatsStart = getTeam2StatsStart(rawData);
        int team2StatsEnd = getTeam2StatsEnd(rawData);

        for (int i = TEAM1_STATS_START; i <= team1StatsEnd; i++) {
            attributes.add(new Attribute(rawData.attribute(i).name()));
        }

        for (int i = team2StatsStart; i <= team2StatsEnd; i++) {
            attributes.add(new Attribute(rawData.attribute(i).name()));
        }

        attributes.add(new Attribute("total_points"));
        return attributes;
    }

    private Instances buildTotalDataset(Instances rawData) {
        ArrayList<Attribute> attributes = buildTotalAttributes(rawData);

        Instances totalData = new Instances(
            "total_model_data",
            attributes,
            rawData.numInstances()
        );
        totalData.setClassIndex(totalData.numAttributes() - 1);

        int statsPerTeam = getStatsPerTeam(rawData);
        int team2StatsStart = getTeam2StatsStart(rawData);
        int targetIndex = getTargetIndex(rawData);

        for (int i = 0; i < rawData.numInstances(); i++) {
            Instance raw = rawData.instance(i);

            double[] values = new double[(statsPerTeam * 2) + 1];
            int idx = 0;

            for (int j = 0; j < statsPerTeam; j++) {
                values[idx++] = raw.value(TEAM1_STATS_START + j);
            }

            for (int j = 0; j < statsPerTeam; j++) {
                values[idx++] = raw.value(team2StatsStart + j);
            }

            values[idx] = raw.value(targetIndex);

            totalData.add(new DenseInstance(1.0, values));
        }

        return totalData;
    }

    private LinearRegression createRegressionModel() {
        LinearRegression lr = new LinearRegression();
        lr.setRidge(DEFAULT_RIDGE);
        return lr;
    }

    public LinearRegression trainModel(Instances rawData) throws Exception {
        System.out.println("Training total-points model...");

        Instances modelData = buildTotalDataset(rawData);

        System.out.println("Attributes used for training:");
        for (int i = 0; i < modelData.numAttributes(); i++) {
            System.out.println("Index " + i + ": " + modelData.attribute(i).name());
        }

        System.out.println("Target variable set to: " + modelData.classAttribute().name());

        LinearRegression lr = createRegressionModel();
        lr.buildClassifier(modelData);

        System.out.println("Model trained.");
        return lr;
    }

    public void displayModelStats(Instances rawData) throws Exception {
        System.out.println("Starting evaluation...");

        Instances evalData = buildTotalDataset(new Instances(rawData));

        int folds = DEFAULT_CV_FOLDS;
        Evaluation evaluation = new Evaluation(evalData);
        Random random = new Random(1);
        evalData.randomize(random);

        for (int n = 0; n < folds; n++) {
            System.out.println("Processing fold " + (n + 1) + " of " + folds + "...");

            Instances train = evalData.trainCV(folds, n);
            Instances test = evalData.testCV(folds, n);

            LinearRegression lrCopy = createRegressionModel();
            lrCopy.buildClassifier(train);
            evaluation.evaluateModel(lrCopy, test);

            System.out.println("Completed fold " + (n + 1));
        }

        System.out.println("Cross-validation completed.");
        System.out.println("=== Evaluation statistics ===");
        System.out.printf("Target attribute: %s%n", evalData.classAttribute().name());
        System.out.printf("Correlation coefficient: %.3f%n", evaluation.correlationCoefficient());
        System.out.printf("Mean absolute error: %.3f%n", evaluation.meanAbsoluteError());
        System.out.printf("Root mean squared error: %.3f%n", evaluation.rootMeanSquaredError());
        System.out.printf("Relative absolute error: %.3f%%%n", evaluation.relativeAbsoluteError());
    }

    public void displayHeldOutTestStats(LinearRegression model, Instances rawTestData) throws Exception {
        System.out.println("Starting held-out test evaluation...");

        Instances testData = buildTotalDataset(new Instances(rawTestData));

        Evaluation evaluation = new Evaluation(testData);
        evaluation.evaluateModel(model, testData);

        System.out.println("Held-out test evaluation completed.");
        System.out.println("=== Held-out Test Statistics ===");
        System.out.printf("Target attribute: %s%n", testData.classAttribute().name());
        System.out.printf("Correlation coefficient: %.3f%n", evaluation.correlationCoefficient());
        System.out.printf("Mean absolute error: %.3f%n", evaluation.meanAbsoluteError());
        System.out.printf("Root mean squared error: %.3f%n", evaluation.rootMeanSquaredError());
        System.out.printf("Relative absolute error: %.3f%%%n", evaluation.relativeAbsoluteError());
    }

    public void printTargetDistribution(String label, Instances rawData) {
        Instances modelData = buildTotalDataset(new Instances(rawData));
        int classIndex = modelData.classIndex();

        double min = Double.POSITIVE_INFINITY;
        double max = Double.NEGATIVE_INFINITY;
        double sum = 0.0;

        for (int i = 0; i < modelData.numInstances(); i++) {
            double value = modelData.instance(i).value(classIndex);
            sum += value;
            min = Math.min(min, value);
            max = Math.max(max, value);
        }

        double mean = sum / modelData.numInstances();

        double varianceSum = 0.0;
        for (int i = 0; i < modelData.numInstances(); i++) {
            double value = modelData.instance(i).value(classIndex);
            varianceSum += Math.pow(value - mean, 2);
        }

        double stdDev = Math.sqrt(varianceSum / modelData.numInstances());

        System.out.println("=== Target Distribution: " + label + " ===");
        System.out.printf("Target attribute: %s%n", modelData.classAttribute().name());
        System.out.printf("Rows: %d%n", modelData.numInstances());
        System.out.printf("Mean: %.3f%n", mean);
        System.out.printf("Std Dev: %.3f%n", stdDev);
        System.out.printf("Min: %.3f%n", min);
        System.out.printf("Max: %.3f%n", max);
    }

    public Map<String, double[]> extractTeamData(Instances rawData) {
        Map<String, double[]> teamDataMap = new HashMap<>();

        int statsPerTeam = getStatsPerTeam(rawData);
        int team1StatsEnd = getTeam1StatsEnd(rawData);
        int team2StatsEnd = getTeam2StatsEnd(rawData);

        for (int i = 0; i < rawData.numInstances(); i++) {
            Instance instance = rawData.instance(i);

            String team1 = normalizeTeamName(instance.stringValue(TEAM1_NAME_INDEX));
            if (!teamDataMap.containsKey(team1)) {
                double[] stats = new double[statsPerTeam];
                int statIndex = 0;
                for (int j = TEAM1_STATS_START; j <= team1StatsEnd; j++) {
                    stats[statIndex++] = instance.value(j);
                }
                teamDataMap.put(team1, stats);
            }

            String team2 = normalizeTeamName(instance.stringValue(TEAM2_NAME_INDEX));
            if (!teamDataMap.containsKey(team2)) {
                double[] stats = new double[statsPerTeam];
                int statIndex = 0;
                for (int j = getTeam2StatsStart(rawData); j <= team2StatsEnd; j++) {
                    stats[statIndex++] = instance.value(j);
                }
                teamDataMap.put(team2, stats);
            }
        }

        return teamDataMap;
    }

    public Instance combineTeamData(double[] team1Stats, double[] team2Stats, Instances rawData) {
        ArrayList<Attribute> attributes = buildTotalAttributes(rawData);
        Instances predictionStructure = new Instances("prediction_data", attributes, 0);
        predictionStructure.setClassIndex(predictionStructure.numAttributes() - 1);

        int statsPerTeam = getStatsPerTeam(rawData);
        double[] values = new double[(statsPerTeam * 2) + 1];
        int idx = 0;

        for (int i = 0; i < statsPerTeam; i++) {
            values[idx++] = team1Stats[i];
        }

        for (int i = 0; i < statsPerTeam; i++) {
            values[idx++] = team2Stats[i];
        }

        values[idx] = 0.0;

        Instance combinedInstance = new DenseInstance(1.0, values);
        combinedInstance.setDataset(predictionStructure);

        return combinedInstance;
    }

    public Double predictTotal(String team1, String team2, Instances rawData, LinearRegression model) {
        try {
            team1 = normalizeTeamName(team1);
            team2 = normalizeTeamName(team2);

            System.out.println("Predicting total for " + team1 + " vs. " + team2 + "...");

            Map<String, double[]> teamDataMap = extractTeamData(rawData);
            double[] team1Stats = teamDataMap.get(team1);
            double[] team2Stats = teamDataMap.get(team2);

            if (team1Stats == null || team2Stats == null) {
                System.out.println("One or both team names were not found.");
                if (team1Stats == null) {
                    System.out.println("Missing team: " + team1);
                }
                if (team2Stats == null) {
                    System.out.println("Missing team: " + team2);
                }
                return null;
            }

            Instance combinedInstance = combineTeamData(team1Stats, team2Stats, rawData);
            double prediction = model.classifyInstance(combinedInstance);

            System.out.println("Prediction completed.");
            return prediction;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    public Double predictSymmetricTotal(String team1, String team2, Instances rawData, LinearRegression model) {
        Double forward = predictTotal(team1, team2, rawData, model);
        Double reverse = predictTotal(team2, team1, rawData, model);

        if (forward == null || reverse == null) {
            return null;
        }

        return (forward + reverse) / 2.0;
    }

    private List<String> getKnownTeams(Instances rawData) {
        Map<String, double[]> teamDataMap = extractTeamData(rawData);
        List<String> teams = new ArrayList<>(teamDataMap.keySet());
        Collections.sort(teams);
        return teams;
    }

    private int similarityScore(String a, String b) {
        a = normalizeTeamName(a);
        b = normalizeTeamName(b);

        if (a.equals(b)) {
            return 1000;
        }

        int score = 0;

        if (a.startsWith(b) || b.startsWith(a)) {
            score += 40;
        }

        if (a.contains(b) || b.contains(a)) {
            score += 25;
        }

        String[] aParts = a.split(" ");
        String[] bParts = b.split(" ");

        for (String ap : aParts) {
            for (String bp : bParts) {
                if (ap.equals(bp)) {
                    score += 10;
                } else if (ap.length() >= 3 && bp.length() >= 3 &&
                           (ap.startsWith(bp.substring(0, 3)) || bp.startsWith(ap.substring(0, 3)))) {
                    score += 4;
                }
            }
        }

        score -= Math.abs(a.length() - b.length());

        return score;
    }

    private List<String> findClosestTeamMatches(String input, Instances rawData, int maxSuggestions) {
        List<String> knownTeams = getKnownTeams(rawData);
        List<String> bestMatches = new ArrayList<>();

        knownTeams.sort((t1, t2) -> Integer.compare(
            similarityScore(t2, input),
            similarityScore(t1, input)
        ));

        for (String team : knownTeams) {
            if (bestMatches.size() >= maxSuggestions) {
                break;
            }
            bestMatches.add(team);
        }

        return bestMatches;
    }

    private String resolveTeamName(String input, Instances rawData) {
        if (input == null || input.trim().isEmpty()) {
            return null;
        }

        String normalizedInput = normalizeTeamName(input);
        Map<String, double[]> teamDataMap = extractTeamData(rawData);

        if (teamDataMap.containsKey(normalizedInput)) {
            return normalizedInput;
        }

        List<String> aliases = new ArrayList<>();
        aliases.add(normalizedInput.replace(" state", " st"));
        aliases.add(normalizedInput.replace(" st", " state"));
        aliases.add(normalizedInput.replace(" saint ", " st "));
        aliases.add(normalizedInput.replace(" st ", " saint "));
        aliases.add(normalizedInput.replace(" and ", " "));
        aliases.add(normalizedInput.replace(" university", ""));
        aliases.add(normalizedInput.replace(" univ", ""));
        aliases.add(normalizedInput.replace(" of ", " "));

        if (normalizedInput.startsWith("saint ")) {
            aliases.add("st " + normalizedInput.substring(6));
        }
        if (normalizedInput.startsWith("st ")) {
            aliases.add("saint " + normalizedInput.substring(3));
        }

        for (String alias : aliases) {
            alias = normalizeTeamName(alias);
            if (teamDataMap.containsKey(alias)) {
                return alias;
            }
        }

        return null;
    }

    private static void printResult(String team1, String team2, Double totalPrediction) {
        System.out.println("========================================");
        System.out.println("MATCHUP TOTAL RESULT");
        System.out.println("========================================");
        System.out.println(team1 + " vs " + team2);

        if (totalPrediction == null) {
            System.out.println("Could not make a total prediction.");
            return;
        }

        System.out.printf("Projected total: %.2f%n", totalPrediction);
    }

    private static String normalizeTeamName(String name) {
        if (name == null) {
            return "";
        }

        return name
            .toLowerCase()
            .replace("'", "")
            .replace(".", "")
            .replace("&", "and")
            .replace("-", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        try {
            ModelDiffTotal model = new ModelDiffTotal();

            Instances trainingData = model.loadData("normalized-differential-model-training-2026.csv");
            Instances testingData = model.loadData("normalized-differential-model-testing-2026.csv");

            model.printTargetDistribution("Training Set", trainingData);
            model.printTargetDistribution("Testing Set", testingData);

            LinearRegression lr = model.trainModel(trainingData);

            model.displayModelStats(trainingData);
            model.displayHeldOutTestStats(lr, testingData);

            System.out.println("\nModel ready.");

            while (true) {
                System.out.println("1 - Predict a single game total");
                System.out.println("2 - Exit");
                System.out.print("Enter choice: ");

                String choice = scanner.nextLine().trim();

                if (choice.equals("2") || choice.equalsIgnoreCase("exit")) {
                    break;
                }

                if (choice.equals("1")) {
                    System.out.println("\nEnter team names exactly as they appear in your dataset.");
                    System.out.println("Type 'exit' at any prompt to return to menu.\n");

                    System.out.print("Enter the name of the first team: ");
                    String team1Input = scanner.nextLine();
                    if (team1Input.equalsIgnoreCase("exit")) {
                        continue;
                    }

                    System.out.print("Enter the name of the second team: ");
                    String team2Input = scanner.nextLine();
                    if (team2Input.equalsIgnoreCase("exit")) {
                        continue;
                    }

                    String team1 = model.resolveTeamName(team1Input, trainingData);
                    String team2 = model.resolveTeamName(team2Input, trainingData);

                    if (team1 == null) {
                        System.out.println("Team not found: " + team1Input);
                        List<String> suggestions = model.findClosestTeamMatches(team1Input, trainingData, 5);
                        if (!suggestions.isEmpty()) {
                            System.out.println("Suggestions: " + String.join(", ", suggestions));
                        }
                        continue;
                    }

                    if (team2 == null) {
                        System.out.println("Team not found: " + team2Input);
                        List<String> suggestions = model.findClosestTeamMatches(team2Input, trainingData, 5);
                        if (!suggestions.isEmpty()) {
                            System.out.println("Suggestions: " + String.join(", ", suggestions));
                        }
                        continue;
                    }

                    Double totalPrediction = model.predictSymmetricTotal(team1, team2, trainingData, lr);
                    printResult(team1, team2, totalPrediction);
                    System.out.println();

                } else {
                    System.out.println("Invalid option. Please enter 1 or 2.");
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            scanner.close();
        }
    }
}