#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="1.5.0"
MAX_MEDIA_HEIGHT=3200
PROGRESS_BAR_WIDTH=32
EMPTY_ITEMS_BUCKET_NAME="_clean_empty_items"

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
  local mode="${4:-inline}"
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

  if [[ -t 1 && "$mode" != "line" ]]; then
    printf "\r%s%s%s [%s%s] %3d%% (%d/%d)" "$C_DIM" "$label" "$C_RESET" "$bar_filled" "$bar_empty" "$pct" "$current" "$total"
    if [[ "$current" -ge "$total" ]]; then
      printf "\n"
    fi
  else
    printf "%s [%s%s] %3d%% (%d/%d)\n" "$label" "$bar_filled" "$bar_empty" "$pct" "$current" "$total"
  fi
}

run_with_spinner() {
  local label="$1"
  shift
  local pid rc i=0
  local spinner='|/-\'
  local mark

  if [[ ! -t 1 ]]; then
    "$@"
    return $?
  fi

  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    mark="${spinner:$(( i % 4 )):1}"
    printf "\r%s%s%s %s" "$C_DIM" "$label" "$C_RESET" "$mark"
    i=$((i + 1))
    sleep 0.1
  done
  wait "$pid"
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    printf "\r%s%s%s done\n" "$C_DIM" "$label" "$C_RESET"
  else
    printf "\r%s%s%s failed\n" "$C_DIM" "$label" "$C_RESET"
  fi
  return "$rc"
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
    5) printf "Move 0-byte files and empty folders into a local bucket folder" ;;
    6) printf "Trim trailing spaces from file and folder names recursively" ;;
    *) printf "Unknown step" ;;
  esac
}

step_function_name() {
  case "${1:-}" in
    1) printf "step1_dedupe" ;;
    2) printf "step2_convert_videos" ;;
    3) printf "step3_resize_media" ;;
    4) printf "step4_remove_metadata" ;;
    5) printf "step5_move_empty_items" ;;
    6) printf "step6_trim_trailing_spaces" ;;
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
    5)
      require_cmd find
      require_cmd mv
      require_cmd mkdir
      ;;
    6)
      require_cmd find
      require_cmd mv
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
  local phase_total=3 phase=0
  local count_tmp dedupe_log
  local file_count

  log_info "Running recursive dedupe with fdupes (-r -A -d -N)."
  log_info "Duplicates are auto-removed; first occurrence is kept."
  count_tmp="$(mktemp)"
  if ! run_with_spinner "Step 1: counting files recursively" bash -c 'find . -type f | wc -l | tr -d " " > "$1"' _ "$count_tmp"; then
    rm -f "$count_tmp"
    log_err "Unable to count files for dedupe step."
    exit 1
  fi
  file_count="$(cat "$count_tmp" 2>/dev/null || printf "0")"
  rm -f "$count_tmp"
  phase=$((phase + 1))
  progress_draw "Step 1 Dedupe" "$phase" "$phase_total" "line"
  log_info "Files discovered: ${file_count:-0}"
  dedupe_log="$(mktemp)"
  if ! run_with_spinner "Step 1: running fdupes dedupe pass" bash -c 'fdupes -r -A -d -N . > "$1" 2>&1' _ "$dedupe_log"; then
    phase=$((phase + 1))
    progress_draw "Step 1 Dedupe" "$phase" "$phase_total" "line"
    log_err "fdupes failed. Last output:"
    tail -n 20 "$dedupe_log" >&2 || true
    rm -f "$dedupe_log"
    exit 1
  fi
  phase=$((phase + 1))
  progress_draw "Step 1 Dedupe" "$phase" "$phase_total" "line"
  if [[ -s "$dedupe_log" ]]; then
    log_info "fdupes produced output (ordered capture enabled)."
  else
    log_info "fdupes completed with no output."
  fi
  rm -f "$dedupe_log"
  phase=$((phase + 1))
  progress_draw "Step 1 Dedupe" "$phase" "$phase_total" "line"
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

unique_target_path() {
  local target="$1"
  local i=1
  local candidate="$target"
  if [[ ! -e "$candidate" ]]; then
    printf "%s" "$candidate"
    return 0
  fi
  while :; do
    candidate="${target}__dup${i}"
    if [[ ! -e "$candidate" ]]; then
      printf "%s" "$candidate"
      return 0
    fi
    i=$((i + 1))
  done
}

move_item_into_bucket() {
  local src="$1"
  local bucket_root="$2"
  local bucket_subdir="$3"
  local rel target target_dir

  rel="${src#./}"
  target="${bucket_root}/${bucket_subdir}/${rel}"
  target_dir="$(dirname "$target")"
  mkdir -p "$target_dir"
  target="$(unique_target_path "$target")"
  mv "$src" "$target"
}

step5_move_empty_items() {
  local bucket_root="./${EMPTY_ITEMS_BUCKET_NAME}"
  local zero_files=()
  local empty_dirs=()
  local selected_empty_dirs=()
  local pre_zero_tmp pre_empty_tmp list_zero_tmp list_empty_tmp
  local file dir parent
  local first_zero first_empty
  local i j total progress
  local phase_total=4 phase=0
  local zero_file_count=0 empty_dir_count=0 selected_dir_count=0
  local moved_files=0 moved_dirs=0 failed=0
  local keep

  log_info "Scanning recursively for 0-byte files and empty folders..."
  progress_draw "Step 5 Phase" "$phase" "$phase_total" "line"

  # Fast early exit before building full file/dir lists.
  first_zero=""
  first_empty=""
  pre_zero_tmp="$(mktemp)"
  pre_empty_tmp="$(mktemp)"
  if ! run_with_spinner "Step 5: quick-checking zero-byte files" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print -quit > "$2"' _ "$bucket_root" "$pre_zero_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 5 pre-check failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 5: quick-checking empty folders" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print -quit > "$2"' _ "$bucket_root" "$pre_empty_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 5 pre-check failed (empty folder scan)."
    exit 1
  fi
  first_zero="$(cat "$pre_zero_tmp" 2>/dev/null || true)"
  first_empty="$(cat "$pre_empty_tmp" 2>/dev/null || true)"
  rm -f "$pre_zero_tmp" "$pre_empty_tmp"
  phase=$((phase + 1))
  progress_draw "Step 5 Phase" "$phase" "$phase_total" "line"
  if [[ -z "$first_zero" && -z "$first_empty" ]]; then
    log_info "No 0-byte files or empty folders found. Nothing to move."
    return 0
  fi

  list_zero_tmp="$(mktemp)"
  list_empty_tmp="$(mktemp)"
  if ! run_with_spinner "Step 5: scanning zero-byte files recursively" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print0 > "$2"' _ "$bucket_root" "$list_zero_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 5 scan failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 5: scanning empty folders recursively" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print0 > "$2"' _ "$bucket_root" "$list_empty_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 5 scan failed (empty folder scan)."
    exit 1
  fi
  while IFS= read -r -d '' file; do
    zero_files+=("$file")
    zero_file_count=$((zero_file_count + 1))
  done < "$list_zero_tmp"

  while IFS= read -r -d '' dir; do
    empty_dirs+=("$dir")
    empty_dir_count=$((empty_dir_count + 1))
  done < "$list_empty_tmp"
  rm -f "$list_zero_tmp" "$list_empty_tmp"
  phase=$((phase + 1))
  progress_draw "Step 5 Phase" "$phase" "$phase_total" "line"

  # Keep only top-most empty directories so nested empties are moved with parents.
  if [[ "$empty_dir_count" -gt 0 ]]; then
    progress=0
  fi
  for ((i=0; i<empty_dir_count; i++)); do
    dir="${empty_dirs[$i]}"
    keep=1
    for ((j=0; j<empty_dir_count; j++)); do
      parent="${empty_dirs[$j]}"
      if [[ "$dir" == "$parent" ]]; then
        continue
      fi
      case "$dir" in
        "$parent"/*)
          keep=0
          break
          ;;
      esac
    done
    if [[ "$keep" -eq 1 && "$dir" != "$bucket_root" && "$dir" != "$bucket_root/"* ]]; then
      selected_empty_dirs+=("$dir")
      selected_dir_count=$((selected_dir_count + 1))
    fi
    progress=$((progress + 1))
    progress_draw "Step 5: filtering empty dirs" "$progress" "$empty_dir_count"
  done
  phase=$((phase + 1))
  progress_draw "Step 5 Phase" "$phase" "$phase_total" "line"

  total=$(( zero_file_count + selected_dir_count ))
  log_info "Moving ${zero_file_count} zero-byte file(s) and ${selected_dir_count} empty folder(s)."
  log_info "Bucket folder: ${bucket_root}"
  mkdir -p "$bucket_root/zero_size_files" "$bucket_root/empty_folders"

  progress=0
  for ((i=0; i<zero_file_count; i++)); do
    file="${zero_files[$i]}"
    if move_item_into_bucket "$file" "$bucket_root" "zero_size_files"; then
      moved_files=$((moved_files + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to move file: $file"
    fi
    progress=$((progress + 1))
    progress_draw "Step 5 Empty Items" "$progress" "$total"
  done

  for ((i=0; i<selected_dir_count; i++)); do
    dir="${selected_empty_dirs[$i]}"
    if [[ ! -d "$dir" ]]; then
      # Might have become non-existent after parent move; count as moved.
      moved_dirs=$((moved_dirs + 1))
      progress=$((progress + 1))
      progress_draw "Step 5 Empty Items" "$progress" "$total"
      continue
    fi
    if move_item_into_bucket "$dir" "$bucket_root" "empty_folders"; then
      moved_dirs=$((moved_dirs + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to move folder: $dir"
    fi
    progress=$((progress + 1))
    progress_draw "Step 5 Empty Items" "$progress" "$total"
  done

  log_info "Empty item move summary:"
  printf "  - Zero-byte files moved: %d\n" "$moved_files"
  printf "  - Empty folders moved:   %d\n" "$moved_dirs"
  printf "  - Failed:                %d\n" "$failed"
  printf "  - Bucket:                %s\n" "$bucket_root"
  phase=$((phase + 1))
  progress_draw "Step 5 Phase" "$phase" "$phase_total" "line"
}

trim_trailing_spaces() {
  local value="$1"
  while [[ "$value" == *" " ]]; do
    value="${value% }"
  done
  printf "%s" "$value"
}

step6_trim_trailing_spaces() {
  local paths=()
  local path parent base trimmed target
  local i total progress=0
  local renamed=0 failed=0

  while IFS= read -r -d '' path; do
    paths+=("$path")
  done < <(find . -depth -mindepth 1 -name "* " -print0)

  total=${#paths[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No files or folders end with a trailing space."
    return 0
  fi

  log_info "Found $total file/folder name(s) ending with a trailing space."
  for ((i=0; i<total; i++)); do
    path="${paths[$i]}"
    parent="${path%/*}"
    base="${path##*/}"
    trimmed="$(trim_trailing_spaces "$base")"
    target="${parent}/${trimmed}"

    if [[ -z "$trimmed" ]]; then
      failed=$((failed + 1))
      log_err "Rename skipped (name would become empty): $path"
      progress=$((progress + 1))
      progress_draw "Step 6 Rename" "$progress" "$total"
      continue
    fi

    if [[ -e "$target" ]]; then
      failed=$((failed + 1))
      log_err "Rename skipped (target exists): $path -> $target"
      progress=$((progress + 1))
      progress_draw "Step 6 Rename" "$progress" "$total"
      continue
    fi

    if mv "$path" "$target"; then
      renamed=$((renamed + 1))
    else
      failed=$((failed + 1))
      log_err "Rename failed: $path"
    fi

    progress=$((progress + 1))
    progress_draw "Step 6 Rename" "$progress" "$total"
  done

  log_info "Trailing-space trim summary:"
  printf "  - Renamed: %d\n" "$renamed"
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
  echo "5. $(step_description 5)"
  echo "6. $(step_description 6)"
  read -r -p "> " input
  input="${input// /}"

  if [[ "$input" == "0" ]]; then
    selected=(1 2 3 4 5 6)
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
    if [[ "$num" -ge 1 && "$num" -le 6 ]]; then
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
