#!/usr/bin/env bash
#
# Transcode one source video into a self-hosted, web-playable package:
#   - poster.jpg          still frame for the player + link previews
#   - download.mp4        single-file H.264/AAC (Safari-native, "Download" button)
#   - master.m3u8 + parts adaptive-bitrate HLS ladder (1080p / 720p / 480p)
#   - index.html          the watch page (from _player.html.template)
#
# Everything lands in ./site/<slug>/ and is served at
#   https://video.smithfamily.casa/<slug>/
#
# Usage:
#   ./transcode.sh <input-video> <slug> ["Human Readable Title"]
#
# Example:
#   ./transcode.sh ~/Movies/recital.mov spring-recital "Maya's Spring Recital"
#
# Requires: ffmpeg (with libx264 + aac). On Debian/Ubuntu: sudo apt install ffmpeg
set -euo pipefail

INPUT="${1:?Usage: ./transcode.sh <input-video> <slug> [title]}"
SLUG="${2:?Usage: ./transcode.sh <input-video> <slug> [title]}"
TITLE="${3:-$SLUG}"

if ! command -v ffmpeg >/dev/null 2>&1; then
	echo "ffmpeg not found. Install it first (e.g. sudo apt install ffmpeg)." >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/site/$SLUG"
mkdir -p "$OUT"

echo ">> [1/4] Poster frame"
ffmpeg -y -ss 3 -i "$INPUT" -frames:v 1 -q:v 3 "$OUT/poster.jpg"

echo ">> [2/4] Progressive MP4 (download + Safari fallback)"
ffmpeg -y -i "$INPUT" \
	-vf "scale='min(1920,iw)':-2" \
	-c:v libx264 -profile:v high -preset slow -crf 20 -maxrate 6M -bufsize 12M \
	-c:a aac -b:a 160k -movflags +faststart \
	"$OUT/download.mp4"

echo ">> [3/4] Adaptive HLS ladder (1080p / 720p / 480p)"
ffmpeg -y -i "$INPUT" \
	-filter_complex "[0:v]split=3[v1][v2][v3];\
[v1]scale=w=1920:h=-2[v1out];\
[v2]scale=w=1280:h=-2[v2out];\
[v3]scale=w=854:h=-2[v3out]" \
	-map "[v1out]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k \
	-map "[v2out]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k \
	-map "[v3out]" -c:v:2 libx264 -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k \
	-map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k -ac 2 \
	-preset veryfast -g 48 -keyint_min 48 -sc_threshold 0 \
	-f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments \
	-master_pl_name master.m3u8 \
	-var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p" \
	"$OUT/stream_%v.m3u8"

echo ">> [4/4] Watch page"
sed -e "s/{{TITLE}}/$(printf '%s' "$TITLE" | sed 's/[&/\]/\\&/g')/g" \
	"$SCRIPT_DIR/site/_player.html.template" > "$OUT/index.html"

echo
echo "Done. Deploy (or it's already live if Caddy is running):"
echo "  https://video.smithfamily.casa/$SLUG/"
