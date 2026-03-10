#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="1.3.0"
MAX_MEDIA_HEIGHT=3200
PROGRESS_BAR_WIDTH=32

# Optional terminal colors when stdout is a TTY.
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_BLUE=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
fi

log_info() { printf "%s[INFO]%s %s\n" "$C_BLUE" "$C_RESET" "$*"; }
log_ok() { printf "%s[OK]%s   %s\n" "$C_GREEN" "$C_RESET" "$*"; }
log_warn() { printf "%s[WARN]%s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
log_err() { printf "%s[ERR]%s  %s\n" "$C_RED" "$C_RESET" "$*" >&2; }

print_divider() { printf "%s\n" "------------------------------------------------------------"; }

progress_draw() {
  local label="$1"
  local current="${2:-0}"
  local total="${3:-1}"
  local pct filled empty
  local bar_filled bar_empty

  if ! is_int "$current"; then current=0; fi
  if ! is_int "$total" || [[ "$total" -le 0 ]]; then total=1; fi
  [[ "$current" -lt 0 ]] && current=0
  [[ "$current" -gt "$total" ]] && current="$total"

  pct=$(( current * 100 / total ))
  filled=$(( pct * PROGRESS_BAR_WIDTH / 100 ))
  empty=$(( PROGRESS_BAR_WIDTH - filled ))
  bar_filled=$(printf "%${filled}s" "" | tr ' ' '#')
  bar_empty=$(printf "%${empty}s" "" | tr ' ' '-')

  if [[ -t 1 ]]; then
    printf "\r%s%s%s [%s%s] %3d%% (%d/%d)" "$C_DIM" "$label" "$C_RESET" "$bar_filled" "$bar_empty" "$pct" "$current" "$total"
    if [[ "$current" -ge "$total" ]]; then
      printf "\n"
    fi
  else
    printf "%s [%s%s] %3d%% (%d/%d)\n" "$label" "$bar_filled" "$bar_empty" "$pct" "$current" "$total"
  fi
}

is_int() {
  case "${1:-}" in
    ""|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  log_err "Required command not found: $cmd"
  return 1
}

step_description() {
  case "${1:-}" in
    1) printf "Deduplicate files (remove exact duplicates)" ;;
    2) printf "Convert multiple video formats to .mp4" ;;
    3) printf "Resize media" ;;
    4) printf "Remove metadata from images and videos" ;;
    *) printf "Unknown step" ;;
  esac
}

step_function_name() {
  case "${1:-}" in
    1) printf "step1_dedupe" ;;
    2) printf "step2_convert_videos" ;;
    3) printf "step3_resize_media" ;;
    4) printf "step4_remove_metadata" ;;
    *) printf "" ;;
  esac
}

ensure_step_requirements() {
  local step_num="$1"
  case "$step_num" in
    1)
      require_cmd fdupes
      ;;
    2)
      require_cmd ffmpeg
      ;;
    3)
      require_cmd sips
      require_cmd ffprobe
      require_cmd ffmpeg
      ;;
    4)
      require_cmd mat2
      ;;
    *)
      return 1
      ;;
  esac
}

run_step() {
  local step_num="$1"
  local fn="$2"
  local desc="$3"
  local start_ts end_ts elapsed

  print_divider
  printf "%sSTEP %s%s: %s\n" "$C_BOLD" "$step_num" "$C_RESET" "$desc"
  start_ts=$(date +%s)
  "$fn"
  end_ts=$(date +%s)
  elapsed=$(( end_ts - start_ts ))
  log_ok "Step $step_num completed in ${elapsed}s"
}

step1_dedupe() {
  local phase_total=3
  local file_count

  log_info "Running recursive dedupe with fdupes (-r -A -d -N)."
  log_info "Duplicates are auto-removed; first occurrence is kept."
  progress_draw "Step 1 Dedupe" 1 "$phase_total"
  file_count=$(find . -type f | wc -l | tr -d ' ')
  log_info "Files discovered: ${file_count:-0}"
  progress_draw "Step 1 Dedupe" 2 "$phase_total"
  fdupes -r -A -d -N . || { log_err "fdupes failed."; exit 1; }
  progress_draw "Step 1 Dedupe" 3 "$phase_total"
}

step2_convert_videos() {
  local files=()
  local file output
  local i total
  local copied=0 reencoded=0 skipped=0 failed=0
  local progress=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.m4v" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.webm" \
                      -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.mpg" -o -iname "*.mpeg" -o -iname "*.3gp" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No source videos found for conversion."
    return 0
  fi

  log_info "Found $total video file(s) to evaluate."

  for (( i=0; i<total; i++ )); do
    file="${files[$i]}"
    output="${file%.*}.mp4"

    if [[ -f "$output" ]]; then
      skipped=$((skipped + 1))
      progress=$((progress + 1))
      progress_draw "Step 2 Convert" "$progress" "$total"
      continue
    fi

    if ffmpeg -hide_banner -loglevel error -i "$file" -c copy -map 0 -movflags +faststart "$output"; then
      rm -f "$file"
      copied=$((copied + 1))
      progress=$((progress + 1))
      progress_draw "Step 2 Convert" "$progress" "$total"
      continue
    fi

    if ffmpeg -hide_banner -loglevel error -i "$file" -map 0 -c:v libx264 -crf 23 -preset medium -c:a aac -movflags +faststart "$output"; then
      rm -f "$file"
      reencoded=$((reencoded + 1))
      progress=$((progress + 1))
      progress_draw "Step 2 Convert" "$progress" "$total"
      continue
    fi

    rm -f "$output" 2>/dev/null || true
    failed=$((failed + 1))
    log_err "Conversion failed: $file"
    progress=$((progress + 1))
    progress_draw "Step 2 Convert" "$progress" "$total"
  done

  log_info "Video conversion summary:"
  printf "  - Stream copied: %d\n" "$copied"
  printf "  - Re-encoded:    %d\n" "$reencoded"
  printf "  - Skipped:       %d\n" "$skipped"
  printf "  - Failed:        %d\n" "$failed"
}

step3_resize_media() {
  local images=() videos=()
  local file ext base tmp
  local i total w h nw
  local all_total=0 all_done=0
  local img_resized=0 img_skipped=0 img_failed=0
  local vid_resized=0 vid_skipped=0 vid_failed=0

  while IFS= read -r -d '' file; do
    images+=("$file")
  done < <(
    find . -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" \
                      -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \) -print0
  )

  while IFS= read -r -d '' file; do
    videos+=("$file")
  done < <(
    find . -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" \
                      -o -iname "*.webm" -o -iname "*.avi" \) -print0
  )

  all_total=$(( ${#images[@]} + ${#videos[@]} ))
  if [[ "$all_total" -eq 0 ]]; then
    log_warn "No media found to evaluate for resizing."
    return 0
  fi

  total=${#images[@]}
  if [[ "$total" -gt 0 ]]; then
    log_info "Checking $total image file(s) for height > ${MAX_MEDIA_HEIGHT}px."
    for (( i=0; i<total; i++ )); do
      file="${images[$i]}"

      w=$(sips -g pixelWidth "$file" 2>/dev/null | awk '/pixelWidth/ {print $2; exit}')
      h=$(sips -g pixelHeight "$file" 2>/dev/null | awk '/pixelHeight/ {print $2; exit}')
      if ! is_int "$w" || ! is_int "$h"; then
        img_skipped=$((img_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 3 Resize" "$all_done" "$all_total"
        continue
      fi
      if [[ "$h" -le "$MAX_MEDIA_HEIGHT" ]]; then
        img_skipped=$((img_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 3 Resize" "$all_done" "$all_total"
        continue
      fi

      nw=$(( w * MAX_MEDIA_HEIGHT / h ))
      [[ "$nw" -lt 1 ]] && nw=1
      if sips -z "$MAX_MEDIA_HEIGHT" "$nw" "$file" >/dev/null 2>&1; then
        img_resized=$((img_resized + 1))
      else
        img_failed=$((img_failed + 1))
        log_err "Resize failed: $file"
      fi
      all_done=$((all_done + 1))
      progress_draw "Step 3 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No images found to evaluate for resizing."
  fi

  total=${#videos[@]}
  if [[ "$all_done" -gt 0 ]]; then
    progress_draw "Step 3 Resize" "$all_done" "$all_total"
  fi
  if [[ "$total" -gt 0 ]]; then
    log_info "Checking $total video file(s) for height > ${MAX_MEDIA_HEIGHT}px."
    for (( i=0; i<total; i++ )); do
      file="${videos[$i]}"

      w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$file" 2>/dev/null | head -n 1)
      h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$file" 2>/dev/null | head -n 1)
      if ! is_int "$w" || ! is_int "$h"; then
        vid_skipped=$((vid_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 3 Resize" "$all_done" "$all_total"
        continue
      fi
      if [[ "$h" -le "$MAX_MEDIA_HEIGHT" ]]; then
        vid_skipped=$((vid_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 3 Resize" "$all_done" "$all_total"
        continue
      fi

      nw=$(( w * MAX_MEDIA_HEIGHT / h ))
      nw=$(( (nw / 2) * 2 ))
      [[ "$nw" -lt 2 ]] && nw=2
      ext=$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')
      base="${file%.*}"
      tmp="${base}.resize-tmp.$$.$ext"
      rm -f "$tmp"

      case "$ext" in
        mp4|m4v)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${MAX_MEDIA_HEIGHT}" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy -movflags +faststart "$tmp"
          ;;
        mov|mkv|avi)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${MAX_MEDIA_HEIGHT}" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
          ;;
        webm)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${MAX_MEDIA_HEIGHT}" -map 0 -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a copy -c:s copy "$tmp"
          ;;
        *)
          vid_skipped=$((vid_skipped + 1))
          all_done=$((all_done + 1))
          progress_draw "Step 3 Resize" "$all_done" "$all_total"
          continue
          ;;
      esac

      if [[ -s "$tmp" ]]; then
        mv -f "$tmp" "$file"
        vid_resized=$((vid_resized + 1))
        log_ok "Resized video to max height ${MAX_MEDIA_HEIGHT}px."
      else
        rm -f "$tmp"
        vid_failed=$((vid_failed + 1))
        log_err "Resize failed: $file"
      fi
      all_done=$((all_done + 1))
      progress_draw "Step 3 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No videos found to evaluate for resizing."
  fi

  log_info "Resize summary:"
  printf "  - Max height:     %d\n" "$MAX_MEDIA_HEIGHT"
  printf "  - Images resized: %d\n" "$img_resized"
  printf "  - Images skipped: %d\n" "$img_skipped"
  printf "  - Images failed:  %d\n" "$img_failed"
  printf "  - Videos resized: %d\n" "$vid_resized"
  printf "  - Videos skipped: %d\n" "$vid_skipped"
  printf "  - Videos failed:  %d\n" "$vid_failed"
}

step4_remove_metadata() {
  local files=()
  local file
  local i total
  local cleaned=0 failed=0
  local progress=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \
                      -o -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" -o -iname "*.avi" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No files matched metadata-scrub extensions."
    return 0
  fi

  log_info "Removing metadata from $total file(s) using mat2 --inplace."
  for (( i=0; i<total; i++ )); do
    file="${files[$i]}"
    if mat2 --inplace "$file" >/dev/null 2>&1; then
      cleaned=$((cleaned + 1))
    else
      failed=$((failed + 1))
      log_err "mat2 failed: $file"
    fi
    progress=$((progress + 1))
    progress_draw "Step 4 Metadata" "$progress" "$total"
  done

  log_info "Metadata scrub summary:"
  printf "  - Cleaned: %d\n" "$cleaned"
  printf "  - Failed:  %d\n" "$failed"
}

choose_resize_height() {
  local choice custom

  print_divider
  echo "Step 3 Resize: choose max media height"
  echo "1. 3200 (Default)"
  echo "2. 2400"
  echo "3. 2800"
  echo "4. 3600"
  echo "5. 4320"
  echo "6. Custom"
  read -r -p "Select size [1]: " choice
  choice="${choice:-1}"

  case "$choice" in
    1) MAX_MEDIA_HEIGHT=3200 ;;
    2) MAX_MEDIA_HEIGHT=2400 ;;
    3) MAX_MEDIA_HEIGHT=2800 ;;
    4) MAX_MEDIA_HEIGHT=3600 ;;
    5) MAX_MEDIA_HEIGHT=4320 ;;
    6)
      while true; do
        read -r -p "Enter custom max height in pixels: " custom
        if is_int "$custom" && [[ "$custom" -gt 0 ]]; then
          MAX_MEDIA_HEIGHT="$custom"
          break
        fi
        log_warn "Please enter a positive whole number."
      done
      ;;
    *)
      log_warn "Invalid choice. Using default 3200."
      MAX_MEDIA_HEIGHT=3200
      ;;
  esac

  log_info "Resize max height set to ${MAX_MEDIA_HEIGHT}px."
}

main() {
  local input token confirm
  local selected=() raw=() invalid=()
  local sorted=() valid_selected=()
  local num fn desc

  print_divider
  printf "%sLocal Gallery Cleaner v%s%s\n" "$C_BOLD" "$SCRIPT_VERSION" "$C_RESET"
  printf "Working directory: %s\n" "$PWD"
  print_divider

  echo "Select which steps to run (comma-separated numbers, or 0 for all):"
  echo "0. Run all steps in order"
  echo "1. $(step_description 1)"
  echo "2. $(step_description 2)"
  echo "3. $(step_description 3)"
  echo "4. $(step_description 4)"
  read -r -p "> " input
  input="${input// /}"

  if [[ "$input" == "0" ]]; then
    selected=(1 2 3 4)
  else
    IFS=',' read -r -a raw <<< "$input"
    for token in "${raw[@]}"; do
      if [[ -z "$token" ]]; then
        continue
      fi
      if is_int "$token"; then
        selected+=("$token")
      else
        invalid+=("$token")
      fi
    done
  fi

  if [[ "${#invalid[@]}" -gt 0 ]]; then
    log_warn "Ignoring invalid token(s): ${invalid[*]}"
  fi

  if [[ "${#selected[@]}" -eq 0 ]]; then
    log_err "No valid step numbers selected."
    exit 1
  fi

  IFS=$'\n' sorted=($(printf "%s\n" "${selected[@]}" | sort -n -u))
  unset IFS

  for num in "${sorted[@]}"; do
    if [[ "$num" -ge 1 && "$num" -le 4 ]]; then
      valid_selected+=("$num")
    else
      log_warn "Skipping out-of-range step: $num"
    fi
  done

  if [[ "${#valid_selected[@]}" -eq 0 ]]; then
    log_err "No runnable steps selected."
    exit 1
  fi

  print_divider
  echo "Selected steps:"
  for num in "${valid_selected[@]}"; do
    echo "  - $num. $(step_description "$num")"
  done

  for num in "${valid_selected[@]}"; do
    if [[ "$num" -eq 3 ]]; then
      choose_resize_height
      break
    fi
  done

  read -r -p "Run selected steps now? [y/N] " confirm
  confirm="${confirm:-N}"
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    log_warn "Cancelled."
    exit 0
  fi

  for num in "${valid_selected[@]}"; do
    desc="$(step_description "$num")"
    fn="$(step_function_name "$num")"
    if [[ -z "$fn" ]]; then
      log_err "Internal error: no function mapped for step $num"
      exit 1
    fi
    ensure_step_requirements "$num"
    run_step "$num" "$fn" "$desc"
  done

  print_divider
  printf "%sAll selected steps completed.%s\n" "$C_BOLD" "$C_RESET"
}

main "$@"
