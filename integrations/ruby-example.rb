#!/usr/bin/env ruby
# frozen_string_literal: true
#
# integrations/ruby-example.rb
#
# Demonstrates driving the ai-powered CLI from Ruby.
# Covers: text, image (--output), --dry-run, --quiet, --session,
#         structured (--schema), --mock, --log, --debug.
#
# Usage:
#   AI_MOCK=true ruby integrations/ruby-example.rb

require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

CLI       = ENV.fetch('CLI', 'ai-powered')
MOCK      = %w[true 1 yes].include?(ENV.fetch('AI_MOCK', '').downcase)
MOCK_FLAG = MOCK ? ['--mock'] : []

def sep(title)
  puts "\n#{'─' * 60}"
  puts "  #{title}"
  puts '─' * 60
end

def run(*args)
  cmd = [CLI, *args]
  system(*cmd).tap { |ok| warn "[WARN] exit #{$CHILD_STATUS.exitstatus}" unless ok }
end

def capture(*args)
  cmd = [CLI, *args]
  stdout, _stderr, _status = Open3.capture3(*cmd)
  stdout
end

Dir.mktmpdir('ai-powered-rb-') do |tmp|

  # 1. Text generation
  sep '1. Text generation'
  run('text', *MOCK_FLAG, 'Explain what a REST API is in one sentence.')

  # 2. Quiet mode
  sep '2. Text generation (--quiet)'
  raw = capture('text', *MOCK_FLAG, '--quiet', 'What is 2 + 2?').strip
  puts "Raw result: #{raw}"

  # 3. JSON envelope
  sep '3. Text generation (--json)'
  json_str = capture('text', *MOCK_FLAG, '--json', 'Summarise TCP/IP in one sentence.')
  begin
    puts JSON.pretty_generate(JSON.parse(json_str))
  rescue JSON::ParserError
    puts json_str
  end

  # 4. Dry-run
  sep '4. Dry-run cost estimate'
  dry = capture('text', *MOCK_FLAG, '--dry-run', 'Write a 500-word essay on quantum computing.')
  begin
    puts JSON.pretty_generate(JSON.parse(dry))
  rescue JSON::ParserError
    puts dry
  end

  # 5. Image generation
  sep '5. Image generation (--output)'
  img_out = File.join(tmp, 'image.png')
  run('image', *MOCK_FLAG, '--output', img_out, 'A serene mountain lake at sunrise')
  if File.exist?(img_out)
    puts "Image saved: #{img_out} (#{File.size(img_out)} bytes)"
  else
    warn 'ERROR: image file not created.'
    exit 1
  end

  # 6. Multi-turn session
  sep '6. Multi-turn session'
  session_id = "ruby-session-#{Time.now.to_i}"
  run('text', *MOCK_FLAG, '--session', session_id, 'My name is Alice.')
  run('text', *MOCK_FLAG, '--session', session_id, 'What is my name?')
  run('session', 'list')
  run('session', 'clear', session_id)

  # 7. Structured output (JSON Schema)
  sep '7. Structured output (--schema)'
  schema_file = File.join(tmp, 'schema.json')
  schema = {
    type: 'object',
    properties: {
      name:       { type: 'string'  },
      capital:    { type: 'string'  },
      population: { type: 'number'  },
      in_europe:  { type: 'boolean' }
    },
    required: %w[name capital population in_europe]
  }
  File.write(schema_file, JSON.pretty_generate(schema))
  run('structured', *MOCK_FLAG, '--schema', schema_file, 'Describe France as a JSON object.')

  # 8. Batch processing
  sep '8. Batch text processing'
  batch_in  = File.join(tmp, 'batch_input.jsonl')
  batch_out = File.join(tmp, 'batch_output.jsonl')
  File.write(batch_in, [
    { prompt: 'What is the speed of light?' },
    { prompt: 'Who wrote Hamlet?' },
    { prompt: 'What is pi?' }
  ].map(&JSON.method(:generate)).join("\n") + "\n")
  run('batch', 'text', *MOCK_FLAG, '--input', batch_in, '--output', batch_out)
  puts '--- Batch output ---'
  puts File.read(batch_out)

  # 9. Debug logging
  sep '9. Debug logging (--debug)'
  run('text', *MOCK_FLAG, '--debug', 'Hello world.')
end

puts "\n✓ ruby-example.rb complete."

