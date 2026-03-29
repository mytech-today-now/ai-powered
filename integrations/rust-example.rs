// integrations/rust-example.rs
//
// Demonstrates driving the ai-powered CLI from Rust.
// Covers: text, image (--output), --dry-run, --quiet, --session,
//         structured (--schema), --mock, --log, --debug.
//
// Compile and run:
//   rustc integrations/rust-example.rs -o /tmp/rust-example
//   AI_MOCK=true /tmp/rust-example
//
// Or with cargo-script (https://crates.io/crates/cargo-script):
//   AI_MOCK=true cargo script integrations/rust-example.rs

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn cli() -> String {
    env::var("CLI").unwrap_or_else(|_| "ai-powered".into())
}

fn is_mock() -> bool {
    let v = env::var("AI_MOCK").unwrap_or_default().to_lowercase();
    matches!(v.as_str(), "true" | "1" | "yes")
}

fn mock_flag() -> Vec<String> {
    if is_mock() { vec!["--mock".into()] } else { vec![] }
}

fn sep(title: &str) {
    println!("\n{}\n  {}\n{}", "─".repeat(60), title, "─".repeat(60));
}

fn run(args: &[&str]) {
    let status = Command::new(cli())
        .args(args)
        .status()
        .expect("failed to spawn CLI");
    if !status.success() {
        eprintln!("[WARN] CLI exited with {:?}", status.code());
    }
}

fn capture(args: &[&str]) -> String {
    let output = Command::new(cli())
        .args(args)
        .stdout(Stdio::piped())
        .output()
        .expect("failed to spawn CLI");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn with_mock<'a>(extra: &[&'a str]) -> Vec<String> {
    let mut v: Vec<String> = mock_flag();
    v.extend(extra.iter().map(|s| s.to_string()));
    v
}

fn run_s(args: Vec<String>) {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&refs);
}

fn capture_s(args: Vec<String>) -> String {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    capture(&refs)
}

fn main() {
    let tmp = env::temp_dir().join(format!("ai-powered-rs-{}", std::process::id()));
    fs::create_dir_all(&tmp).expect("cannot create tmpdir");

    // 1. Text generation
    sep("1. Text generation");
    run_s(with_mock(&["text", "Explain what a REST API is in one sentence."]));

    // 2. Quiet mode
    sep("2. Text generation (--quiet)");
    let raw = capture_s(with_mock(&["text", "--quiet", "What is 2 + 2?"]));
    println!("Raw result: {}", raw.trim());

    // 3. JSON envelope
    sep("3. Text generation (--json)");
    let json = capture_s(with_mock(&["text", "--json", "Summarise TCP/IP in one sentence."]));
    println!("{}", json);

    // 4. Dry-run
    sep("4. Dry-run cost estimate");
    let dry = capture_s(with_mock(&["text", "--dry-run", "Write a 500-word essay on quantum computing."]));
    println!("{}", dry);

    // 5. Image generation
    sep("5. Image generation (--output)");
    let img_out = tmp.join("image.png");
    run_s(with_mock(&["image", "--output", img_out.to_str().unwrap(),
        "A serene mountain lake at sunrise"]));
    match fs::metadata(&img_out) {
        Ok(m) => println!("Image saved: {} ({} bytes)", img_out.display(), m.len()),
        Err(_) => { eprintln!("ERROR: image file not created."); std::process::exit(1); }
    }

    // 6. Multi-turn session
    sep("6. Multi-turn session");
    let session_id = format!("rust-session-{}", std::time::UNIX_EPOCH
        .elapsed().map(|d| d.as_secs()).unwrap_or(0));
    run_s(with_mock(&["text", "--session", &session_id, "My name is Alice."]));
    run_s(with_mock(&["text", "--session", &session_id, "What is my name?"]));
    run(&["session", "list"]);
    run(&["session", "clear", &session_id]);

    // 7. Structured output (JSON Schema)
    sep("7. Structured output (--schema)");
    let schema_file = tmp.join("schema.json");
    fs::write(&schema_file, r#"{
  "type": "object",
  "properties": {
    "name":       { "type": "string"  },
    "capital":    { "type": "string"  },
    "population": { "type": "number"  },
    "in_europe":  { "type": "boolean" }
  },
  "required": ["name","capital","population","in_europe"]
}"#).expect("cannot write schema");
    run_s(with_mock(&["structured", "--schema", schema_file.to_str().unwrap(),
        "Describe France as a JSON object."]));

    // 8. Batch processing
    sep("8. Batch text processing");
    let batch_in  = tmp.join("batch_input.jsonl");
    let batch_out = tmp.join("batch_output.jsonl");
    fs::write(&batch_in,
        "{\"prompt\":\"What is the speed of light?\"}\n\
         {\"prompt\":\"Who wrote Hamlet?\"}\n\
         {\"prompt\":\"What is pi?\"}\n"
    ).expect("cannot write batch input");
    run_s(with_mock(&["batch", "text",
        "--input",  batch_in.to_str().unwrap(),
        "--output", batch_out.to_str().unwrap()]));
    println!("--- Batch output ---");
    println!("{}", fs::read_to_string(&batch_out).unwrap_or_default());

    // 9. Debug logging
    sep("9. Debug logging (--debug)");
    run_s(with_mock(&["text", "--debug", "Hello world."]));

    // Cleanup
    let _ = fs::remove_dir_all(&tmp);
    println!("\n✓ rust-example.rs complete.");
}

