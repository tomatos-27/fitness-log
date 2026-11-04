#!/bin/sh

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR="$PROJECT_DIR/dist"

for required_file in index.html app.js data.js styles.css sw.js manifest.webmanifest _headers; do
  if [ ! -f "$PROJECT_DIR/$required_file" ]; then
    printf 'Missing required source file: %s\n' "$required_file" >&2
    exit 1
  fi
done

if [ ! -d "$PROJECT_DIR/icons" ]; then
  printf 'Missing required source directory: icons\n' >&2
  exit 1
fi

if [ -z "$PROJECT_DIR" ] || [ "$OUTPUT_DIR" != "$PROJECT_DIR/dist" ] || [ "$OUTPUT_DIR" = "/" ]; then
  printf 'Refusing to clean an unexpected output directory.\n' >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/icons"

cp \
  "$PROJECT_DIR/index.html" \
  "$PROJECT_DIR/app.js" \
  "$PROJECT_DIR/data.js" \
  "$PROJECT_DIR/styles.css" \
  "$PROJECT_DIR/sw.js" \
  "$PROJECT_DIR/manifest.webmanifest" \
  "$PROJECT_DIR/_headers" \
  "$OUTPUT_DIR/"

cp -R "$PROJECT_DIR/icons/." "$OUTPUT_DIR/icons/"

printf 'Built Fitness Log into %s\n' "$OUTPUT_DIR"
