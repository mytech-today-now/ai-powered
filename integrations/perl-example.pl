#!/usr/bin/env perl
# integrations/perl-example.pl
#
# Demonstrates driving the ai-powered CLI from Perl.
# Covers: text, image (--output), --dry-run, --quiet, --session,
#         structured (--schema), --mock, --log, --debug.
#
# Usage:
#   AI_MOCK=true perl integrations/perl-example.pl

use strict;
use warnings;
use File::Temp qw(tempdir);
use File::Spec;
use JSON::PP;
use POSIX qw(strftime);

my $cli       = $ENV{CLI} // 'ai-powered';
my $is_mock   = lc($ENV{AI_MOCK} // '') =~ /^(true|1|yes)$/;
my @mock_flag = $is_mock ? ('--mock') : ();
my $tmp       = tempdir('ai-powered-pl-XXXXXX', TMPDIR => 1, CLEANUP => 1);

sub sep {
    my ($title) = @_;
    print "\n" . ('─' x 60) . "\n  $title\n" . ('─' x 60) . "\n";
}

sub run_cmd {
    my @args = @_;
    system($cli, @args);
    warn "[WARN] Exit code $?\n" if $?;
}

sub capture_cmd {
    my @args = @_;
    my $out  = `$cli @{[ map { quotemeta($_) } @args ]}`;
    return $out // '';
}

# 1. Text generation
sep('1. Text generation');
run_cmd('text', @mock_flag, 'Explain what a REST API is in one sentence.');

# 2. Quiet mode
sep('2. Text generation (--quiet)');
my $raw = capture_cmd('text', @mock_flag, '--quiet', 'What is 2 + 2?');
$raw =~ s/\s+$//;
print "Raw result: $raw\n";

# 3. JSON envelope
sep('3. Text generation (--json)');
my $json_str = capture_cmd('text', @mock_flag, '--json', 'Summarise TCP/IP in one sentence.');
eval {
    my $obj = decode_json($json_str);
    print encode_json($obj) . "\n";
};
print $json_str if $@;

# 4. Dry-run
sep('4. Dry-run cost estimate');
my $dry = capture_cmd('text', @mock_flag, '--dry-run', 'Write a 500-word essay on quantum computing.');
eval {
    my $obj = decode_json($dry);
    print encode_json($obj) . "\n";
};
print $dry if $@;

# 5. Image generation
sep('5. Image generation (--output)');
my $img_out = File::Spec->catfile($tmp, 'image.png');
run_cmd('image', @mock_flag, '--output', $img_out, 'A serene mountain lake at sunrise');
if (-e $img_out) {
    printf "Image saved: %s (%d bytes)\n", $img_out, -s $img_out;
} else {
    warn "ERROR: image file not created.\n";
    exit 1;
}

# 6. Multi-turn session
sep('6. Multi-turn session');
my $session_id = 'perl-session-' . time();
run_cmd('text', @mock_flag, '--session', $session_id, 'My name is Alice.');
run_cmd('text', @mock_flag, '--session', $session_id, 'What is my name?');
run_cmd('session', 'list');
run_cmd('session', 'clear', $session_id);

# 7. Structured output (JSON Schema)
sep('7. Structured output (--schema)');
my $schema_file = File::Spec->catfile($tmp, 'schema.json');
my $schema = {
    type       => 'object',
    properties => {
        name       => { type => 'string'  },
        capital    => { type => 'string'  },
        population => { type => 'number'  },
        in_europe  => { type => 'boolean' },
    },
    required => [qw(name capital population in_europe)],
};
open(my $fh, '>', $schema_file) or die "Cannot write schema: $!";
print $fh encode_json($schema);
close $fh;
run_cmd('structured', @mock_flag, '--schema', $schema_file, 'Describe France as a JSON object.');

# 8. Batch processing
sep('8. Batch text processing');
my $batch_in  = File::Spec->catfile($tmp, 'batch_input.jsonl');
my $batch_out = File::Spec->catfile($tmp, 'batch_output.jsonl');
open($fh, '>', $batch_in) or die "Cannot write batch input: $!";
for my $prompt ('What is the speed of light?', 'Who wrote Hamlet?', 'What is pi?') {
    print $fh encode_json({ prompt => $prompt }) . "\n";
}
close $fh;
run_cmd('batch', 'text', @mock_flag, '--input', $batch_in, '--output', $batch_out);
print "--- Batch output ---\n";
open($fh, '<', $batch_out) or die "Cannot read batch output: $!";
print while <$fh>;
close $fh;

# 9. Debug logging
sep('9. Debug logging (--debug)');
run_cmd('text', @mock_flag, '--debug', 'Hello world.');

print "\n✓ perl-example.pl complete.\n";

