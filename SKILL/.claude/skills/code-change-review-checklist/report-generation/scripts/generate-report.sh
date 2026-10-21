#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: generate-report.sh <review-data.json> <review-report.html>" >&2
  exit 1
fi

skill_input_path="$1"
skill_output_path="$2"

if [[ ! -f "$skill_input_path" ]]; then
  echo "Input JSON does not exist: $skill_input_path" >&2
  exit 1
fi

skill_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root_dir="$(cd "$skill_script_dir/.." && pwd)"
skill_generator_source="$skill_root_dir/assets/generator"
skill_cache_key="$(sha256sum "$skill_generator_source/package-lock.json" "$skill_generator_source/generate-report.mjs" | sha256sum | cut -c1-16)"
skill_runtime_dir="${TMPDIR:-/tmp}/code-change-flow-report-$skill_cache_key"

node "$skill_script_dir/verify-orchestration.mjs" --self-test
node "$skill_script_dir/verify-orchestration.mjs" "$skill_input_path"
node "$skill_script_dir/validate-review-data.mjs" --self-test-root-sections
node "$skill_script_dir/validate-review-data.mjs" --self-test-specification
node "$skill_script_dir/validate-review-data.mjs" --self-test-explanation
node "$skill_script_dir/validate-review-data.mjs" "$skill_input_path"
node "$skill_script_dir/verify-caller-coverage.mjs" --self-test
node "$skill_script_dir/verify-caller-coverage.mjs" "$skill_input_path"
node "$skill_script_dir/verify-continuation-structure.mjs" --self-test
node "$skill_script_dir/verify-continuation-structure.mjs" "$skill_input_path"

mkdir -p "$skill_runtime_dir"
cp "$skill_generator_source/package.json" "$skill_runtime_dir/package.json"
cp "$skill_generator_source/package-lock.json" "$skill_runtime_dir/package-lock.json"
cp "$skill_generator_source/generate-report.mjs" "$skill_runtime_dir/generate-report.mjs"

if [[ ! -d "$skill_runtime_dir/node_modules/shiki" || ! -d "$skill_runtime_dir/node_modules/diff" ]]; then
  npm ci --prefix "$skill_runtime_dir" --include=dev --ignore-scripts --no-audit --no-fund
fi

node "$skill_runtime_dir/generate-report.mjs" --self-test-depth 10000
node "$skill_runtime_dir/generate-report.mjs" --self-test-connections
node "$skill_runtime_dir/generate-report.mjs" --self-test-collapse

skill_output_dir="$(dirname "$skill_output_path")"
skill_output_name="$(basename "$skill_output_path")"
mkdir -p "$skill_output_dir"
skill_temporary_output="$(mktemp "$skill_output_dir/.${skill_output_name}.unverified.XXXXXX")"
cleanup_temporary_output() {
  rm -f -- "$skill_temporary_output"
}
trap cleanup_temporary_output EXIT

node "$skill_runtime_dir/generate-report.mjs" "$skill_input_path" "$skill_temporary_output"
node "$skill_script_dir/verify-generated-report.mjs" "$skill_input_path" "$skill_temporary_output"
mv -f -- "$skill_temporary_output" "$skill_output_path"
trap - EXIT
