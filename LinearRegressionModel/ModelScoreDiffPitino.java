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
import java.util.Comparator;

public class ModelScoreDiffPitino {

    private static final int TEAM1_NAME_INDEX = 0;
    private static final int TEAM2_NAME_INDEX = 1;
    private static final int TEAM1_STATS_START = 2;

    private double lastHeldOutRmse = -1.0;

    private static final int DEFAULT_CV_FOLDS = 10;
    private static final double DEFAULT_RIDGE = 1.0e-4;
    private static final double DEFAULT_PROBABILITY_SIGMA = 11.0;

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

    private int getTargetIndex(Instances rawData) {
        return rawData.numAttributes() - 2;
    }

    private String buildDiffAttributeName(String rawAttributeName) {
        String name = rawAttributeName.trim();

        if (name.startsWith("t1_")) {
            name = name.substring(3);
        } else if (name.startsWith("t2_")) {
            name = name.substring(3);
        }

        return name + "_diff";
    }

    private ArrayList<Attribute> buildDifferenceAttributes(Instances rawData) {
        ArrayList<Attribute> attributes = new ArrayList<>();
        int statsPerTeam = getStatsPerTeam(rawData);

        for (int j = 0; j < statsPerTeam; j++) {
            String team1AttrName = rawData.attribute(TEAM1_STATS_START + j).name();
            attributes.add(new Attribute(buildDiffAttributeName(team1AttrName)));
        }

        attributes.add(new Attribute("adjust_diff"));
        return attributes;
    }

    private Instances buildDifferenceDataset(Instances rawData) {
        ArrayList<Attribute> attributes = buildDifferenceAttributes(rawData);

        Instances diffData = new Instances(
            "difference_model_data",
            attributes,
            rawData.numInstances() * 2
        );
        diffData.setClassIndex(diffData.numAttributes() - 1);

        int statsPerTeam = getStatsPerTeam(rawData);
        int team2StatsStart = getTeam2StatsStart(rawData);
        int targetIndex = getTargetIndex(rawData);

        for (int i = 0; i < rawData.numInstances(); i++) {
            Instance raw = rawData.instance(i);

            double[] forwardValues = new double[statsPerTeam + 1];
            double[] reverseValues = new double[statsPerTeam + 1];

            int idx = 0;
            for (int j = 0; j < statsPerTeam; j++) {
                double t1 = raw.value(TEAM1_STATS_START + j);
                double t2 = raw.value(team2StatsStart + j);

                forwardValues[idx] = t1 - t2;
                reverseValues[idx] = t2 - t1;
                idx++;
            }

            double target = raw.value(targetIndex);

            forwardValues[idx] = target;
            reverseValues[idx] = -target;

            diffData.add(new DenseInstance(1.0, forwardValues));
            diffData.add(new DenseInstance(1.0, reverseValues));
        }

        return diffData;
    }

    private LinearRegression createRegressionModel() {
        LinearRegression lr = new LinearRegression();
        lr.setRidge(DEFAULT_RIDGE);
        return lr;
    }

    public LinearRegression trainModel(Instances rawData) throws Exception {
        System.out.println("Training model...");

        Instances modelData = buildDifferenceDataset(rawData);

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

        Instances evalData = buildDifferenceDataset(new Instances(rawData));

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

        Instances testData = buildDifferenceDataset(new Instances(rawTestData));

        Evaluation evaluation = new Evaluation(testData);
        evaluation.evaluateModel(model, testData);

        lastHeldOutRmse = evaluation.rootMeanSquaredError();

        System.out.println("Held-out test evaluation completed.");
        System.out.println("=== Held-out Test Statistics ===");
        System.out.printf("Target attribute: %s%n", testData.classAttribute().name());
        System.out.printf("Correlation coefficient: %.3f%n", evaluation.correlationCoefficient());
        System.out.printf("Mean absolute error: %.3f%n", evaluation.meanAbsoluteError());
        System.out.printf("Root mean squared error: %.3f%n", evaluation.rootMeanSquaredError());
        System.out.printf("Relative absolute error: %.3f%%%n", evaluation.relativeAbsoluteError());
        System.out.printf("Stored RMSE for probability conversion: %.3f%n", lastHeldOutRmse);
    }

    public void printTargetDistribution(String label, Instances rawData) {
        Instances modelData = buildDifferenceDataset(new Instances(rawData));
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
        ArrayList<Attribute> attributes = buildDifferenceAttributes(rawData);
        Instances predictionStructure = new Instances("prediction_data", attributes, 0);
        predictionStructure.setClassIndex(predictionStructure.numAttributes() - 1);

        int statsPerTeam = getStatsPerTeam(rawData);
        double[] values = new double[statsPerTeam + 1];

        for (int i = 0; i < statsPerTeam; i++) {
            values[i] = team1Stats[i] - team2Stats[i];
        }

        values[statsPerTeam] = 0.0;

        Instance combinedInstance = new DenseInstance(1.0, values);
        combinedInstance.setDataset(predictionStructure);

        return combinedInstance;
    }

    public Double predict(String team1, String team2, Instances rawData, LinearRegression model) {
        return predict(team1, team2, rawData, model, true);
    }

    private Double predict(String team1, String team2, Instances rawData, LinearRegression model, boolean verbose) {
        try {
            team1 = normalizeTeamName(team1);
            team2 = normalizeTeamName(team2);

            if (verbose) {
                System.out.println("Predicting " + team1 + " vs. " + team2 + "...");
            }

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

            if (verbose) {
                System.out.println("Prediction completed.");
            }

            return prediction;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private static class MatchupResult {
        String team1;
        String team2;
        Double averageMargin;
        Double team1WinProbability;
        Double team2WinProbability;
        String favoredTeam;
        String underdogTeam;

        MatchupResult(String team1,
                      String team2,
                      Double averageMargin,
                      Double team1WinProbability,
                      Double team2WinProbability,
                      String favoredTeam,
                      String underdogTeam) {
            this.team1 = team1;
            this.team2 = team2;
            this.averageMargin = averageMargin;
            this.team1WinProbability = team1WinProbability;
            this.team2WinProbability = team2WinProbability;
            this.favoredTeam = favoredTeam;
            this.underdogTeam = underdogTeam;
        }
    }

    private double getProbabilitySigma() {
        if (lastHeldOutRmse > 0) {
            return lastHeldOutRmse;
        }
        return DEFAULT_PROBABILITY_SIGMA;
    }

    private MatchupResult evaluateMatchup(String team1, String team2, Instances rawData, LinearRegression model) {
        System.out.println("Predicting " + team1 + " vs. " + team2 + "...");

        Double forward = predict(team1, team2, rawData, model, false);
        Double reverse = predict(team2, team1, rawData, model, false);

        if (forward == null || reverse == null) {
            System.out.println("Prediction completed.");
            return new MatchupResult(team1, team2, null, null, null, null, null);
        }

        double avgDiff = (forward - reverse) / 2.0;
        double sigma = getProbabilitySigma();
        double team1WinProb = winProbabilityFromMargin(avgDiff, sigma);
        double team2WinProb = 1.0 - team1WinProb;

        System.out.printf("Win pct %s: %.2f%%%n", team1, team1WinProb * 100.0);
        System.out.printf("Win pct %s: %.2f%%%n", team2, team2WinProb * 100.0);
        System.out.println("Prediction completed.");

        String favoredTeam;
        String underdogTeam;

        if (avgDiff >= 0) {
            favoredTeam = team1;
            underdogTeam = team2;
        } else {
            favoredTeam = team2;
            underdogTeam = team1;
        }

        return new MatchupResult(
            team1,
            team2,
            avgDiff,
            team1WinProb,
            team2WinProb,
            favoredTeam,
            underdogTeam
        );
    }
    private double getSymmetricPredictedMargin(String team1, String team2, Instances rawData, LinearRegression model) {
        Double forward = predict(team1, team2, rawData, model);
        Double reverse = predict(team2, team1, rawData, model);

        if (forward == null || reverse == null) {
            throw new IllegalArgumentException("Could not generate prediction for " + team1 + " vs " + team2);
        }

        return (forward - reverse) / 2.0;
    }

    private double winProbabilityFromMargin(double margin, double sigma) {
        if (sigma <= 0) {
            sigma = DEFAULT_PROBABILITY_SIGMA;
        }

        return normalCdf(margin / sigma);
    }

    private double normalCdf(double x) {
        return 0.5 * (1.0 + erf(x / Math.sqrt(2.0)));
    }

    // Abramowitz-Stegun style approximation
    private double erf(double x) {
        double sign = (x >= 0) ? 1.0 : -1.0;
        x = Math.abs(x);

        double a1 = 0.254829592;
        double a2 = -0.284496736;
        double a3 = 1.421413741;
        double a4 = -1.453152027;
        double a5 = 1.061405429;
        double p = 0.3275911;

        double t = 1.0 / (1.0 + p * x);
        double y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }

    private String probabilityToMoneyline(double probability) {
        if (probability <= 0.0) {
            return "INF";
        }
        if (probability >= 1.0) {
            return "-INF";
        }

        double americanOdds;
        if (probability >= 0.5) {
            americanOdds = -100.0 * probability / (1.0 - probability);
        } else {
            americanOdds = 100.0 * (1.0 - probability) / probability;
        }

        long rounded = Math.round(americanOdds);

        if (rounded > 0) {
            return "+" + rounded;
        }
        return String.valueOf(rounded);
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

    private List<String> readBracketTeamsInteractive(Scanner scanner, Instances rawData) {
        List<String> teams = new ArrayList<>();

        System.out.println("\nEnter bracket teams one at a time in exact bracket order.");
        System.out.println("Valid bracket sizes: 4, 8, 16, 32, or 64 teams.");
        System.out.println("Type 'done' on a blank line when finished.");
        System.out.println("Type 'exit' to cancel.\n");

        while (true) {
            System.out.print("Enter team #" + (teams.size() + 1) + ": ");
            String input = scanner.nextLine().trim();

            if (input.equalsIgnoreCase("exit")) {
                return new ArrayList<>();
            }

            if (input.isEmpty() || input.equalsIgnoreCase("done")) {
                break;
            }

            String resolved = resolveTeamName(input, rawData);

            if (resolved != null) {
                teams.add(resolved);
                System.out.println("Accepted: " + resolved);
                continue;
            }

            System.out.println("Team not found: " + input);

            List<String> suggestions = findClosestTeamMatches(input, rawData, 5);
            if (!suggestions.isEmpty()) {
                System.out.println("Suggestions:");
                for (int i = 0; i < suggestions.size(); i++) {
                    System.out.println((i + 1) + " - " + suggestions.get(i));
                }

                System.out.print("Enter a suggestion number, or press Enter to retype: ");
                String choice = scanner.nextLine().trim();

                if (!choice.isEmpty()) {
                    try {
                        int idx = Integer.parseInt(choice);
                        if (idx >= 1 && idx <= suggestions.size()) {
                            String selected = suggestions.get(idx - 1);
                            teams.add(selected);
                            System.out.println("Accepted: " + selected);
                        } else {
                            System.out.println("Invalid selection. Please re-enter the team.");
                        }
                    } catch (NumberFormatException e) {
                        System.out.println("Invalid selection. Please re-enter the team.");
                    }
                }
            }
        }

        return teams;
    }

    private List<String> readBracketTeamsPasteMode(Scanner scanner, Instances rawData) {
        List<String> teams = new ArrayList<>();

        System.out.println("\nPaste your full bracket team list.");
        System.out.println("You can paste one team per line or comma-separated names.");
        System.out.println("Press Enter on a blank line when finished.\n");

        StringBuilder pasted = new StringBuilder();

        while (true) {
            String line = scanner.nextLine();
            if (line.trim().isEmpty()) {
                break;
            }
            pasted.append(line).append("\n");
        }

        String raw = pasted.toString().trim();
        if (raw.isEmpty()) {
            return teams;
        }

        String[] tokens;
        if (raw.contains(",")) {
            tokens = raw.split(",");
        } else {
            tokens = raw.split("\\R");
        }

        List<String> invalidTeams = new ArrayList<>();

        for (String token : tokens) {
            String input = token.trim();
            if (input.isEmpty()) {
                continue;
            }

            String resolved = resolveTeamName(input, rawData);
            if (resolved != null) {
                teams.add(resolved);
            } else {
                invalidTeams.add(input);
            }
        }

        if (!invalidTeams.isEmpty()) {
            System.out.println("\nSome team names were not recognized:");
            for (String badTeam : invalidTeams) {
                System.out.println("- " + badTeam);
                List<String> suggestions = findClosestTeamMatches(badTeam, rawData, 5);
                if (!suggestions.isEmpty()) {
                    System.out.println("  Suggestions: " + String.join(", ", suggestions));
                }
            }

            System.out.println("\nPaste mode aborted. Please retry with corrected names or use interactive mode.");
            return new ArrayList<>();
        }

        System.out.println("\nAccepted teams:");
        for (int i = 0; i < teams.size(); i++) {
            System.out.println((i + 1) + ". " + teams.get(i));
        }

        return teams;
    }

    private List<String> readBracketTeams(Scanner scanner, Instances rawData) {
        System.out.println("\nChoose bracket entry mode:");
        System.out.println("1 - Enter teams one at a time with live validation");
        System.out.println("2 - Paste full bracket list");
        System.out.print("Enter choice: ");

        String choice = scanner.nextLine().trim();

        List<String> teams;
        if (choice.equals("2")) {
            teams = readBracketTeamsPasteMode(scanner, rawData);
        } else {
            teams = readBracketTeamsInteractive(scanner, rawData);
        }

        if (!isValidBracketSize(teams.size())) {
            if (!teams.isEmpty()) {
                System.out.println("\nInvalid team count: " + teams.size());
                System.out.println("Bracket requires exactly 4, 8, 16, 32, or 64 teams.");
            }
            return new ArrayList<>();
        }

        return teams;
    }

    private boolean isValidBracketSize(int size) {
        return size == 4 || size == 8 || size == 16 || size == 32 || size == 64;
    }

    private void printMatchupDetails(MatchupResult result) {
        System.out.println("----------------------------------------");
        System.out.println("Matchup: " + result.team1 + " vs " + result.team2);

        if (result.averageMargin == null) {
            System.out.println("Could not determine winner because one or both teams were missing.");
            return;
        }

        if (result.averageMargin > 0) {
            System.out.printf("Projected winner: %s by %.2f points%n",
                result.team1, Math.abs(result.averageMargin));
        } else if (result.averageMargin < 0) {
            System.out.printf("Projected winner: %s by %.2f points%n",
                result.team2, Math.abs(result.averageMargin));
        } else {
            System.out.printf("Projected result: exact toss-up. Advancing %s by tiebreaker.%n", result.team1);
        }

        System.out.printf("Win probability: %s %.2f%%, %s %.2f%%%n",
            result.team1, result.team1WinProbability * 100.0,
            result.team2, result.team2WinProbability * 100.0);

        String team1Moneyline = probabilityToMoneyline(result.team1WinProbability);
        String team2Moneyline = probabilityToMoneyline(result.team2WinProbability);

        System.out.printf("Vig-free moneyline: %s %s, %s %s%n",
            result.team1, team1Moneyline,
            result.team2, team2Moneyline);
    }

    public void simulateBracket(Scanner scanner, Instances rawData, LinearRegression model) {
        List<String> originalBracketTeams = readBracketTeams(scanner, rawData);

        if (originalBracketTeams.isEmpty()) {
            System.out.println("Bracket input cancelled or invalid.");
            return;
        }

        StringBuilder output = new StringBuilder();

        List<String> currentRoundTeams = new ArrayList<>(originalBracketTeams);

        int roundNumber = 1;

        while (currentRoundTeams.size() > 1) {
            String roundHeader =
                "\n========================================\n" +
                "ROUND " + roundNumber + " (" + currentRoundTeams.size() + " teams)\n" +
                "========================================";
            System.out.println(roundHeader);
            output.append(roundHeader).append("\n");

            List<String> nextRoundTeams = new ArrayList<>();

            for (int i = 0; i < currentRoundTeams.size(); i += 2) {
                String team1 = currentRoundTeams.get(i);
                String team2 = currentRoundTeams.get(i + 1);

                MatchupResult result = evaluateMatchup(team1, team2, rawData, model);
                appendMatchupDetails(output, result);

                if (result.favoredTeam == null) {
                    String message = "Bracket simulation stopped because this matchup could not be resolved.";
                    System.out.println(message);
                    output.append(message).append("\n");
                    promptToSaveOutput(scanner, output);
                    return;
                }

                nextRoundTeams.add(result.favoredTeam);
                String advancingLine = "Advancing: " + result.favoredTeam;
                System.out.println(advancingLine);
                output.append(advancingLine).append("\n");
            }

            System.out.println("\nTeams advancing to next round:");
            output.append("\nTeams advancing to next round:\n");
            for (String team : nextRoundTeams) {
                System.out.println("- " + team);
                output.append("- ").append(team).append("\n");
            }

            currentRoundTeams = nextRoundTeams;
            roundNumber++;
        }

        String championBlock =
            "\n========================================\n" +
            "BRACKET CHAMPION: " + currentRoundTeams.get(0) + "\n" +
            "========================================";
        System.out.println(championBlock);
        output.append(championBlock).append("\n");

        printBracketTeamProbabilities(originalBracketTeams, rawData, model, output);
        System.out.println();

        promptToSaveOutput(scanner, output);
    }
    
    private void appendMatchupDetails(StringBuilder output, MatchupResult result) {
        output.append("----------------------------------------\n");
        output.append("Matchup: ").append(result.team1).append(" vs ").append(result.team2).append("\n");

        if (result.averageMargin == null) {
            output.append("Could not determine winner because one or both teams were missing.\n");
            return;
        }

        if (result.averageMargin > 0) {
            output.append(String.format("Projected winner: %s by %.2f points%n",
                result.team1, Math.abs(result.averageMargin)));
        } else if (result.averageMargin < 0) {
            output.append(String.format("Projected winner: %s by %.2f points%n",
                result.team2, Math.abs(result.averageMargin)));
        } else {
            output.append(String.format("Projected result: exact toss-up. Advancing %s by tiebreaker.%n", result.team1));
        }

        output.append(String.format("Win probability: %s %.2f%%, %s %.2f%%%n",
            result.team1, result.team1WinProbability * 100.0,
            result.team2, result.team2WinProbability * 100.0));

        String team1Moneyline = probabilityToMoneyline(result.team1WinProbability);
        String team2Moneyline = probabilityToMoneyline(result.team2WinProbability);

        output.append(String.format("Vig-free moneyline: %s %s, %s %s%n",
            result.team1, team1Moneyline,
            result.team2, team2Moneyline));
    }
    
    private void promptToSaveOutput(Scanner scanner, StringBuilder output) {
        System.out.print("\nSave bracket output to txt file? (y/n): ");
        String saveChoice = scanner.nextLine().trim();

        if (saveChoice.equalsIgnoreCase("y") || saveChoice.equalsIgnoreCase("yes")) {
            System.out.print("Enter output file name (example: bracket-output.txt): ");
            String fileName = scanner.nextLine().trim();

            if (fileName.isEmpty()) {
                fileName = "bracket-output.txt";
            }

            saveOutputToFile(fileName, output.toString());
        }
    }
    
    private void saveOutputToFile(String fileName, String content) {
        try (FileWriter writer = new FileWriter(fileName)) {
            writer.write(content);
            System.out.println("Output saved to: " + fileName);
        } catch (Exception e) {
            System.out.println("Failed to save output to file: " + fileName);
            e.printStackTrace();
        }
    }
    
//    private void printBracketTeamProbabilities(List<String> teams, Instances rawData, LinearRegression model) {
//        printBracketTeamProbabilities(teams, rawData, model, null);
//    }

    private void printBracketTeamProbabilities(List<String> teams,
                                               Instances rawData,
                                               LinearRegression model,
                                               StringBuilder output) {
        int n = teams.size();
        int rounds = (int) (Math.log(n) / Math.log(2));

        double sigma = lastHeldOutRmse > 0 ? lastHeldOutRmse : DEFAULT_PROBABILITY_SIGMA;

        double[][] winProb = new double[n][n];

        try {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (i == j) {
                        winProb[i][j] = 0.0;
                    } else {
                        double margin = getSymmetricPredictedMargin(teams.get(i), teams.get(j), rawData, model);
                        winProb[i][j] = winProbabilityFromMargin(margin, sigma);
                    }
                }
            }
        } catch (IllegalArgumentException e) {
            String message = "Could not calculate bracket probabilities: " + e.getMessage();
            System.out.println(message);
            if (output != null) {
                output.append(message).append("\n");
            }
            return;
        }

        double[][] dp = new double[rounds + 1][n];

        for (int i = 0; i < n; i++) {
            dp[0][i] = 1.0;
        }

        for (int r = 1; r <= rounds; r++) {
            int blockSize = 1 << r;
            int halfBlock = blockSize / 2;

            for (int blockStart = 0; blockStart < n; blockStart += blockSize) {
                int mid = blockStart + halfBlock;
                int blockEnd = blockStart + blockSize;

                for (int i = blockStart; i < mid; i++) {
                    double advanceProb = 0.0;

                    for (int j = mid; j < blockEnd; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }

                for (int i = mid; i < blockEnd; i++) {
                    double advanceProb = 0.0;

                    for (int j = blockStart; j < mid; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }
            }
        }

        List<Integer> sortedIndices = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            sortedIndices.add(i);
        }
        sortedIndices.sort(Comparator.comparing(i -> teams.get(i)));

        String header =
            "\n========================================\n" +
            "BRACKET TEAM PROBABILITIES\n" +
            "========================================";
        System.out.println(header);
        if (output != null) {
            output.append(header).append("\n");
        }

        for (int idx : sortedIndices) {
            String titleLine = String.format("%-25s  Title: %6.2f%%", teams.get(idx), dp[rounds][idx] * 100.0);
            System.out.println(titleLine);
            if (output != null) {
                output.append(titleLine).append("\n");
            }

            for (int r = 1; r <= rounds; r++) {
                String roundLine;
                if (r < rounds) {
                    roundLine = String.format("   Reach round %d: %6.2f%%", r + 1, dp[r][idx] * 100.0);
                } else {
                    roundLine = String.format("   Win bracket : %6.2f%%", dp[r][idx] * 100.0);
                }

                System.out.println(roundLine);
                if (output != null) {
                    output.append(roundLine).append("\n");
                }
            }
        }

        String footer = "========================================\n";
        System.out.println(footer);
        if (output != null) {
            output.append(footer);
        }
    }
    
    private void printBracketTeamProbabilities(List<String> teams, Instances rawData, LinearRegression model) {
        int n = teams.size();
        int rounds = (int) (Math.log(n) / Math.log(2));

        double sigma = lastHeldOutRmse > 0 ? lastHeldOutRmse : DEFAULT_PROBABILITY_SIGMA;

        double[][] winProb = new double[n][n];

        try {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (i == j) {
                        winProb[i][j] = 0.0;
                    } else {
                        double margin = getSymmetricPredictedMargin(teams.get(i), teams.get(j), rawData, model);
                        winProb[i][j] = winProbabilityFromMargin(margin, sigma);
                    }
                }
            }
        } catch (IllegalArgumentException e) {
            System.out.println("Could not calculate bracket probabilities: " + e.getMessage());
            return;
        }

        double[][] dp = new double[rounds + 1][n];

        for (int i = 0; i < n; i++) {
            dp[0][i] = 1.0;
        }

        for (int r = 1; r <= rounds; r++) {
            int blockSize = 1 << r;
            int halfBlock = blockSize / 2;

            for (int blockStart = 0; blockStart < n; blockStart += blockSize) {
                int mid = blockStart + halfBlock;
                int blockEnd = blockStart + blockSize;

                for (int i = blockStart; i < mid; i++) {
                    double advanceProb = 0.0;

                    for (int j = mid; j < blockEnd; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }

                for (int i = mid; i < blockEnd; i++) {
                    double advanceProb = 0.0;

                    for (int j = blockStart; j < mid; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }
            }
        }

        List<Integer> sortedIndices = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            sortedIndices.add(i);
        }
        sortedIndices.sort(Comparator.comparing(i -> teams.get(i)));

        System.out.println("\n========================================");
        System.out.println("BRACKET TEAM PROBABILITIES");
        System.out.println("========================================");

        for (int idx : sortedIndices) {
            System.out.printf("%-25s  Title: %6.2f%%%n", teams.get(idx), dp[rounds][idx] * 100.0);
            for (int r = 1; r <= rounds; r++) {
                if (r < rounds) {
                    System.out.printf("   Reach round %d: %6.2f%%%n", r + 1, dp[r][idx] * 100.0);
                } else {
                    System.out.printf("   Win bracket : %6.2f%%%n", dp[r][idx] * 100.0);
                }
            }
        }

        System.out.println("========================================\n");
    }

    public void calculateBracketChampionshipProbabilities(Scanner scanner, Instances rawData, LinearRegression model) {
        List<String> teams = readBracketTeams(scanner, rawData);

        if (teams.isEmpty()) {
            System.out.println("Bracket input cancelled or invalid.");
            return;
        }

        int n = teams.size();
        int rounds = (int) (Math.log(n) / Math.log(2));

        double sigma = lastHeldOutRmse > 0 ? lastHeldOutRmse : DEFAULT_PROBABILITY_SIGMA;
        if (lastHeldOutRmse <= 0) {
            System.out.printf("Warning: held-out RMSE not available, using fallback sigma %.3f%n",
                DEFAULT_PROBABILITY_SIGMA);
        } else {
            System.out.printf("Using sigma %.3f for probability conversion%n", sigma);
        }

        double[][] winProb = new double[n][n];

        try {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (i == j) {
                        winProb[i][j] = 0.0;
                    } else {
                        double margin = getSymmetricPredictedMargin(teams.get(i), teams.get(j), rawData, model);
                        winProb[i][j] = winProbabilityFromMargin(margin, sigma);
                    }
                }
            }
        } catch (IllegalArgumentException e) {
            System.out.println("Could not calculate bracket probabilities: " + e.getMessage());
            return;
        }

        double[][] dp = new double[rounds + 1][n];

        for (int i = 0; i < n; i++) {
            dp[0][i] = 1.0;
        }

        for (int r = 1; r <= rounds; r++) {
            int blockSize = 1 << r;
            int halfBlock = blockSize / 2;

            for (int blockStart = 0; blockStart < n; blockStart += blockSize) {
                int mid = blockStart + halfBlock;
                int blockEnd = blockStart + blockSize;

                for (int i = blockStart; i < mid; i++) {
                    double advanceProb = 0.0;

                    for (int j = mid; j < blockEnd; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }

                for (int i = mid; i < blockEnd; i++) {
                    double advanceProb = 0.0;

                    for (int j = blockStart; j < mid; j++) {
                        advanceProb += dp[r - 1][i] * dp[r - 1][j] * winProb[i][j];
                    }

                    dp[r][i] = advanceProb;
                }
            }
        }

        System.out.println("\n========================================");
        System.out.println("BRACKET CHAMPIONSHIP PROBABILITIES");
        System.out.println("========================================");

        List<Integer> sortedIndices = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            sortedIndices.add(i);
        }

        sortedIndices.sort(Comparator.comparing(i -> teams.get(i)));

        for (int idx : sortedIndices) {
            System.out.printf("%-25s  %.2f%%%n", teams.get(idx), dp[rounds][idx] * 100.0);
        }

        System.out.println("\n========================================");
        System.out.println("ROUND-BY-ROUND ADVANCEMENT PROBABILITIES");
        System.out.println("========================================");

        for (int idx : sortedIndices) {
            System.out.println("\n" + teams.get(idx));
            for (int r = 1; r <= rounds; r++) {
                if (r == rounds) {
                    System.out.printf("  Win bracket: %.2f%%%n", dp[r][idx] * 100.0);
                } else {
                    System.out.printf("  Reach round %d: %.2f%%%n", r + 1, dp[r][idx] * 100.0);
                }
            }
        }

        System.out.println("\n========================================");
        System.out.println("PAIRWISE FIRST-ROUND MATCHUPS");
        System.out.println("========================================");

        for (int i = 0; i < n; i += 2) {
            String team1 = teams.get(i);
            String team2 = teams.get(i + 1);

            double margin = getSymmetricPredictedMargin(team1, team2, rawData, model);
            double p1 = winProb[i][i + 1];
            double p2 = winProb[i + 1][i];

            System.out.printf("%s vs %s -> margin: %.2f, %s win: %.2f%%, %s win: %.2f%%%n",
                team1, team2, margin, team1, p1 * 100.0, team2, p2 * 100.0);
        }
    }

    private static void printResult(ModelScoreDiffPitino model,
                                    String team1,
                                    String team2,
                                    Double forward,
                                    Double reverse) {
        if (forward != null && reverse != null) {
            double avgDiff = (forward - reverse) / 2.0;
            double sigma = model.getProbabilitySigma();
            double team1WinProb = model.winProbabilityFromMargin(avgDiff, sigma);
            double team2WinProb = 1.0 - team1WinProb;

            String team1Moneyline = model.probabilityToMoneyline(team1WinProb);
            String team2Moneyline = model.probabilityToMoneyline(team2WinProb);

            System.out.println("========================================");
            System.out.println("MATCHUP RESULT");
            System.out.println("========================================");
            System.out.println(team1 + " vs " + team2);

            if (avgDiff > 0) {
                System.out.printf("Projected winner: %s by %.2f points%n",
                    team1, Math.abs(avgDiff));
            } else if (avgDiff < 0) {
                System.out.printf("Projected winner: %s by %.2f points%n",
                    team2, Math.abs(avgDiff));
            } else {
                System.out.println("Projected result: toss-up");
            }

            System.out.printf("Win probability: %s %.2f%% | %s %.2f%%%n",
                team1, team1WinProb * 100.0,
                team2, team2WinProb * 100.0);

            System.out.printf("Vig-free moneyline: %s %s | %s %s%n",
                team1, team1Moneyline,
                team2, team2Moneyline);
        } else {
            if (forward == null) {
                System.out.println("Could not make prediction for " + team1 + " vs " + team2);
            }
            if (reverse == null) {
                System.out.println("Could not make prediction for " + team2 + " vs " + team1);
            }
        }
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
            ModelScoreDiffPitino model = new ModelScoreDiffPitino();

            Instances trainingData = model.loadData("normalized-differential-model-training-2026.csv");
            Instances testingData = model.loadData("normalized-differential-model-testing-2026.csv");

            model.printTargetDistribution("Training Set", trainingData);
            model.printTargetDistribution("Testing Set", testingData);

            LinearRegression lr = model.trainModel(trainingData);

            model.displayModelStats(trainingData);
            model.displayHeldOutTestStats(lr, testingData);

            System.out.println("\nModel ready.");

            while (true) {
                System.out.println("1 - Predict a single matchup");
                System.out.println("2 - Simulate a bracket winner");
                System.out.println("3 - Calculate exact bracket championship probabilities");
                System.out.println("4 - Exit");
                System.out.print("Enter choice: ");

                String choice = scanner.nextLine().trim();

                if (choice.equals("4") || choice.equalsIgnoreCase("exit")) {
                    break;
                }

                if (choice.equals("1")) {
                    System.out.println("\nEnter team names exactly as they appear in your dataset.");
                    System.out.println("Type 'exit' at any prompt to return to menu.\n");

                    System.out.print("Enter the name of the first team: ");
                    String team1 = scanner.nextLine();
                    if (team1.equalsIgnoreCase("exit")) {
                        continue;
                    }

                    System.out.print("Enter the name of the second team: ");
                    String team2 = scanner.nextLine();
                    if (team2.equalsIgnoreCase("exit")) {
                        continue;
                    }

                    Double diffPrediction1 = model.predict(team1, team2, trainingData, lr);
                    Double diffPrediction2 = model.predict(team2, team1, trainingData, lr);

                    printResult(model, team1, team2, diffPrediction1, diffPrediction2);

                } else if (choice.equals("2")) {
                    model.simulateBracket(scanner, trainingData, lr);

                } else if (choice.equals("3")) {
                    model.calculateBracketChampionshipProbabilities(scanner, trainingData, lr);

                } else {
                    System.out.println("Invalid option. Please enter 1, 2, 3, or 4.");
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            scanner.close();
        }
    }
}