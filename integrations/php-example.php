<?php
/**
 * integrations/php-example.php
 *
 * Demonstrates driving the ai-powered CLI from PHP using proc_open / shell_exec.
 * Covers: text, image (--output), --dry-run, --quiet, --session,
 *         structured (--schema), --mock, --log, --debug.
 *
 * Usage:
 *   AI_MOCK=true php integrations/php-example.php
 */

declare(strict_types=1);

$cli      = getenv('CLI') ?: 'ai-powered';
$isMock   = in_array(strtolower((string) getenv('AI_MOCK')), ['true', '1', 'yes'], true);
$mockFlag = $isMock ? '--mock' : '';
$tmpDir   = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'ai-powered-php-' . mt_rand();
mkdir($tmpDir, 0700, true);

function sep(string $title): void {
    echo "\n" . str_repeat('─', 60) . "\n  {$title}\n" . str_repeat('─', 60) . "\n";
}

function run(string $cmd): int {
    passthru($cmd, $code);
    return $code;
}

function capture(string $cmd): string {
    return (string) shell_exec($cmd);
}

register_shutdown_function(function () use ($tmpDir): void {
    if (PHP_OS_FAMILY === 'Windows') {
        exec("rmdir /s /q " . escapeshellarg($tmpDir));
    } else {
        exec("rm -rf " . escapeshellarg($tmpDir));
    }
});

// 1. Text generation
sep('1. Text generation');
run("{$cli} text {$mockFlag} " . escapeshellarg('Explain what a REST API is in one sentence.'));

// 2. Quiet mode
sep('2. Text generation (--quiet)');
$raw = trim(capture("{$cli} text {$mockFlag} --quiet " . escapeshellarg('What is 2 + 2?')));
echo "Raw result: {$raw}\n";

// 3. JSON envelope
sep('3. Text generation (--json)');
$jsonStr = capture("{$cli} text {$mockFlag} --json " . escapeshellarg('Summarise TCP/IP in one sentence.'));
$obj = json_decode((string) $jsonStr, true);
if ($obj !== null) {
    echo json_encode($obj, JSON_PRETTY_PRINT) . "\n";
} else {
    echo $jsonStr;
}

// 4. Dry-run cost estimate
sep('4. Dry-run cost estimate');
$dry = capture("{$cli} text {$mockFlag} --dry-run " . escapeshellarg('Write a 500-word essay on quantum computing.'));
$obj = json_decode((string) $dry, true);
echo ($obj !== null ? json_encode($obj, JSON_PRETTY_PRINT) : $dry) . "\n";

// 5. Image generation
sep('5. Image generation (--output)');
$imgOut = $tmpDir . DIRECTORY_SEPARATOR . 'image.png';
run("{$cli} image {$mockFlag} --output " . escapeshellarg($imgOut) . ' ' . escapeshellarg('A serene mountain lake at sunrise'));
if (file_exists($imgOut)) {
    echo 'Image saved: ' . $imgOut . ' (' . filesize($imgOut) . " bytes)\n";
} else {
    fwrite(STDERR, "ERROR: image file not created.\n");
    exit(1);
}

// 6. Multi-turn session
sep('6. Multi-turn session');
$sessionId = 'php-session-' . time();
run("{$cli} text {$mockFlag} --session " . escapeshellarg($sessionId) . ' ' . escapeshellarg('My name is Alice.'));
run("{$cli} text {$mockFlag} --session " . escapeshellarg($sessionId) . ' ' . escapeshellarg('What is my name?'));
run("{$cli} session list");
run("{$cli} session clear " . escapeshellarg($sessionId));

// 7. Structured output (JSON Schema)
sep('7. Structured output (--schema)');
$schemaFile = $tmpDir . DIRECTORY_SEPARATOR . 'schema.json';
$schema = [
    'type'       => 'object',
    'properties' => [
        'name'       => ['type' => 'string'],
        'capital'    => ['type' => 'string'],
        'population' => ['type' => 'number'],
        'in_europe'  => ['type' => 'boolean'],
    ],
    'required' => ['name', 'capital', 'population', 'in_europe'],
];
file_put_contents($schemaFile, json_encode($schema, JSON_PRETTY_PRINT));
run("{$cli} structured {$mockFlag} --schema " . escapeshellarg($schemaFile) . ' ' . escapeshellarg('Describe France as a JSON object.'));

// 8. Batch processing
sep('8. Batch text processing');
$batchIn  = $tmpDir . DIRECTORY_SEPARATOR . 'batch_input.jsonl';
$batchOut = $tmpDir . DIRECTORY_SEPARATOR . 'batch_output.jsonl';
$lines = [
    json_encode(['prompt' => 'What is the speed of light?']),
    json_encode(['prompt' => 'Who wrote Hamlet?']),
    json_encode(['prompt' => 'What is pi?']),
];
file_put_contents($batchIn, implode("\n", $lines) . "\n");
run("{$cli} batch text {$mockFlag} --input " . escapeshellarg($batchIn) . ' --output ' . escapeshellarg($batchOut));
echo "--- Batch output ---\n";
echo file_get_contents($batchOut);

// 9. Debug logging
sep('9. Debug logging (--debug)');
run("{$cli} text {$mockFlag} --debug " . escapeshellarg('Hello world.'));

echo "\n✓ php-example.php complete.\n";

