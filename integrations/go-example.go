//go:build ignore
// +build ignore

/*
integrations/go-example.go

Demonstrates driving the ai-powered CLI from Go.
Covers: text, image (--output), --dry-run, --quiet, --session,
        structured (--schema), --mock, --log, --debug.

Usage:
  AI_MOCK=true go run integrations/go-example.go
*/

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var cli = envOr("CLI", "ai-powered")
var mockFlag = func() []string {
	if isMock() {
		return []string{"--mock"}
	}
	return nil
}()

func isMock() bool {
	v := strings.ToLower(os.Getenv("AI_MOCK"))
	return v == "true" || v == "1" || v == "yes"
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func sep(title string) {
	fmt.Printf("\n%s\n  %s\n%s\n", strings.Repeat("─", 60), title, strings.Repeat("─", 60))
}

func run(args ...string) {
	cmd := exec.Command(cli, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "[WARN] CLI error: %v\n", err)
	}
}

func capture(args ...string) string {
	cmd := exec.Command(cli, args...)
	out, _ := cmd.Output()
	return string(out)
}

func main() {
	tmp, err := os.MkdirTemp("", "ai-powered-go-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tmp)

	args := func(extra ...string) []string { return append(mockFlag, extra...) }

	// 1. Text generation
	sep("1. Text generation")
	run(append([]string{"text"}, args("Explain what a REST API is in one sentence.")...)...)

	// 2. Quiet mode
	sep("2. Text generation (--quiet)")
	raw := strings.TrimSpace(capture(append([]string{"text"}, args("--quiet", "What is 2 + 2?")...)...))
	fmt.Printf("Raw result: %s\n", raw)

	// 3. JSON envelope
	sep("3. Text generation (--json)")
	jsonStr := capture(append([]string{"text"}, args("--json", "Summarise TCP/IP in one sentence.")...)...)
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &obj); err == nil {
		pretty, _ := json.MarshalIndent(obj, "", "  ")
		fmt.Println(string(pretty))
	} else {
		fmt.Print(jsonStr)
	}

	// 4. Dry-run
	sep("4. Dry-run cost estimate")
	dry := capture(append([]string{"text"}, args("--dry-run", "Write a 500-word essay on quantum computing.")...)...)
	if err := json.Unmarshal([]byte(dry), &obj); err == nil {
		pretty, _ := json.MarshalIndent(obj, "", "  ")
		fmt.Println(string(pretty))
	} else {
		fmt.Print(dry)
	}

	// 5. Image generation
	sep("5. Image generation (--output)")
	imgOut := filepath.Join(tmp, "image.png")
	run(append([]string{"image"}, args("--output", imgOut, "A serene mountain lake at sunrise")...)...)
	if info, err := os.Stat(imgOut); err == nil {
		fmt.Printf("Image saved: %s (%d bytes)\n", imgOut, info.Size())
	} else {
		fmt.Fprintln(os.Stderr, "ERROR: image file not created.")
		os.Exit(1)
	}

	// 6. Multi-turn session
	sep("6. Multi-turn session")
	sessionID := fmt.Sprintf("go-session-%d", time.Now().Unix())
	run(append([]string{"text"}, args("--session", sessionID, "My name is Alice.")...)...)
	run(append([]string{"text"}, args("--session", sessionID, "What is my name?")...)...)
	run("session", "list")
	run("session", "clear", sessionID)

	// 7. Structured output (JSON Schema)
	sep("7. Structured output (--schema)")
	schemaFile := filepath.Join(tmp, "schema.json")
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name":       map[string]string{"type": "string"},
			"capital":    map[string]string{"type": "string"},
			"population": map[string]string{"type": "number"},
			"in_europe":  map[string]string{"type": "boolean"},
		},
		"required": []string{"name", "capital", "population", "in_europe"},
	}
	schemaBytes, _ := json.MarshalIndent(schema, "", "  ")
	os.WriteFile(schemaFile, schemaBytes, 0600)
	run(append([]string{"structured"}, args("--schema", schemaFile, "Describe France as a JSON object.")...)...)

	// 8. Batch processing
	sep("8. Batch text processing")
	batchIn := filepath.Join(tmp, "batch_input.jsonl")
	batchOut := filepath.Join(tmp, "batch_output.jsonl")
	lines := []string{
		`{"prompt":"What is the speed of light?"}`,
		`{"prompt":"Who wrote Hamlet?"}`,
		`{"prompt":"What is pi?"}`,
	}
	os.WriteFile(batchIn, []byte(strings.Join(lines, "\n")+"\n"), 0600)
	run(append([]string{"batch", "text"}, args("--input", batchIn, "--output", batchOut)...)...)
	fmt.Println("--- Batch output ---")
	content, _ := os.ReadFile(batchOut)
	fmt.Print(string(content))

	// 9. Debug logging
	sep("9. Debug logging (--debug)")
	run(append([]string{"text"}, args("--debug", "Hello world.")...)...)

	fmt.Println("\n✓ go-example.go complete.")
}

