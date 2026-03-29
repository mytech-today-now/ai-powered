// integrations/csharp-example.cs
//
// Demonstrates driving the ai-powered CLI from C#.
// Covers: text, image (--output), --dry-run, --quiet, --session,
//         structured (--schema), --mock, --log, --debug.
//
// Compile and run (.NET 6+):
//   dotnet-script integrations/csharp-example.cs
// Or with csc/mcs:
//   csc integrations/csharp-example.cs && AI_MOCK=true mono csharp-example.exe
//
// Requires: .NET 6+ for top-level statements and string interpolation.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

var cli    = Environment.GetEnvironmentVariable("CLI") ?? "ai-powered";
var isMock = IsTrue(Environment.GetEnvironmentVariable("AI_MOCK") ?? "");
var mock   = isMock ? new[] { "--mock" } : Array.Empty<string>();
var tmp    = Path.Combine(Path.GetTempPath(), $"ai-powered-cs-{Random.Shared.Next()}");
Directory.CreateDirectory(tmp);

try
{
    // 1. Text generation
    Sep("1. Text generation");
    Run(A("text", "Explain what a REST API is in one sentence."));

    // 2. Quiet mode
    Sep("2. Text generation (--quiet)");
    var raw = Capture(A("text", "--quiet", "What is 2 + 2?")).Trim();
    Console.WriteLine($"Raw result: {raw}");

    // 3. JSON envelope
    Sep("3. Text generation (--json)");
    var jsonStr = Capture(A("text", "--json", "Summarise TCP/IP in one sentence."));
    try { Console.WriteLine(JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(jsonStr),
              new JsonSerializerOptions { WriteIndented = true })); }
    catch { Console.Write(jsonStr); }

    // 4. Dry-run
    Sep("4. Dry-run cost estimate");
    var dry = Capture(A("text", "--dry-run", "Write a 500-word essay on quantum computing."));
    try { Console.WriteLine(JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(dry),
              new JsonSerializerOptions { WriteIndented = true })); }
    catch { Console.Write(dry); }

    // 5. Image generation
    Sep("5. Image generation (--output)");
    var imgOut = Path.Combine(tmp, "image.png");
    Run(A("image", "--output", imgOut, "A serene mountain lake at sunrise"));
    if (File.Exists(imgOut))
        Console.WriteLine($"Image saved: {imgOut} ({new FileInfo(imgOut).Length} bytes)");
    else
    { Console.Error.WriteLine("ERROR: image file not created."); Environment.Exit(1); }

    // 6. Multi-turn session
    Sep("6. Multi-turn session");
    var sessionId = $"cs-session-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
    Run(A("text", "--session", sessionId, "My name is Alice."));
    Run(A("text", "--session", sessionId, "What is my name?"));
    Run("session", "list");
    Run("session", "clear", sessionId);

    // 7. Structured output (JSON Schema)
    Sep("7. Structured output (--schema)");
    var schemaFile = Path.Combine(tmp, "schema.json");
    File.WriteAllText(schemaFile, """
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
    Run(A("structured", "--schema", schemaFile, "Describe France as a JSON object."));

    // 8. Batch processing
    Sep("8. Batch text processing");
    var batchIn  = Path.Combine(tmp, "batch_input.jsonl");
    var batchOut = Path.Combine(tmp, "batch_output.jsonl");
    File.WriteAllLines(batchIn, new[]
    {
        "{\"prompt\":\"What is the speed of light?\"}",
        "{\"prompt\":\"Who wrote Hamlet?\"}",
        "{\"prompt\":\"What is pi?\"}",
    });
    Run(A("batch", "text", "--input", batchIn, "--output", batchOut));
    Console.WriteLine("--- Batch output ---");
    Console.Write(File.ReadAllText(batchOut));

    // 9. Debug logging
    Sep("9. Debug logging (--debug)");
    Run(A("text", "--debug", "Hello world."));

    Console.WriteLine("\n✓ csharp-example.cs complete.");
}
finally
{
    try { Directory.Delete(tmp, recursive: true); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static bool IsTrue(string v) =>
    v.Equals("true", StringComparison.OrdinalIgnoreCase) || v == "1" ||
    v.Equals("yes",  StringComparison.OrdinalIgnoreCase);

string[] A(params string[] extras)
{
    var list = new List<string>(mock);
    list.AddRange(extras);
    return list.ToArray();
}

void Sep(string title)
{
    Console.WriteLine("\n" + new string('─', 60));
    Console.WriteLine($"  {title}");
    Console.WriteLine(new string('─', 60));
}

void Run(params string[] args)
{
    var psi = new ProcessStartInfo(cli) { UseShellExecute = false };
    foreach (var a in args) psi.ArgumentList.Add(a);
    Process.Start(psi)?.WaitForExit();
}

string Capture(params string[] args)
{
    var psi = new ProcessStartInfo(cli)
        { UseShellExecute = false, RedirectStandardOutput = true };
    foreach (var a in args) psi.ArgumentList.Add(a);
    using var p = Process.Start(psi)!;
    var output = p.StandardOutput.ReadToEnd();
    p.WaitForExit();
    return output;
}

