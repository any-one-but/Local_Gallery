#!/usr/bin/env bash

set -euo pipefail

# ── Helper functions for each step ──
step1_dedupe() {
    echo "=== STEP 1: Deduplicating files recursively (fdupes -r -A -d -N) ==="
    echo "This finds identical files across the directory tree and keeps only the first occurrence of each duplicate."
    fdupes -r -A -d -N . || { echo "fdupes failed — stopping"; exit 1; }
    echo "Deduplication finished."
    echo ""
}

step2_convert_videos() {
    echo "=== STEP 2: Converting various video formats to .mp4 ==="
    echo "This converts .m4v, .mov, .mkv, .avi, .webm, .wmv, .flv, .mpg, .mpeg, .3gp (and similar) to .mp4 using stream copy when possible, or re-encoding as fallback."
    find . -type f \( -iname "*.m4v" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.webm" \
                      -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.mpg" -o -iname "*.mpeg" -o -iname "*.3gp" \) -print0 |
    while IFS= read -r -d '' file; do
        if [[ -f "$file" ]]; then
            output="${file%.*}.mp4"
            if [[ -f "$output" ]]; then
                echo "Skipping: $output already exists for $file"
                continue
            fi
            echo "Converting: $file → $output"
            # Try fast stream copy first
            ffmpeg -hide_banner -loglevel error -i "$file" -c copy -map 0 -movflags +faststart "$output" && {
                echo "Success (stream copy) — removing original"
                rm -f "$file"
            } || {
                # Fallback: re-encode to H.264/AAC in MP4
                ffmpeg -hide_banner -loglevel error -i "$file" -map 0 -c:v libx264 -crf 23 -preset medium -c:a aac -movflags +faststart "$output" && {
                    echo "Success (re-encoded) — removing original"
                    rm -f "$file"
                } || {
                    echo "Conversion failed: $file (partial file removed)"
                    rm -f "$output" 2>/dev/null
                }
            }
        fi
    done
    echo "Video conversion finished."
    echo ""
}

step3_scrub_shrink() {
    echo "=== STEP 3: Resize tall images/videos + scrub metadata ==="
    echo "This downsizes images and videos taller than 3200px (preserving aspect ratio), then removes embedded metadata from images and supported video files."

    # ── Image resize (sips on macOS) ──
    echo "→ Resizing tall images to max 3200 height ..."
    find . -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" \
                      -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \) -print0 |
    xargs -0 -n 1 -P 16 sh -c '
    isint() { case "$1" in ""|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
    f="$1"
    w=$(sips -g pixelWidth  "$f" 2>/dev/null | awk "/pixelWidth/  {print \$2}")
    h=$(sips -g pixelHeight "$f" 2>/dev/null | awk "/pixelHeight/ {print \$2}")
    isint "$w" && isint "$h" || exit 0
    [ "$h" -le 3200 ] && exit 0
    nw=$(( w * 3200 / h ))
    [ "$nw" -lt 1 ] && nw=1
    sips -z 3200 "$nw" "$f" >/dev/null
    ' sh

    # ── Video resize (ffmpeg) ──
    echo "→ Resizing tall videos to max 3200 height ..."
    find . -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" \
                      -o -iname "*.webm" -o -iname "*.avi" \) -print0 |
    xargs -0 -n 1 -P 8 sh -c '
    isint() { case "$1" in ""|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
    tolower() { printf "%s" "$1" | tr "[:upper:]" "[:lower:]"; }
    f="$1"
    w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$f" 2>/dev/null | head -n 1)
    h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$f" 2>/dev/null | head -n 1)
    isint "$w" && isint "$h" || exit 0
    [ "$h" -le 3200 ] && exit 0
    nw=$(( w * 3200 / h ))
    nw=$(( (nw/2)*2 ))
    [ "$nw" -lt 2 ] && nw=2
    ext=$(tolower "${f##*.}")
    base="${f%.*}"
    tmp="${base}.tmp.$$.$ext"
    case "$ext" in
      mp4|m4v)
        ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy -movflags +faststart "$tmp"
        ;;
      mov)
        ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
        ;;
      mkv|avi)
        ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
        ;;
      webm)
        ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=${nw}:3200" -map 0 -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a copy -c:s copy "$tmp"
        ;;
      *)
        exit 0
        ;;
    esac
    if [ -s "$tmp" ]; then
      mv -f "$tmp" "$f"
    else
      rm -f "$tmp"
    fi
    ' sh

    # ── Metadata scrubbing (mat2) ──
    echo "→ Removing metadata from images and videos ..."
    find . -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \
                   -o -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" -o -iname "*.avi" \) -print0 |
    xargs -0 -P 18 -n 200 sh -c '
    for f in "$@"; do
      mat2 --inplace "$f" || echo "mat2 failed on: $f" >&2
    done
    ' sh

    echo "Resize and metadata scrub finished."
    echo ""
}

# ── Main interactive logic ──
steps=(step1_dedupe step2_convert_videos step3_scrub_shrink)

echo "Select which steps to run (comma-separated numbers, or 0 for all):"
echo "0. Run all steps in order"
for i in "${!steps[@]}"; do
    step_num=$((i+1))
    case $step_num in
        1) desc="Deduplicate files (remove exact duplicates)" ;;
        2) desc="Convert multiple video formats to .mp4" ;;
        3) desc="Resize tall images/videos to max 3200px height + remove metadata" ;;
    esac
    echo "$step_num. $desc"
done

read -p "> " input
input="${input// /}"  # strip spaces

if [[ "$input" == "0" ]]; then
    selected=($(seq 1 ${#steps[@]}))
else
    IFS=',' read -r -a selected <<< "$input"
fi

# Sort to guarantee execution order
IFS=$'\n' sorted=($(sort -n <<<"${selected[*]}"))
unset IFS

for num in "${sorted[@]}"; do
    if [[ $num -ge 1 && $num -le ${#steps[@]} ]]; then
        ${steps[$((num-1))]}
    else
        echo "Invalid step number: $num (skipped)"
    fi
done

echo "=== Selected steps completed ==="
