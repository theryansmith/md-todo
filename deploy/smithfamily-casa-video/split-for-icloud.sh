#!/usr/bin/env bash
#
# Fallback path: if you specifically want the video INSIDE a public iCloud
# Shared Album, it must be under Apple's hard 15-minute-per-clip limit.
# This splits a long source into ~14-minute parts WITHOUT re-encoding
# (fast, lossless), so each part imports cleanly into Photos.
#
# After running, AirDrop/import the part-*.mp4 files to Photos, add them to a
# Shared Album, and enable its public website link.
#
# Usage:
#   ./split-for-icloud.sh <input-video> [minutes-per-part]
#
# Example (22-min video -> two ~11-min halves):
#   ./split-for-icloud.sh recital.mov 11
set -euo pipefail

INPUT="${1:?Usage: ./split-for-icloud.sh <input-video> [minutes-per-part]}"
MINUTES="${2:-14}"
SECONDS_PER_PART=$(( MINUTES * 60 ))

BASE="$(basename "${INPUT%.*}")"
OUT_DIR="$(dirname "$INPUT")/${BASE}-icloud-parts"
mkdir -p "$OUT_DIR"

# Stream-copy segmenting: no quality loss, splits on keyframes.
ffmpeg -y -i "$INPUT" \
	-c copy -map 0 \
	-f segment -segment_time "$SECONDS_PER_PART" -reset_timestamps 1 \
	-segment_format mp4 \
	"$OUT_DIR/${BASE}-part-%02d.mp4"

echo
echo "Parts written to: $OUT_DIR"
echo "Each is <= ${MINUTES} min, so it fits Apple's 15-min Shared Album limit."
