/**
 * integrations/java-example.java
 *
 * Demonstrates driving the ai-powered CLI from Java.
 * Covers: text, image (--output), --dry-run, --quiet, --session,
 *         structured (--schema), --mock, --log, --debug.
 *
 * Compile and run (Java 11+):
 *   AI_MOCK=true java integrations/java-example.java
 *
 * Or compile first:
 *   javac -d /tmp integrations/java-example.java
 *   AI_MOCK=true java -cp /tmp AiPoweredExample
 */

import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

public class AiPoweredExample {

    private static final String CLI = System.getenv().getOrDefault("CLI", "ai-powered");
    private static final boolean MOCK = isMock();
    private static final List<String> MOCK_FLAG = MOCK ? List.of("--mock") : List.of();

    public static void main(String[] args) throws Exception {
        Path tmp = Files.createTempDirectory("ai-powered-java-");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> deleteDir(tmp.toFile())));

        sep("1. Text generation");
        run(args("text", "Explain what a REST API is in one sentence."));

        sep("2. Text generation (--quiet)");
        String raw = capture(args("text", "--quiet", "What is 2 + 2?")).strip();
        System.out.println("Raw result: " + raw);

        sep("3. Text generation (--json)");
        String json = capture(args("text", "--json", "Summarise TCP/IP in one sentence."));
        System.out.println(json);

        sep("4. Dry-run cost estimate");
        String dry = capture(args("text", "--dry-run", "Write a 500-word essay on quantum computing."));
        System.out.println(dry);

        sep("5. Image generation (--output)");
        Path imgOut = tmp.resolve("image.png");
        run(args("image", "--output", imgOut.toString(), "A serene mountain lake at sunrise"));
        if (Files.exists(imgOut)) {
            System.out.printf("Image saved: %s (%d bytes)%n", imgOut, Files.size(imgOut));
        } else {
            System.err.println("ERROR: image file not created.");
            System.exit(1);
        }

        sep("6. Multi-turn session");
        String sessionId = "java-session-" + Instant.now().getEpochSecond();
        run(args("text", "--session", sessionId, "My name is Alice."));
        run(args("text", "--session", sessionId, "What is my name?"));
        run("session", "list");
        run("session", "clear", sessionId);

        sep("7. Structured output (--schema)");
        Path schemaFile = tmp.resolve("schema.json");
        Files.writeString(schemaFile, """
                {
                  "type": "object",
                  "properties": {
                    "name":       { "type": "string"  },
                    "capital":    { "type": "string"  },
                    "population": { "type": "number"  },
                    "in_europe":  { "type": "boolean" }
                  },
                  "required": ["name","capital","population","in_europe"]
                }
                """);
        run(args("structured", "--schema", schemaFile.toString(), "Describe France as a JSON object."));

        sep("8. Batch text processing");
        Path batchIn  = tmp.resolve("batch_input.jsonl");
        Path batchOut = tmp.resolve("batch_output.jsonl");
        Files.writeString(batchIn,
                "{\"prompt\":\"What is the speed of light?\"}\n" +
                "{\"prompt\":\"Who wrote Hamlet?\"}\n" +
                "{\"prompt\":\"What is pi?\"}\n");
        run(args("batch", "text", "--input", batchIn.toString(), "--output", batchOut.toString()));
        System.out.println("--- Batch output ---");
        System.out.println(Files.readString(batchOut));

        sep("9. Debug logging (--debug)");
        run(args("text", "--debug", "Hello world."));

        System.out.println("\n✓ java-example.java complete.");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static boolean isMock() {
        String v = System.getenv("AI_MOCK");
        return v != null && (v.equalsIgnoreCase("true") || v.equals("1") || v.equalsIgnoreCase("yes"));
    }

    /** Prepend MOCK_FLAG then append vararg extras. */
    private static String[] args(String... extras) {
        List<String> list = new ArrayList<>(MOCK_FLAG);
        list.addAll(Arrays.asList(extras));
        return list.toArray(new String[0]);
    }

    private static void sep(String title) {
        System.out.println("\n" + "─".repeat(60));
        System.out.println("  " + title);
        System.out.println("─".repeat(60));
    }

    private static void run(String... args) throws IOException, InterruptedException {
        List<String> cmd = new ArrayList<>();
        cmd.add(CLI);
        cmd.addAll(Arrays.asList(args));
        new ProcessBuilder(cmd)
                .inheritIO()
                .start()
                .waitFor();
    }

    private static String capture(String... args) throws Exception {
        List<String> cmd = new ArrayList<>();
        cmd.add(CLI);
        cmd.addAll(Arrays.asList(args));
        Process p = new ProcessBuilder(cmd).redirectErrorStream(false).start();
        String out = new String(p.getInputStream().readAllBytes());
        p.waitFor();
        return out;
    }

    private static void deleteDir(File dir) {
        if (dir.isDirectory()) {
            for (File child : Objects.requireNonNull(dir.listFiles())) deleteDir(child);
        }
        dir.delete();
    }
}

