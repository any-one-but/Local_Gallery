#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="1.8.6"
MAX_MEDIA_HEIGHT=3200
PROGRESS_BAR_WIDTH=32
PROGRESS_BAR_MIN_WIDTH=4
EMPTY_ITEMS_BUCKET_NAME="_clean_empty_items"
SIMILAR_ITEMS_BUCKET_NAME="_clean_similar_media"
WAIFU2X_INSTALL_DIR="${HOME}/.local/share/local_gallery/waifu2x-ncnn-vulkan"
WAIFU2X_RELEASE_URL_MACOS="https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/20250915/waifu2x-ncnn-vulkan-20250915-macos.zip"
WAIFU2X_SCALE=2
WAIFU2X_NOISE=3
STEP3_MEDIA_MODE="images"
STEP3_CPU_FALLBACK=1
STEP8_TRIM_SECONDS=10
STEP9_TRIM_END_SECONDS=10
STEP_ORDER=(1 2 3 4 5 6 7 8 9 10 11)

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

UI_STATUS_ACTIVE=0

ui_clear_status_line() {
  if [[ -t 1 && "${UI_STATUS_ACTIVE:-0}" -eq 1 ]]; then
    printf "\r\033[2K"
    UI_STATUS_ACTIVE=0
  fi
}

log_info() { ui_clear_status_line; printf "%s[INFO]%s %s\n" "$C_BLUE" "$C_RESET" "$*"; }
log_ok() { ui_clear_status_line; printf "%s[OK]%s   %s\n" "$C_GREEN" "$C_RESET" "$*"; }
log_warn() { ui_clear_status_line; printf "%s[WARN]%s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
log_err() { ui_clear_status_line; printf "%s[ERR]%s  %s\n" "$C_RED" "$C_RESET" "$*" >&2; }

print_divider() { ui_clear_status_line; printf "%s\n" "------------------------------------------------------------"; }

phase_note() {
  local current="$1"
  local total="$2"
  local label="$3"
  ui_clear_status_line
  printf "%s[%d/%d]%s %s\n" "$C_DIM" "$current" "$total" "$C_RESET" "$label"
}

summary_item() {
  local label="$1"
  local value="$2"
  ui_clear_status_line
  printf "  %-24s %s\n" "${label}:" "$value"
}

progress_draw() {
  local label="$1"
  local current="${2:-0}"
  local total="${3:-1}"
  local mode="${4:-inline}"
  local pct filled empty term_cols suffix label_plain line_budget
  local bar_width="$PROGRESS_BAR_WIDTH"
  local bar_filled bar_empty

  if ! is_int "$current"; then current=0; fi
  if ! is_int "$total" || [[ "$total" -le 0 ]]; then total=1; fi
  [[ "$current" -lt 0 ]] && current=0
  [[ "$current" -gt "$total" ]] && current="$total"

  pct=$(( current * 100 / total ))
  suffix=$(printf " %3d%% (%d/%d)" "$pct" "$current" "$total")
  label_plain="${label} "
  term_cols="${COLUMNS:-}"
  if [[ -t 1 && "$mode" != "line" ]]; then
    if ! is_int "$term_cols" || [[ "$term_cols" -le 0 ]]; then
      term_cols="$(tput cols 2>/dev/null || printf "80")"
    fi
    if ! is_int "$term_cols" || [[ "$term_cols" -le 0 ]]; then term_cols=80; fi
    line_budget=$(( term_cols - ${#label_plain} - 2 - ${#suffix} ))
    if [[ "$line_budget" -lt "$bar_width" ]]; then bar_width="$line_budget"; fi
    if [[ "$bar_width" -lt "$PROGRESS_BAR_MIN_WIDTH" ]]; then bar_width="$PROGRESS_BAR_MIN_WIDTH"; fi
  fi
  filled=$(( pct * bar_width / 100 ))
  empty=$(( bar_width - filled ))
  bar_filled=$(printf "%${filled}s" "" | tr ' ' '#')
  bar_empty=$(printf "%${empty}s" "" | tr ' ' '-')

  if [[ -t 1 && "$mode" != "line" ]]; then
    printf "\r\033[2K%s%s%s [%s%s]%s" "$C_DIM" "$label" "$C_RESET" "$bar_filled" "$bar_empty" "$suffix"
    UI_STATUS_ACTIVE=1
    if [[ "$current" -ge "$total" ]]; then
      printf "\n"
      UI_STATUS_ACTIVE=0
    fi
  else
    ui_clear_status_line
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
    printf "\r\033[2K%s%s%s %s" "$C_DIM" "$label" "$C_RESET" "$mark"
    UI_STATUS_ACTIVE=1
    i=$((i + 1))
    sleep 0.12
  done
  wait "$pid"
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    printf "\r\033[2K%s%s%s done\n" "$C_DIM" "$label" "$C_RESET"
  else
    printf "\r\033[2K%s%s%s failed\n" "$C_DIM" "$label" "$C_RESET"
  fi
  UI_STATUS_ACTIVE=0
  return "$rc"
}

is_int() {
  case "${1:-}" in
    ""|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_number() {
  [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  log_err "Required command not found: $cmd"
  return 1
}

load_homebrew_env() {
  if command -v brew >/dev/null 2>&1; then
    eval "$(brew shellenv 2>/dev/null)" || true
    return 0
  fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
    return 0
  fi
  if [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" || true
    return 0
  fi
  return 1
}

find_czkawka_command() {
  if command -v czkawka >/dev/null 2>&1; then
    printf "czkawka"
    return 0
  fi
  if command -v czkawka_cli >/dev/null 2>&1; then
    printf "czkawka_cli"
    return 0
  fi
  if command -v czkawka-cli >/dev/null 2>&1; then
    printf "czkawka-cli"
    return 0
  fi
  return 1
}

find_waifu2x_command() {
  if [[ -x "${WAIFU2X_INSTALL_DIR}/waifu2x-ncnn-vulkan" ]]; then
    printf "%s/waifu2x-ncnn-vulkan" "${WAIFU2X_INSTALL_DIR}"
    return 0
  fi
  if [[ -x "${HOME}/.local/bin/waifu2x-ncnn-vulkan" ]]; then
    printf "%s/.local/bin/waifu2x-ncnn-vulkan" "${HOME}"
    return 0
  fi
  if command -v waifu2x-ncnn-vulkan >/dev/null 2>&1; then
    command -v waifu2x-ncnn-vulkan
    return 0
  fi
  return 1
}

find_waifu2x_model_dir() {
  local bin_path="${1:-}"
  local bin_dir
  if [[ -n "${WAIFU2X_MODEL_PATH:-}" && -d "${WAIFU2X_MODEL_PATH}" ]]; then
    printf "%s" "${WAIFU2X_MODEL_PATH}"
    return 0
  fi
  if [[ -n "$bin_path" ]]; then
    bin_dir="$(dirname "$bin_path")"
    if [[ -d "$bin_dir/models-cunet" ]]; then
      printf "%s/models-cunet" "$bin_dir"
      return 0
    fi
  fi
  if [[ -d "${WAIFU2X_INSTALL_DIR}/models-cunet" ]]; then
    printf "%s/models-cunet" "${WAIFU2X_INSTALL_DIR}"
    return 0
  fi
  return 1
}

resolve_waifu2x_release_url() {
  local api_url="https://api.github.com/repos/nihui/waifu2x-ncnn-vulkan/releases/latest"
  local detected
  detected="$(curl -fsSL "$api_url" 2>/dev/null | awk -F'"' '/"browser_download_url":/ && /waifu2x-ncnn-vulkan-.*-macos.zip/ { print $4; exit }')"
  if [[ -n "$detected" ]]; then
    printf "%s" "$detected"
    return 0
  fi
  printf "%s" "$WAIFU2X_RELEASE_URL_MACOS"
}

install_waifu2x_ncnn_vulkan() {
  local os_name
  local tmpdir zip_path unpack_dir stage_dir
  local release_url bin_src
  local link_dir link_path
  local models_src_dir

  os_name="$(uname -s 2>/dev/null || printf "")"
  if [[ "$os_name" != "Darwin" ]]; then
    log_err "Automatic waifu2x install is currently implemented for macOS only."
    return 1
  fi

  require_cmd curl || return 1
  require_cmd unzip || return 1
  require_cmd chmod || return 1

  release_url="$(resolve_waifu2x_release_url)"
  tmpdir="$(mktemp -d)"
  zip_path="${tmpdir}/waifu2x.zip"
  unpack_dir="${tmpdir}/unpack"
  stage_dir="${tmpdir}/stage"
  mkdir -p "$unpack_dir" "$stage_dir"

  log_info "Downloading waifu2x ncnn package..."
  if ! curl -fsSL "$release_url" -o "$zip_path"; then
    rm -rf "$tmpdir"
    log_err "Failed to download waifu2x package."
    return 1
  fi

  log_info "Extracting waifu2x package..."
  if ! unzip -q "$zip_path" -d "$unpack_dir"; then
    rm -rf "$tmpdir"
    log_err "Failed to extract waifu2x package."
    return 1
  fi

  bin_src="$(find "$unpack_dir" -type f -name 'waifu2x-ncnn-vulkan' | head -n 1)"
  models_src_dir="$(find "$unpack_dir" -type d -name 'models-cunet' | head -n 1)"
  if [[ -z "$bin_src" || -z "$models_src_dir" ]]; then
    rm -rf "$tmpdir"
    log_err "waifu2x package did not contain expected files."
    return 1
  fi

  cp "$bin_src" "${stage_dir}/waifu2x-ncnn-vulkan"
  chmod +x "${stage_dir}/waifu2x-ncnn-vulkan"
  while IFS= read -r -d '' model_dir; do
    cp -R "$model_dir" "${stage_dir}/"
  done < <(find "$unpack_dir" -maxdepth 3 -type d -name 'models*' -print0)

  rm -rf "${WAIFU2X_INSTALL_DIR}"
  mkdir -p "$(dirname "${WAIFU2X_INSTALL_DIR}")"
  mv "$stage_dir" "${WAIFU2X_INSTALL_DIR}"

  link_dir="${HOME}/.local/bin"
  link_path="${link_dir}/waifu2x-ncnn-vulkan"
  mkdir -p "$link_dir"
  rm -f "$link_path"
  ln -s "${WAIFU2X_INSTALL_DIR}/waifu2x-ncnn-vulkan" "$link_path" || true

  rm -rf "$tmpdir"
  log_ok "Installed waifu2x to ${WAIFU2X_INSTALL_DIR}"
  return 0
}

ensure_waifu2x_ready() {
  local ans
  local waifu2x_cmd

  if waifu2x_cmd="$(find_waifu2x_command 2>/dev/null)" && find_waifu2x_model_dir "$waifu2x_cmd" >/dev/null 2>&1; then
    return 0
  fi

  print_divider
  echo "Step 8 requires waifu2x-ncnn-vulkan and its model files."
  read -r -p "Install or refresh waifu2x now? [Y/n] " ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log_err "Cannot run step 8 without waifu2x."
    return 1
  fi

  install_waifu2x_ncnn_vulkan || return 1
  if ! waifu2x_cmd="$(find_waifu2x_command 2>/dev/null)" || ! find_waifu2x_model_dir "$waifu2x_cmd" >/dev/null 2>&1; then
    log_err "waifu2x installation did not complete successfully."
    return 1
  fi
  return 0
}

ensure_prerequisites() {
  local missing_labels=()
  local missing_formulas=()
  local label formula ans
  local brew_installed=1
  local czkawka_cmd

  load_homebrew_env || true
  if ! command -v brew >/dev/null 2>&1; then
    brew_installed=0
    missing_labels+=("Homebrew")
  fi
  if ! command -v fdupes >/dev/null 2>&1; then
    missing_labels+=("fdupes")
    missing_formulas+=("fdupes")
  fi
  if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
    missing_labels+=("ffmpeg (includes ffprobe)")
    missing_formulas+=("ffmpeg")
  fi
  if ! command -v mat2 >/dev/null 2>&1; then
    missing_labels+=("mat2")
    missing_formulas+=("mat2")
  fi
  if ! czkawka_cmd="$(find_czkawka_command 2>/dev/null)"; then
    missing_labels+=("czkawka")
    missing_formulas+=("czkawka")
  fi

  if [[ "${#missing_labels[@]}" -eq 0 ]]; then
    log_ok "All prerequisite tools are installed."
    return 0
  fi

  print_divider
  echo "Missing prerequisites detected:"
  for label in "${missing_labels[@]+"${missing_labels[@]}"}"; do
    printf "  - %s\n" "$label"
  done
  read -r -p "Install missing prerequisites now? [Y/n] " ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log_err "Cannot continue without installing prerequisites."
    exit 1
  fi

  if [[ "$brew_installed" -eq 0 ]]; then
    log_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    load_homebrew_env || true
    if ! command -v brew >/dev/null 2>&1; then
      log_err "Homebrew installation appears incomplete. Please install Homebrew and re-run."
      exit 1
    fi
  fi

  for formula in "${missing_formulas[@]+"${missing_formulas[@]}"}"; do
    if brew list --formula "$formula" >/dev/null 2>&1; then
      log_info "Formula already installed: $formula"
      continue
    fi
    log_info "Installing $formula via Homebrew..."
    brew install "$formula"
  done

  load_homebrew_env || true
  if ! command -v fdupes >/dev/null 2>&1 || \
     ! command -v ffmpeg >/dev/null 2>&1 || \
     ! command -v ffprobe >/dev/null 2>&1 || \
     ! command -v mat2 >/dev/null 2>&1 || \
     ! find_czkawka_command >/dev/null 2>&1; then
    log_err "One or more prerequisites are still missing after install."
    exit 1
  fi

  log_ok "Prerequisites ready."
}

step_description() {
  case "${1:-}" in
    1) printf "Dedupe files" ;;
    2) printf "Move lower-quality similar media" ;;
    3) printf "Convert videos to MP4" ;;
    4) printf "Resize oversized media" ;;
    5) printf "Remove metadata" ;;
    6) printf "Sanitize file and folder names" ;;
    7) printf "Quarantine empty files and folders" ;;
    8) printf "Upscale and denoise media" ;;
    9) printf "Trim video starts" ;;
    10) printf "Trim video ends" ;;
    11) printf "Extract MP3 audio from videos" ;;
    *) printf "Unknown step" ;;
  esac
}

step_function_name() {
  case "${1:-}" in
    1) printf "step1_dedupe" ;;
    2) printf "step6_move_similar_media" ;;
    3) printf "step2_convert_videos" ;;
    4) printf "step4_resize_media" ;;
    5) printf "step5_remove_metadata" ;;
    6) printf "step7_sanitize_names" ;;
    7) printf "step9_move_empty_items" ;;
    8) printf "step3_process_media" ;;
    9) printf "step8_trim_video_lead" ;;
    10) printf "step9_trim_video_tail" ;;
    11) printf "step10_extract_video_audio_mp3" ;;
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
      require_cmd find
      require_cmd grep
      require_cmd mv
      require_cmd mkdir
      require_cmd sips
      require_cmd ffprobe
      find_czkawka_command >/dev/null 2>&1 || {
        log_err "Required command not found: czkawka (or czkawka_cli)"
        return 1
      }
      ;;
    3)
      require_cmd ffmpeg
      ;;
    4)
      require_cmd sips
      require_cmd ffprobe
      require_cmd ffmpeg
      ;;
    5)
      require_cmd mat2
      ;;
    6)
      require_cmd find
      require_cmd mv
      ;;
    7)
      require_cmd find
      require_cmd mv
      require_cmd mkdir
      ;;
    8)
      require_cmd find
      require_cmd sips
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      ensure_waifu2x_ready || return 1
      ;;
    9)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      ;;
    10)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      ;;
    11)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
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
  printf "%sStep %s%s  %s\n" "$C_BOLD" "$step_num" "$C_RESET" "$desc"
  start_ts=$(date +%s)
  "$fn"
  end_ts=$(date +%s)
  elapsed=$(( end_ts - start_ts ))
  log_ok "Step $step_num finished in ${elapsed}s"
}

step1_dedupe() {
  local phase_total=3 phase=0
  local count_tmp dedupe_log
  local file_count

  log_info "Scanning for duplicate files with fdupes."
  count_tmp="$(mktemp)"
  if ! run_with_spinner "Step 1: counting files recursively" bash -c 'find . -type f | wc -l | tr -d " " > "$1"' _ "$count_tmp"; then
    rm -f "$count_tmp"
    log_err "Unable to count files for dedupe step."
    exit 1
  fi
  file_count="$(cat "$count_tmp" 2>/dev/null || printf "0")"
  rm -f "$count_tmp"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Indexed ${file_count:-0} file(s)."
  dedupe_log="$(mktemp)"
  if ! run_with_spinner "Step 1: running fdupes dedupe pass" bash -c 'fdupes -r -A -d -N . > "$1" 2>&1' _ "$dedupe_log"; then
    phase=$((phase + 1))
    phase_note "$phase" "$phase_total" "Dedupe pass stopped with an error."
    log_err "fdupes failed. Last output:"
    tail -n 20 "$dedupe_log" >&2 || true
    rm -f "$dedupe_log"
    exit 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Dedupe pass complete."
  if [[ -s "$dedupe_log" ]]; then
    log_info "fdupes reported duplicate sets and removals."
  else
    log_info "No duplicate groups were reported."
  fi
  rm -f "$dedupe_log"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Dedupe finished."
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
      progress_draw "Step 3 Convert" "$progress" "$total"
      continue
    fi

    if ffmpeg -hide_banner -loglevel error -i "$file" -c copy -map 0 -movflags +faststart "$output"; then
      rm -f "$file"
      copied=$((copied + 1))
      progress=$((progress + 1))
      progress_draw "Step 3 Convert" "$progress" "$total"
      continue
    fi

    if ffmpeg -hide_banner -loglevel error -i "$file" -map 0 -c:v libx264 -crf 23 -preset medium -c:a aac -movflags +faststart "$output"; then
      rm -f "$file"
      reencoded=$((reencoded + 1))
      progress=$((progress + 1))
      progress_draw "Step 3 Convert" "$progress" "$total"
      continue
    fi

    rm -f "$output" 2>/dev/null || true
    failed=$((failed + 1))
    log_err "Conversion failed: $file"
    progress=$((progress + 1))
    progress_draw "Step 3 Convert" "$progress" "$total"
  done

  log_info "Step 3 conversion summary:"
  summary_item "Stream copied" "$copied"
  summary_item "Re-encoded" "$reencoded"
  summary_item "Skipped" "$skipped"
  summary_item "Failed" "$failed"
}

step10_extract_video_audio_mp3() {
  local files=()
  local file output tmp audio_stream
  local i total progress=0
  local created=0 skipped_existing=0 skipped_no_audio=0 failed=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" \
                      -o -iname "*.avi" -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.mpg" -o -iname "*.mpeg" \
                      -o -iname "*.3gp" -o -iname "*.m2ts" -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No video files found for mp3 extraction."
    return 0
  fi

  log_info "Creating mp3 files from $total video file(s)."

  for (( i=0; i<total; i++ )); do
    file="${files[$i]}"
    output="${file%.*}.mp3"

    if [[ -f "$output" ]]; then
      skipped_existing=$((skipped_existing + 1))
      progress=$((progress + 1))
      progress_draw "Step 11 MP3" "$progress" "$total"
      continue
    fi

    audio_stream="$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$file" 2>/dev/null | head -n 1)"
    if [[ -z "$audio_stream" ]]; then
      skipped_no_audio=$((skipped_no_audio + 1))
      progress=$((progress + 1))
      progress_draw "Step 11 MP3" "$progress" "$total"
      continue
    fi

    tmp="${output%.mp3}.tmp.$$.mp3"
    rm -f "$tmp"

    if ffmpeg -hide_banner -loglevel error -y -i "$file" -map 0:a:0 -map_metadata 0 -vn -c:a libmp3lame -q:a 2 "$tmp" && [[ -s "$tmp" ]]; then
      mv -f "$tmp" "$output"
      created=$((created + 1))
    else
      rm -f "$tmp" 2>/dev/null || true
      failed=$((failed + 1))
      log_err "MP3 extraction failed: $file"
    fi

    progress=$((progress + 1))
    progress_draw "Step 11 MP3" "$progress" "$total"
  done

  log_info "Step 11 audio extraction summary:"
  summary_item "MP3 files created" "$created"
  summary_item "Skipped (exists)" "$skipped_existing"
  summary_item "Skipped (no audio)" "$skipped_no_audio"
  summary_item "Failed" "$failed"
}

is_waifu2x_supported_image_ext() {
  local ext
  ext="$(printf "%s" "${1##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    jpg|jpeg|png|webp)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

step3_probe_image_dimensions() {
  local path="$1"
  local out width height

  out="$(sips -g pixelWidth -g pixelHeight "$path" 2>/dev/null || true)"
  width="$(printf "%s\n" "$out" | awk '/pixelWidth:/ {print $2; exit}')"
  height="$(printf "%s\n" "$out" | awk '/pixelHeight:/ {print $2; exit}')"
  if ! is_int "$width"; then width=0; fi
  if ! is_int "$height"; then height=0; fi
  printf "%s|%s" "$width" "$height"
}

step3_probe_image_luma_metrics() {
  local path="$1"
  local stats yavg yhigh

  stats="$(ffmpeg -hide_banner -loglevel error -i "$path" -vf signalstats,metadata=print:file=- -frames:v 1 -f null - 2>/dev/null || true)"
  yavg="$(printf "%s\n" "$stats" | awk -F= '/lavfi.signalstats.YAVG=/{print $2; exit}')"
  yhigh="$(printf "%s\n" "$stats" | awk -F= '/lavfi.signalstats.YHIGH=/{print $2; exit}')"
  if ! is_number "$yavg"; then yavg=999; fi
  if ! is_number "$yhigh"; then yhigh=999; fi
  printf "%s|%s" "$yavg" "$yhigh"
}

step3_validate_output_image() {
  local src="$1"
  local out="$2"
  local src_dims out_dims metrics
  local src_w src_h out_w out_h
  local src_px out_px
  local yavg yhigh

  src_dims="$(step3_probe_image_dimensions "$src")"
  out_dims="$(step3_probe_image_dimensions "$out")"
  IFS='|' read -r src_w src_h <<< "$src_dims"
  IFS='|' read -r out_w out_h <<< "$out_dims"
  if ! is_int "$src_w" || ! is_int "$src_h" || ! is_int "$out_w" || ! is_int "$out_h"; then
    return 1
  fi
  if [[ "$src_w" -le 0 || "$src_h" -le 0 || "$out_w" -le 0 || "$out_h" -le 0 ]]; then
    return 1
  fi

  src_px=$(( src_w * src_h ))
  out_px=$(( out_w * out_h ))
  if [[ "$out_px" -lt "$src_px" ]]; then
    return 1
  fi

  metrics="$(step3_probe_image_luma_metrics "$out")"
  IFS='|' read -r yavg yhigh <<< "$metrics"
  if awk -v avg="$yavg" -v hi="$yhigh" 'BEGIN { exit !(avg <= 1.0 && hi <= 4.0) }'; then
    return 1
  fi

  return 0
}

step3_run_waifu2x_image_attempt() {
  local file="$1"
  local tmp="$2"
  local waifu2x_cmd="$3"
  local model_dir="$4"
  local format="$5"
  local tile="$6"
  local device="${7:-auto}"

  rm -f "$tmp"
  if [[ "$device" == "cpu" ]]; then
    "$waifu2x_cmd" -i "$file" -o "$tmp" -m "$model_dir" -n "$WAIFU2X_NOISE" -s "$WAIFU2X_SCALE" -t "$tile" -g -1 -f "$format" >/dev/null 2>&1
  else
    "$waifu2x_cmd" -i "$file" -o "$tmp" -m "$model_dir" -n "$WAIFU2X_NOISE" -s "$WAIFU2X_SCALE" -t "$tile" -f "$format" >/dev/null 2>&1
  fi
}

step3_run_waifu2x_dir_attempt() {
  local input_dir="$1"
  local output_dir="$2"
  local waifu2x_cmd="$3"
  local model_dir="$4"
  local tile="$5"
  local device="${6:-auto}"

  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  if [[ "$device" == "cpu" ]]; then
    "$waifu2x_cmd" -i "$input_dir" -o "$output_dir" -m "$model_dir" -n "$WAIFU2X_NOISE" -s "$WAIFU2X_SCALE" -t "$tile" -g -1 -f png >/dev/null 2>&1
  else
    "$waifu2x_cmd" -i "$input_dir" -o "$output_dir" -m "$model_dir" -n "$WAIFU2X_NOISE" -s "$WAIFU2X_SCALE" -t "$tile" -f png >/dev/null 2>&1
  fi
}

step3_process_image_file() {
  local file="$1"
  local waifu2x_cmd="$2"
  local model_dir="$3"
  local result_file="$4"
  local ext format base tmp
  local width height
  local tile upscale_ok tile_fallback=0
  local cpu_fallback_used=0 rejected_outputs=0

  ext="$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    jpg|jpeg) format="jpg" ;;
    png) format="png" ;;
    webp) format="webp" ;;
    *)
      printf "unsupported|0|0|0\n" > "$result_file"
      return 0
      ;;
  esac

  width="$(sips -g pixelWidth "$file" 2>/dev/null | awk '/pixelWidth:/ {print $2; exit}')"
  height="$(sips -g pixelHeight "$file" 2>/dev/null | awk '/pixelHeight:/ {print $2; exit}')"
  if ! is_int "$width" || ! is_int "$height" || [[ "$width" -le 0 || "$height" -le 0 ]]; then
    printf "probe_failed|0|0|0\n" > "$result_file"
    return 0
  fi

  base="${file%.*}"
  tmp="${base}.upscale-tmp.$$.$ext"
  upscale_ok=0
  for tile in 512 256 0; do
    if step3_run_waifu2x_image_attempt "$file" "$tmp" "$waifu2x_cmd" "$model_dir" "$format" "$tile" "auto" && [[ -s "$tmp" ]]; then
      if step3_validate_output_image "$file" "$tmp"; then
        upscale_ok=1
        if [[ "$tile" != "512" ]]; then
          tile_fallback=1
        fi
        break
      fi
      rejected_outputs=$((rejected_outputs + 1))
      rm -f "$tmp" 2>/dev/null || true
    fi
  done

  if [[ "$upscale_ok" -eq 0 && "$STEP3_CPU_FALLBACK" -eq 1 ]]; then
    for tile in 256 128 0; do
      if step3_run_waifu2x_image_attempt "$file" "$tmp" "$waifu2x_cmd" "$model_dir" "$format" "$tile" "cpu" && [[ -s "$tmp" ]]; then
        if step3_validate_output_image "$file" "$tmp"; then
          upscale_ok=1
          tile_fallback=1
          cpu_fallback_used=1
          break
        fi
        rejected_outputs=$((rejected_outputs + 1))
        rm -f "$tmp" 2>/dev/null || true
      fi
    done
  fi

  if [[ "$upscale_ok" -eq 1 && -s "$tmp" ]]; then
    mv -f "$tmp" "$file"
    printf "processed|%s|%s|%s\n" "$tile_fallback" "$cpu_fallback_used" "$rejected_outputs" > "$result_file"
  else
    rm -f "$tmp" 2>/dev/null || true
    printf "failed|0|%s|%s\n" "$cpu_fallback_used" "$rejected_outputs" > "$result_file"
  fi
  return 0
}

step3_probe_video_frame_rate() {
  local file="$1"
  local rate

  rate="$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=nokey=1:noprint_wrappers=1 "$file" 2>/dev/null | head -n 1)"
  case "$rate" in
    ""|0/0|N/A)
      rate="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=nokey=1:noprint_wrappers=1 "$file" 2>/dev/null | head -n 1)"
      ;;
  esac
  case "$rate" in
    ""|0/0|N/A) rate="30" ;;
  esac
  printf "%s" "$rate"
}

step3_process_video_file() {
  local file="$1"
  local waifu2x_cmd="$2"
  local model_dir="$3"
  local fps base final_output tmp_output workdir frames_dir upscaled_dir
  local name phase=0 phase_total=3
  local waifu2x_ok=0 cpu_fallback_used=0

  STEP3_LAST_VIDEO_CPU_FALLBACK=0

  fps="$(step3_probe_video_frame_rate "$file")"
  base="${file%.*}"
  final_output="${base}.mp4"
  tmp_output="${base}.upscale-tmp.$$.mp4"
  name="$(basename "$file")"
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_step3_video.XXXXXX")"
  frames_dir="${workdir}/frames"
  upscaled_dir="${workdir}/upscaled"
  mkdir -p "$frames_dir" "$upscaled_dir"

  if ! run_with_spinner "Extracting frames: ${name}" ffmpeg -hide_banner -loglevel error -y -i "$file" "${frames_dir}/frame_%06d.png"; then
    rm -rf "$workdir"
    return 1
  fi
  if [[ -z "$(find "$frames_dir" -type f -name 'frame_*.png' -print -quit 2>/dev/null)" ]]; then
    rm -rf "$workdir"
    return 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Frames extracted for ${name}."

  if run_with_spinner "Upscaling frames: ${name}" step3_run_waifu2x_dir_attempt "$frames_dir" "$upscaled_dir" "$waifu2x_cmd" "$model_dir" 512 "auto" && [[ -n "$(find "$upscaled_dir" -type f -name 'frame_*.png' -print -quit 2>/dev/null)" ]]; then
    waifu2x_ok=1
  elif [[ "$STEP3_CPU_FALLBACK" -eq 1 ]] && run_with_spinner "Upscaling frames (CPU): ${name}" step3_run_waifu2x_dir_attempt "$frames_dir" "$upscaled_dir" "$waifu2x_cmd" "$model_dir" 256 "cpu" && [[ -n "$(find "$upscaled_dir" -type f -name 'frame_*.png' -print -quit 2>/dev/null)" ]]; then
    waifu2x_ok=1
    cpu_fallback_used=1
    STEP3_LAST_VIDEO_CPU_FALLBACK=1
  fi
  if [[ "$waifu2x_ok" -ne 1 ]]; then
    rm -rf "$workdir"
    return 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Frames upscaled for ${name}."

  rm -f "$tmp_output"
  if ! run_with_spinner "Rebuilding video: ${name}" ffmpeg -hide_banner -loglevel error -y -framerate "$fps" -i "${upscaled_dir}/frame_%06d.png" -i "$file" -map 0:v:0 -map 1:a? -c:v libx264 -pix_fmt yuv420p -c:a copy -shortest "$tmp_output"; then
    rm -f "$tmp_output" 2>/dev/null || true
    if ! run_with_spinner "Rebuilding video (AAC): ${name}" ffmpeg -hide_banner -loglevel error -y -framerate "$fps" -i "${upscaled_dir}/frame_%06d.png" -i "$file" -map 0:v:0 -map 1:a? -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "$tmp_output"; then
      rm -f "$tmp_output" 2>/dev/null || true
      rm -rf "$workdir"
      return 1
    fi
  fi

  if [[ ! -s "$tmp_output" ]]; then
    rm -f "$tmp_output" 2>/dev/null || true
    rm -rf "$workdir"
    return 1
  fi

  if [[ "$file" != "$final_output" ]]; then
    rm -f "$file"
  fi
  mv -f "$tmp_output" "$final_output"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Video rebuilt for ${name}."
  rm -rf "$workdir"
  return 0
}

step3_upscale_images() {
  local files=() candidates=()
  local waifu2x_cmd model_dir
  local file result_file
  local i total progress=0
  local all_images=0
  local upscaled=0 skipped_unsupported=0 skipped_probe=0 failed=0
  local tile_fallback_used=0 cpu_fallback_used=0 rejected_outputs=0
  local status fallback cpu_used rejected

  if ! waifu2x_cmd="$(find_waifu2x_command)"; then
    log_err "waifu2x binary not found."
    exit 1
  fi
  if ! model_dir="$(find_waifu2x_model_dir "$waifu2x_cmd")"; then
    log_err "waifu2x models directory not found."
    exit 1
  fi

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \
                      -o -iname "*.gif" -o -iname "*.bmp" -o -iname "*.tif" -o -iname "*.tiff" \
                      -o -iname "*.heic" -o -iname "*.heif" -o -iname "*.avif" \) -print0
  )

  all_images=${#files[@]}
  if [[ "$all_images" -eq 0 ]]; then
    log_warn "No images found to evaluate for upscaling."
    return 0
  fi

  for ((i=0; i<all_images; i++)); do
    file="${files[$i]}"
    if is_waifu2x_supported_image_ext "$file"; then
      candidates+=("$file")
    else
      skipped_unsupported=$((skipped_unsupported + 1))
    fi
  done

  total=${#candidates[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No waifu2x-supported images found (.jpg/.jpeg/.png/.webp)."
    return 0
  fi

  log_info "Upscaling and denoising $total supported image(s) with waifu2x (scale=${WAIFU2X_SCALE}x, noise=${WAIFU2X_NOISE})."

  for ((i=0; i<total; i++)); do
    file="${candidates[$i]}"
    result_file="$(mktemp "${TMPDIR:-/tmp}/local_gallery_step3_img.XXXXXX")"
    step3_process_image_file "$file" "$waifu2x_cmd" "$model_dir" "$result_file"
    if [[ -f "$result_file" ]]; then
      IFS='|' read -r status fallback cpu_used rejected < "$result_file"
    else
      status="failed"
      fallback=0
      cpu_used=0
      rejected=0
    fi
    case "$status" in
      processed)
        upscaled=$((upscaled + 1))
        if [[ "$fallback" == "1" ]]; then
          tile_fallback_used=$((tile_fallback_used + 1))
        fi
        if [[ "$cpu_used" == "1" ]]; then
          cpu_fallback_used=$((cpu_fallback_used + 1))
        fi
        ;;
      probe_failed)
        skipped_probe=$((skipped_probe + 1))
        ;;
      unsupported)
        skipped_unsupported=$((skipped_unsupported + 1))
        ;;
      *)
        failed=$((failed + 1))
        if [[ "$cpu_used" == "1" ]]; then
          cpu_fallback_used=$((cpu_fallback_used + 1))
        fi
        log_err "Upscale failed: $file"
        ;;
    esac
    if is_int "$rejected"; then
      rejected_outputs=$((rejected_outputs + rejected))
    fi
    rm -f "$result_file"
    progress=$((progress + 1))
    progress_draw "Step 8 Upscale" "$progress" "$total"
  done

  log_info "Step 8 image upscale summary:"
  summary_item "Images found" "$all_images"
  summary_item "Supported candidates" "$total"
  summary_item "Processed" "$upscaled"
  summary_item "Skipped (unsupported)" "$skipped_unsupported"
  summary_item "Skipped (probe failed)" "$skipped_probe"
  summary_item "Rejected outputs" "$rejected_outputs"
  summary_item "Tile fallbacks" "$tile_fallback_used"
  summary_item "CPU fallbacks" "$cpu_fallback_used"
  summary_item "Failed" "$failed"
}

step3_upscale_videos() {
  local files=()
  local waifu2x_cmd model_dir
  local file
  local i total progress=0
  local processed=0 failed=0 cpu_fallback_used=0

  if ! waifu2x_cmd="$(find_waifu2x_command)"; then
    log_err "waifu2x binary not found."
    exit 1
  fi
  if ! model_dir="$(find_waifu2x_model_dir "$waifu2x_cmd")"; then
    log_err "waifu2x models directory not found."
    exit 1
  fi

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.mp4" -o -iname "*.m4v" -o -iname "*.mov" -o -iname "*.wmv" -o -iname "*.flv" \
                      -o -iname "*.avi" -o -iname "*.webm" -o -iname "*.mkv" -o -iname "*.mpg" -o -iname "*.mpeg" \
                      -o -iname "*.3gp" -o -iname "*.m2ts" -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No videos found to evaluate for upscaling."
    return 0
  fi

  log_info "Upscaling and denoising $total video file(s) with waifu2x (scale=${WAIFU2X_SCALE}x, noise=${WAIFU2X_NOISE})."
  log_info "Video mode rebuilds processed files as .mp4."

  for ((i=0; i<total; i++)); do
    file="${files[$i]}"
    log_info "Processing video $((i + 1))/$total: $(basename "$file")"
    if step3_process_video_file "$file" "$waifu2x_cmd" "$model_dir"; then
      processed=$((processed + 1))
      if [[ "${STEP3_LAST_VIDEO_CPU_FALLBACK:-0}" -eq 1 ]]; then
        cpu_fallback_used=$((cpu_fallback_used + 1))
      fi
    else
      failed=$((failed + 1))
      log_err "Video upscale failed: $file"
    fi
    progress=$((progress + 1))
    progress_draw "Step 8 Video" "$progress" "$total"
  done

  log_info "Step 8 video upscale summary:"
  summary_item "Videos found" "$total"
  summary_item "Processed" "$processed"
  summary_item "CPU fallbacks" "$cpu_fallback_used"
  summary_item "Failed" "$failed"
}

step3_process_media() {
  case "$STEP3_MEDIA_MODE" in
    videos)
      step3_upscale_videos
      ;;
    *)
      step3_upscale_images
      ;;
  esac
}

step4_resize_media() {
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
        progress_draw "Step 4 Resize" "$all_done" "$all_total"
        continue
      fi
      if [[ "$h" -le "$MAX_MEDIA_HEIGHT" ]]; then
        img_skipped=$((img_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 4 Resize" "$all_done" "$all_total"
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
      progress_draw "Step 4 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No images found to evaluate for resizing."
  fi

  total=${#videos[@]}
  if [[ "$all_done" -gt 0 ]]; then
    progress_draw "Step 4 Resize" "$all_done" "$all_total"
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
        progress_draw "Step 4 Resize" "$all_done" "$all_total"
        continue
      fi
      if [[ "$h" -le "$MAX_MEDIA_HEIGHT" ]]; then
        vid_skipped=$((vid_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 4 Resize" "$all_done" "$all_total"
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
          progress_draw "Step 4 Resize" "$all_done" "$all_total"
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
      progress_draw "Step 4 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No videos found to evaluate for resizing."
  fi

  log_info "Step 4 resize summary:"
  summary_item "Max height" "${MAX_MEDIA_HEIGHT}px"
  summary_item "Images resized" "$img_resized"
  summary_item "Images skipped" "$img_skipped"
  summary_item "Images failed" "$img_failed"
  summary_item "Videos resized" "$vid_resized"
  summary_item "Videos skipped" "$vid_skipped"
  summary_item "Videos failed" "$vid_failed"
}

step5_remove_metadata() {
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
    progress_draw "Step 5 Metadata" "$progress" "$total"
  done

  log_info "Step 5 metadata summary:"
  summary_item "Cleaned" "$cleaned"
  summary_item "Failed" "$failed"
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

step9_move_empty_items() {
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

  log_info "Scanning for 0-byte files and empty folders."
  # Fast early exit before building full file/dir lists.
  first_zero=""
  first_empty=""
  pre_zero_tmp="$(mktemp)"
  pre_empty_tmp="$(mktemp)"
  if ! run_with_spinner "Step 7: quick-checking zero-byte files" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print -quit > "$2"' _ "$bucket_root" "$pre_zero_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 7 pre-check failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 7: quick-checking empty folders" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print -quit > "$2"' _ "$bucket_root" "$pre_empty_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 7 pre-check failed (empty folder scan)."
    exit 1
  fi
  first_zero="$(cat "$pre_zero_tmp" 2>/dev/null || true)"
  first_empty="$(cat "$pre_empty_tmp" 2>/dev/null || true)"
  rm -f "$pre_zero_tmp" "$pre_empty_tmp"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Quick scan complete."
  if [[ -z "$first_zero" && -z "$first_empty" ]]; then
    log_info "No 0-byte files or empty folders found. Nothing to move."
    return 0
  fi

  list_zero_tmp="$(mktemp)"
  list_empty_tmp="$(mktemp)"
  if ! run_with_spinner "Step 7: scanning zero-byte files recursively" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print0 > "$2"' _ "$bucket_root" "$list_zero_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 7 scan failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 7: scanning empty folders recursively" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print0 > "$2"' _ "$bucket_root" "$list_empty_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 7 scan failed (empty folder scan)."
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
  phase_note "$phase" "$phase_total" "Full scan complete."

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
    progress_draw "Step 7 Filter" "$progress" "$empty_dir_count"
  done
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Top-level empty folders selected."

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
    progress_draw "Step 7 Empty items" "$progress" "$total"
  done

  for ((i=0; i<selected_dir_count; i++)); do
    dir="${selected_empty_dirs[$i]}"
    if [[ ! -d "$dir" ]]; then
      # Might have become non-existent after parent move; count as moved.
      moved_dirs=$((moved_dirs + 1))
      progress=$((progress + 1))
      progress_draw "Step 7 Empty items" "$progress" "$total"
      continue
    fi
    if move_item_into_bucket "$dir" "$bucket_root" "empty_folders"; then
      moved_dirs=$((moved_dirs + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to move folder: $dir"
    fi
    progress=$((progress + 1))
    progress_draw "Step 7 Empty items" "$progress" "$total"
  done

  log_info "Step 7 empty-item summary:"
  summary_item "Zero-byte files moved" "$moved_files"
  summary_item "Empty folders moved" "$moved_dirs"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Empty-item move finished."
}

sanitize_name_part() {
  local value="$1"
  # Remove disallowed characters (keep alnum, space, _, -)
  value="$(LC_ALL=C printf "%s" "$value" | tr -cd '[:alnum:] _-')"
  # Trim leading and trailing whitespace
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  # Collapse multiple spaces into one
  while [[ "$value" == *"  "* ]]; do
    value="${value//  / }"
  done
  printf "%s" "$value"
}

sanitize_fs_entry_name() {
  local name="$1"
  local stem ext sanitized_stem sanitized_ext sanitized_name

  if [[ -z "$name" || "$name" == "." || "$name" == ".." ]]; then
    printf "%s" "$name"
    return 0
  fi

  # Handle hidden files/directories (starting with .)
  if [[ "$name" == .* ]]; then
    local rest="${name#.}"

    # If it's something like .hidden (no additional dot) or .DS_Store style
    if [[ -z "$rest" || "$rest" != *.* ]]; then
      sanitized_name="$(sanitize_name_part "$rest")"
      if [[ -n "$sanitized_name" ]]; then
        printf ".%s" "$sanitized_name"
      else
        printf ""
      fi
      return 0
    fi
    # Otherwise fall through to normal stem/ext handling for names like .hidden.pic.jpg
  fi

  # Normal files with extension
  if [[ "$name" == *.* ]]; then
    stem="${name%.*}"
    ext="${name##*.}"
    sanitized_stem="$(sanitize_name_part "$stem")"
    sanitized_ext="$(sanitize_name_part "$ext")"

    if [[ -n "$sanitized_stem" && -n "$sanitized_ext" ]]; then
      printf "%s.%s" "$sanitized_stem" "$sanitized_ext"
      return 0
    fi
    if [[ -n "$sanitized_stem" ]]; then
      printf "%s" "$sanitized_stem"
      return 0
    fi
    if [[ -n "$sanitized_ext" ]]; then
      printf "%s" "$sanitized_ext"
      return 0
    fi
    printf ""
    return 0
  fi

  # No extension
  sanitized_name="$(sanitize_name_part "$name")"
  printf "%s" "$sanitized_name"
}

step7_sanitize_names() {
  local paths=()
  local path parent base sanitized target
  local i total progress=0
  local renamed=0 failed=0

  while IFS= read -r -d '' path; do
    base="${path##*/}"
    sanitized="$(sanitize_fs_entry_name "$base")"
    if [[ "$sanitized" != "$base" ]]; then
      paths+=("$path")
    fi
  done < <(find . -depth -mindepth 1 \
    \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \) -prune -o \
    \( -type f -o -type d \) -print0)

  # Explicitly sort paths by depth descending (deepest first) to safely rename nested directories
  if [[ ${#paths[@]} -gt 0 ]]; then
    IFS=$'\n'
    paths=( $(printf '%s\n' "${paths[@]}" | awk -F/ '{print (NF-1)"\t"$0}' | sort -k1,1nr -t$'\t' | cut -f2- ) )
    unset IFS
  fi

  total=${#paths[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No file or folder names need sanitizing."
    return 0
  fi

  log_info "Found $total file/folder name(s) that need sanitizing."
  for ((i=0; i<total; i++)); do
    path="${paths[$i]}"
    parent="${path%/*}"
    base="${path##*/}"
    sanitized="$(sanitize_fs_entry_name "$base")"
    target="${parent}/${sanitized}"

    if [[ -z "$sanitized" ]]; then
      failed=$((failed + 1))
      log_err "Rename skipped (name would become empty): $path"
      progress=$((progress + 1))
      progress_draw "Step 6 Sanitize" "$progress" "$total"
      continue
    fi

    if [[ -e "$target" ]]; then
      failed=$((failed + 1))
      log_err "Rename skipped (target exists): $path -> $target"
      progress=$((progress + 1))
      progress_draw "Step 6 Sanitize" "$progress" "$total"
      continue
    fi

    if mv "$path" "$target"; then
      renamed=$((renamed + 1))
    else
      failed=$((failed + 1))
      log_err "Rename failed: $path"
    fi

    progress=$((progress + 1))
    progress_draw "Step 6 Sanitize" "$progress" "$total"
  done

  log_info "Step 6 sanitization summary:"
  summary_item "Renamed" "$renamed"
  summary_item "Failed" "$failed"
}

append_unique_line() {
  local value="$1"
  local file="$2"
  [[ -z "$value" ]] && return 0
  if [[ -f "$file" ]] && grep -F -x -q -- "$value" "$file"; then
    return 0
  fi
  printf "%s\n" "$value" >> "$file"
}

is_image_media_ext() {
  local ext
  ext="$(printf "%s" "${1##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|heif|avif)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_video_media_ext() {
  local ext
  ext="$(printf "%s" "${1##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    mp4|m4v|mov|wmv|flv|avi|webm|mkv|mpg|mpeg|3gp|m2ts|vob|ogv|gifv)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_path_for_workdir() {
  local p="$1"
  if [[ -z "$p" ]]; then
    return 1
  fi
  if [[ "$p" == "$PWD/"* ]]; then
    printf "./%s" "${p#$PWD/}"
    return 0
  fi
  if [[ "$p" == ./* ]]; then
    printf "%s" "$p"
    return 0
  fi
  if [[ "$p" == /* ]]; then
    return 1
  fi
  printf "./%s" "$p"
  return 0
}

file_size_bytes() {
  local path="$1"
  local size
  size="$(stat -f %z "$path" 2>/dev/null || true)"
  if ! is_int "$size"; then
    size="$(stat -c %s "$path" 2>/dev/null || true)"
  fi
  if ! is_int "$size"; then size=0; fi
  printf "%s" "$size"
}

probe_image_quality_metrics() {
  local path="$1"
  local out width height px size
  out="$(sips -g pixelWidth -g pixelHeight "$path" 2>/dev/null || true)"
  width="$(printf "%s\n" "$out" | awk '/pixelWidth:/ {print $2; exit}')"
  height="$(printf "%s\n" "$out" | awk '/pixelHeight:/ {print $2; exit}')"
  if ! is_int "$width"; then width=0; fi
  if ! is_int "$height"; then height=0; fi
  px=$(( width * height ))
  size="$(file_size_bytes "$path")"
  printf "%s|%s" "$px" "$size"
}

probe_video_quality_metrics() {
  local path="$1"
  local probe width height stream_bitrate format_bitrate bitrate duration duration_ms px size
  probe="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,bit_rate -show_entries format=duration,bit_rate -of default=noprint_wrappers=1:nokey=0 "$path" 2>/dev/null || true)"
  width="$(printf "%s\n" "$probe" | awk -F= '/^width=/{print $2; exit}')"
  height="$(printf "%s\n" "$probe" | awk -F= '/^height=/{print $2; exit}')"
  stream_bitrate="$(printf "%s\n" "$probe" | awk -F= '/^bit_rate=/{print $2; exit}')"
  format_bitrate="$(printf "%s\n" "$probe" | awk -F= '/^bit_rate=/{v=$2} END{print v}')"
  duration="$(printf "%s\n" "$probe" | awk -F= '/^duration=/{print $2; exit}')"
  if ! is_int "$width"; then width=0; fi
  if ! is_int "$height"; then height=0; fi
  if is_int "$stream_bitrate" && [[ "$stream_bitrate" -gt 0 ]]; then
    bitrate="$stream_bitrate"
  elif is_int "$format_bitrate" && [[ "$format_bitrate" -gt 0 ]]; then
    bitrate="$format_bitrate"
  else
    bitrate=0
  fi
  duration_ms="$(awk -v d="$duration" 'BEGIN { if (d+0 > 0) printf "%.0f", d*1000; else print 0 }')"
  if ! is_int "$duration_ms"; then duration_ms=0; fi
  px=$(( width * height ))
  size="$(file_size_bytes "$path")"
  printf "%s|%s|%s|%s" "$px" "$bitrate" "$duration_ms" "$size"
}

finalize_similarity_group() {
  local kind="$1"
  local keep_file="$2"
  local move_file="$3"
  local n best_idx i better

  n=${#group_paths[@]}
  if [[ "$n" -le 1 ]]; then
    group_paths=()
    group_px=()
    group_size=()
    group_bitrate=()
    group_duration=()
    return 0
  fi

  groups_found=$((groups_found + 1))
  groups_entries=$((groups_entries + n))
  best_idx=0

  for ((i=1; i<n; i++)); do
    better=0
    if [[ "$kind" == "image" ]]; then
      if [[ "${group_px[$i]}" -gt "${group_px[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_size[$i]}" -gt "${group_size[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_size[$i]}" -eq "${group_size[$best_idx]}" && "${group_paths[$i]}" < "${group_paths[$best_idx]}" ]]; then
        better=1
      fi
    else
      if [[ "${group_px[$i]}" -gt "${group_px[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_bitrate[$i]}" -gt "${group_bitrate[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_bitrate[$i]}" -eq "${group_bitrate[$best_idx]}" && "${group_duration[$i]}" -gt "${group_duration[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_bitrate[$i]}" -eq "${group_bitrate[$best_idx]}" && "${group_duration[$i]}" -eq "${group_duration[$best_idx]}" && "${group_size[$i]}" -gt "${group_size[$best_idx]}" ]]; then
        better=1
      elif [[ "${group_px[$i]}" -eq "${group_px[$best_idx]}" && "${group_bitrate[$i]}" -eq "${group_bitrate[$best_idx]}" && "${group_duration[$i]}" -eq "${group_duration[$best_idx]}" && "${group_size[$i]}" -eq "${group_size[$best_idx]}" && "${group_paths[$i]}" < "${group_paths[$best_idx]}" ]]; then
        better=1
      fi
    fi

    if [[ "$better" -eq 1 ]]; then
      best_idx="$i"
    fi
  done

  append_unique_line "${group_paths[$best_idx]}" "$keep_file"
  keep_candidates=$((keep_candidates + 1))
  for ((i=0; i<n; i++)); do
    if [[ "$i" -eq "$best_idx" ]]; then
      continue
    fi
    append_unique_line "${group_paths[$i]}" "$move_file"
    move_candidates=$((move_candidates + 1))
  done

  group_paths=()
  group_px=()
  group_size=()
  group_bitrate=()
  group_duration=()
}

collect_similar_media_moves_from_report() {
  local kind="$1"
  local report_file="$2"
  local keep_file="$3"
  local move_file="$4"
  local line raw_path path metrics px size bitrate duration_ms
  local groups_found=0 groups_entries=0 keep_candidates=0 move_candidates=0
  local -a group_paths group_px group_size group_bitrate group_duration
  group_paths=()
  group_px=()
  group_size=()
  group_bitrate=()
  group_duration=()

  if [[ ! -f "$report_file" ]]; then
    printf "0|0|0|0"
    return 0
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$kind" == "image" && "$line" =~ ^Found[[:space:]][0-9]+[[:space:]]images[[:space:]]which[[:space:]]have[[:space:]]similar[[:space:]]friends ]]; then
      finalize_similarity_group "$kind" "$keep_file" "$move_file"
      continue
    fi
    if [[ "$kind" == "video" && "$line" =~ ^Found[[:space:]][0-9]+[[:space:]]videos[[:space:]]which[[:space:]]have[[:space:]]similar[[:space:]]friends ]]; then
      finalize_similarity_group "$kind" "$keep_file" "$move_file"
      continue
    fi
    if [[ "$line" =~ ^\"(.*)\"[[:space:]]-[[:space:]].*$ ]]; then
      raw_path="${BASH_REMATCH[1]}"
      if ! path="$(normalize_path_for_workdir "$raw_path")"; then
        continue
      fi
      if [[ ! -f "$path" ]]; then
        continue
      fi
      if [[ "$kind" == "image" ]]; then
        metrics="$(probe_image_quality_metrics "$path")"
        IFS='|' read -r px size <<< "$metrics"
        if ! is_int "$px"; then px=0; fi
        if ! is_int "$size"; then size=0; fi
        group_paths+=("$path")
        group_px+=("$px")
        group_size+=("$size")
        group_bitrate+=(0)
        group_duration+=(0)
      else
        metrics="$(probe_video_quality_metrics "$path")"
        IFS='|' read -r px bitrate duration_ms size <<< "$metrics"
        if ! is_int "$px"; then px=0; fi
        if ! is_int "$bitrate"; then bitrate=0; fi
        if ! is_int "$duration_ms"; then duration_ms=0; fi
        if ! is_int "$size"; then size=0; fi
        group_paths+=("$path")
        group_px+=("$px")
        group_size+=("$size")
        group_bitrate+=("$bitrate")
        group_duration+=("$duration_ms")
      fi
    fi
  done < "$report_file"

  finalize_similarity_group "$kind" "$keep_file" "$move_file"
  printf "%s|%s|%s|%s" "$groups_found" "$groups_entries" "$keep_candidates" "$move_candidates"
}

abs_path_from_rel() {
  local p="$1"
  if [[ "$p" == "/"* ]]; then
    printf "%s" "$p"
    return 0
  fi
  if [[ "$p" == "." || "$p" == "./" ]]; then
    printf "%s" "$PWD"
    return 0
  fi
  printf "%s/%s" "$PWD" "${p#./}"
}

rel_path_from_abs() {
  local p="$1"
  if [[ "$p" == "$PWD" ]]; then
    printf "."
    return 0
  fi
  if [[ "$p" == "$PWD/"* ]]; then
    printf "./%s" "${p#$PWD/}"
    return 0
  fi
  printf "%s" "$p"
}

prune_nested_group_dirs() {
  local group_line="$1"
  local tmp raw
  local -a dirs kept
  dirs=()
  kept=()
  local dir k skip

  tmp="$(mktemp)"
  printf "%s" "$group_line" | tr '|' '\n' | sed '/^$/d' | sort -u > "$tmp"
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    [[ "$dir" == "." || "$dir" == "./" ]] && continue
    dirs+=("$dir")
  done < "$tmp"
  rm -f "$tmp"

  for dir in "${dirs[@]+"${dirs[@]}"}"; do
    skip=0
    for k in "${kept[@]+"${kept[@]}"}"; do
      case "$dir" in
        "$k"|"${k}"/*)
          skip=1
          break
          ;;
      esac
    done
    if [[ "$skip" -eq 0 ]]; then
      kept+=("$dir")
    fi
  done

  if [[ "${#kept[@]}" -lt 2 ]]; then
    return 1
  fi

  raw="${kept[0]}"
  for ((k=1; k<${#kept[@]}; k++)); do
    raw="${raw}|${kept[$k]}"
  done
  printf "%s" "$raw"
}

group_lowest_common_parent() {
  local group_line="$1"
  local -a dirs
  local d abs lcp next
  dirs=()
  IFS='|' read -r -a dirs <<< "$group_line"
  if [[ "${#dirs[@]}" -eq 0 ]]; then
    return 1
  fi

  lcp="$(abs_path_from_rel "${dirs[0]}")"
  for d in "${dirs[@]+"${dirs[@]}"}"; do
    abs="$(abs_path_from_rel "$d")"
    while [[ "$abs" != "$lcp" && "$abs" != "$lcp/"* ]]; do
      next="$(dirname "$lcp")"
      if [[ "$next" == "$lcp" ]]; then
        break
      fi
      lcp="$next"
    done
  done
  rel_path_from_abs "$lcp"
}

group_combined_folder_name() {
  local group_line="$1"
  local -a dirs names
  local d b out i
  dirs=()
  names=()
  IFS='|' read -r -a dirs <<< "$group_line"
  if [[ "${#dirs[@]}" -lt 2 ]]; then
    return 1
  fi
  for d in "${dirs[@]+"${dirs[@]}"}"; do
    b="$(basename "$d")"
    [[ -z "$b" || "$b" == "." ]] && continue
    names+=("$b")
  done
  if [[ "${#names[@]}" -lt 2 ]]; then
    return 1
  fi
  out="${names[0]}"
  for ((i=1; i<${#names[@]}; i++)); do
    out="${out}+${names[$i]}"
  done
  printf "%s" "$out"
}

emit_folder_group_from_tmp() {
  local tmp="$1"
  local output="$2"
  local raw pruned
  if [[ ! -s "$tmp" ]]; then
    return 0
  fi
  raw="$(sort -u "$tmp" | paste -sd'|' -)"
  : > "$tmp"
  [[ -z "$raw" ]] && return 0
  if pruned="$(prune_nested_group_dirs "$raw")"; then
    append_unique_line "$pruned" "$output"
  fi
}

collect_folder_groups_from_report() {
  local kind="$1"
  local report_file="$2"
  local output_file="$3"
  local line raw_path path dir
  local group_tmp

  [[ -f "$report_file" ]] || return 0
  group_tmp="$(mktemp)"
  : > "$group_tmp"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$kind" == "image" && "$line" =~ ^Found[[:space:]][0-9]+[[:space:]]images[[:space:]]which[[:space:]]have[[:space:]]similar[[:space:]]friends ]]; then
      emit_folder_group_from_tmp "$group_tmp" "$output_file"
      continue
    fi
    if [[ "$kind" == "video" && "$line" =~ ^Found[[:space:]][0-9]+[[:space:]]videos[[:space:]]which[[:space:]]have[[:space:]]similar[[:space:]]friends ]]; then
      emit_folder_group_from_tmp "$group_tmp" "$output_file"
      continue
    fi
    if [[ "$line" =~ ^\"(.*)\"[[:space:]]-[[:space:]].*$ ]]; then
      raw_path="${BASH_REMATCH[1]}"
      if ! path="$(normalize_path_for_workdir "$raw_path")"; then
        continue
      fi
      [[ -f "$path" ]] || continue
      dir="$(dirname "$path")"
      [[ "$dir" == "." || "$dir" == "./" ]] && continue
      printf "%s\n" "$dir" >> "$group_tmp"
    fi
  done < "$report_file"
  emit_folder_group_from_tmp "$group_tmp" "$output_file"
  rm -f "$group_tmp"
}

group_conflicts_with_registry() {
  local group_line="$1"
  local moved_registry="$2"
  local -a dirs
  local d abs moved_abs
  dirs=()
  IFS='|' read -r -a dirs <<< "$group_line"
  if [[ "${#dirs[@]}" -lt 2 ]]; then
    return 0
  fi
  for d in "${dirs[@]+"${dirs[@]}"}"; do
    [[ -d "$d" ]] || return 0
    abs="$(abs_path_from_rel "$d")"
    while IFS= read -r moved_abs; do
      [[ -z "$moved_abs" ]] && continue
      if [[ "$abs" == "$moved_abs" || "$abs" == "$moved_abs/"* || "$moved_abs" == "$abs/"* ]]; then
        return 0
      fi
    done < "$moved_registry"
  done
  return 1
}

step6_combine_related_folders() {
  local image_report="$1"
  local video_report="$2"
  local groups_tmp plans_tmp plans_sorted_tmp moved_registry
  local group_line pruned parent combo_name
  local current_parent="" seq=0 combo_dir
  local -a dirs
  local d src_abs target
  dirs=()
  local groups_planned=0 groups_created=0 groups_skipped=0 folders_moved=0 folders_failed=0

  return 0

  groups_tmp="$(mktemp)"
  plans_tmp="$(mktemp)"
  plans_sorted_tmp="$(mktemp)"
  moved_registry="$(mktemp)"
  : > "$groups_tmp"
  : > "$plans_tmp"
  : > "$plans_sorted_tmp"
  : > "$moved_registry"

  collect_folder_groups_from_report "image" "$image_report" "$groups_tmp"
  collect_folder_groups_from_report "video" "$video_report" "$groups_tmp"
  if [[ ! -s "$groups_tmp" ]]; then
    rm -f "$groups_tmp" "$plans_tmp" "$plans_sorted_tmp" "$moved_registry"
    log_info "Folder combine substep: no cross-folder similar groups found."
    return 0
  fi

  sort -u "$groups_tmp" > "$groups_tmp.sorted"
  while IFS= read -r group_line; do
    [[ -z "$group_line" ]] && continue
    if ! pruned="$(prune_nested_group_dirs "$group_line" 2>/dev/null)"; then
      continue
    fi
    if ! parent="$(group_lowest_common_parent "$pruned" 2>/dev/null)"; then
      continue
    fi
    if ! combo_name="$(group_combined_folder_name "$pruned" 2>/dev/null)"; then
      continue
    fi
    printf "%s\t%s\t%s\n" "$parent" "$combo_name" "$pruned" >> "$plans_tmp"
  done < "$groups_tmp.sorted"
  rm -f "$groups_tmp.sorted"

  if [[ ! -s "$plans_tmp" ]]; then
    rm -f "$groups_tmp" "$plans_tmp" "$plans_sorted_tmp" "$moved_registry"
    log_info "Folder combine substep: no eligible folder groups after pruning."
    return 0
  fi

  sort -t $'\t' -k1,1 -k2,2 "$plans_tmp" > "$plans_sorted_tmp"
  while IFS=$'\t' read -r parent combo_name group_line; do
    [[ -z "$group_line" ]] && continue
    groups_planned=$((groups_planned + 1))
    if group_conflicts_with_registry "$group_line" "$moved_registry"; then
      groups_skipped=$((groups_skipped + 1))
      continue
    fi

    if [[ "$parent" != "$current_parent" ]]; then
      current_parent="$parent"
      seq=1
    fi
    while :; do
      combo_dir="$(printf "%s/%03d. %s" "$parent" "$seq" "$combo_name")"
      if [[ ! -e "$combo_dir" ]]; then
        break
      fi
      seq=$((seq + 1))
    done
    mkdir -p "$combo_dir"

    IFS='|' read -r -a dirs <<< "$group_line"
    for d in "${dirs[@]+"${dirs[@]}"}"; do
      [[ -d "$d" ]] || { folders_failed=$((folders_failed + 1)); continue; }
      src_abs="$(abs_path_from_rel "$d")"
      target="${combo_dir}/$(basename "$d")"
      target="$(unique_target_path "$target")"
      if mv "$d" "$target"; then
        folders_moved=$((folders_moved + 1))
        append_unique_line "$src_abs" "$moved_registry"
      else
        folders_failed=$((folders_failed + 1))
        log_err "Folder combine move failed: $d"
      fi
    done

    groups_created=$((groups_created + 1))
    seq=$((seq + 1))
  done < "$plans_sorted_tmp"

  rm -f "$groups_tmp" "$plans_tmp" "$plans_sorted_tmp" "$moved_registry"
  log_info "Folder combine substep summary:"
  printf "  - Groups planned: %d\n" "$groups_planned"
  printf "  - Groups created: %d\n" "$groups_created"
  printf "  - Groups skipped: %d\n" "$groups_skipped"
  printf "  - Folders moved:  %d\n" "$folders_moved"
  printf "  - Failed moves:   %d\n" "$folders_failed"
}

step6_move_similar_media() {
  local czkawka_cmd
  local bucket_root="./${SIMILAR_ITEMS_BUCKET_NAME}"
  local bucket_root_abs="${PWD}/${SIMILAR_ITEMS_BUCKET_NAME}"
  local image_report video_report keep_list move_list filtered_move_list
  local image_stats video_stats
  local image_groups=0 image_entries=0 image_keep=0 image_move=0
  local video_groups=0 video_entries=0 video_keep=0 video_move=0
  local total_move_candidates=0 total_planned_moves=0
  local rel
  local moved=0 failed=0 missing=0 skipped_keep_conflicts=0
  local progress=0
  local subdir
  local phase_total=4 phase=0

  if ! czkawka_cmd="$(find_czkawka_command)"; then
    log_err "czkawka is not installed. Install it (brew install czkawka) and retry."
    exit 1
  fi
  log_info "Scanning for similar images and videos. Best-quality matches stay put."

  image_report="$(mktemp)"
  video_report="$(mktemp)"
  keep_list="$(mktemp)"
  move_list="$(mktemp)"
  filtered_move_list="$(mktemp)"

  if ! run_with_spinner "Step 2: scanning similar images with czkawka" "$czkawka_cmd" image -d "$PWD" -e "$bucket_root_abs" -x IMAGE -f "$image_report" -W -N; then
    rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
    log_err "Czkawka image scan failed."
    exit 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Image similarity scan complete."

  if ! run_with_spinner "Step 2: scanning similar videos with czkawka" "$czkawka_cmd" video -d "$PWD" -e "$bucket_root_abs" -x VIDEO -f "$video_report" -W -N; then
    rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
    log_err "Czkawka video scan failed."
    exit 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Video similarity scan complete."

  image_stats="$(collect_similar_media_moves_from_report "image" "$image_report" "$keep_list" "$move_list")"
  IFS='|' read -r image_groups image_entries image_keep image_move <<< "$image_stats"
  if ! is_int "$image_groups"; then image_groups=0; fi
  if ! is_int "$image_entries"; then image_entries=0; fi
  if ! is_int "$image_keep"; then image_keep=0; fi
  if ! is_int "$image_move"; then image_move=0; fi

  video_stats="$(collect_similar_media_moves_from_report "video" "$video_report" "$keep_list" "$move_list")"
  IFS='|' read -r video_groups video_entries video_keep video_move <<< "$video_stats"
  if ! is_int "$video_groups"; then video_groups=0; fi
  if ! is_int "$video_entries"; then video_entries=0; fi
  if ! is_int "$video_keep"; then video_keep=0; fi
  if ! is_int "$video_move"; then video_move=0; fi

  total_move_candidates=$(wc -l < "$move_list" | tr -d ' ')
  if ! is_int "$total_move_candidates"; then total_move_candidates=0; fi

  if [[ -s "$keep_list" ]]; then
    grep -F -x -v -f "$keep_list" "$move_list" > "$filtered_move_list" || true
  else
    cp "$move_list" "$filtered_move_list"
  fi
  total_planned_moves=$(wc -l < "$filtered_move_list" | tr -d ' ')
  if ! is_int "$total_planned_moves"; then total_planned_moves=0; fi
  skipped_keep_conflicts=$(( total_move_candidates - total_planned_moves ))
  if [[ "$skipped_keep_conflicts" -lt 0 ]]; then skipped_keep_conflicts=0; fi

  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Ranked similar groups and planned moves."

  if [[ "$total_planned_moves" -eq 0 ]]; then
    rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
    log_info "No similar media files selected for moving."
    phase=$((phase + 1))
    phase_note "$phase" "$phase_total" "No similar-media moves were needed."
    return 0
  fi

  mkdir -p "$bucket_root/similar_images" "$bucket_root/similar_videos"
  log_info "Moving similar media into: $bucket_root"

  progress=0
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if [[ ! -e "$rel" ]]; then
      missing=$((missing + 1))
      progress=$((progress + 1))
      progress_draw "Step 2 Similar" "$progress" "$total_planned_moves"
      continue
    fi

    if is_video_media_ext "$rel"; then
      subdir="similar_videos"
    elif is_image_media_ext "$rel"; then
      subdir="similar_images"
    else
      missing=$((missing + 1))
      progress=$((progress + 1))
      progress_draw "Step 2 Similar" "$progress" "$total_planned_moves"
      continue
    fi

    if move_item_into_bucket "$rel" "$bucket_root" "$subdir"; then
      moved=$((moved + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to move similar media: $rel"
    fi

    progress=$((progress + 1))
    progress_draw "Step 2 Similar" "$progress" "$total_planned_moves"
  done < "$filtered_move_list"

  rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
  log_info "Step 2 similar-media summary:"
  summary_item "Image groups found" "$image_groups"
  summary_item "Video groups found" "$video_groups"
  summary_item "Keepers selected" "$(( image_keep + video_keep ))"
  summary_item "Move candidates" "$total_move_candidates"
  summary_item "Skipped keep conflicts" "$skipped_keep_conflicts"
  summary_item "Files moved" "$moved"
  summary_item "Missing or skipped" "$missing"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Similar-media move finished."
}

choose_step3_upscale_options() {
  local mode scale noise cpu_fallback

  print_divider
  read -r -p "Process videos or images? [images] " mode
  mode="${mode:-images}"
  while true; do
    case "$mode" in
      images|image|i)
        STEP3_MEDIA_MODE="images"
        break
        ;;
      videos|video|v)
        STEP3_MEDIA_MODE="videos"
        break
        ;;
      *)
        read -r -p "Process videos or images? [images] " mode
        mode="${mode:-images}"
        ;;
    esac
  done

  read -r -p "Upscale level [2] (1, 2, or 4): " scale
  scale="${scale:-2}"
  while true; do
    case "$scale" in
      1|2|4) break ;;
      *) read -r -p "Choose upscale level (1, 2, or 4): " scale ;;
    esac
  done
  WAIFU2X_SCALE="$scale"

  read -r -p "Denoise level [3] (0, 1, 2, or 3): " noise
  noise="${noise:-3}"
  while true; do
    case "$noise" in
      0|1|2|3) break ;;
      *) read -r -p "Choose denoise level (0, 1, 2, or 3): " noise ;;
    esac
  done
  WAIFU2X_NOISE="$noise"

  read -r -p "Use CPU fallback if needed? [Y/n] " cpu_fallback
  cpu_fallback="${cpu_fallback:-Y}"
  if [[ "$cpu_fallback" =~ ^[Nn]$ ]]; then
    STEP3_CPU_FALLBACK=0
  else
    STEP3_CPU_FALLBACK=1
  fi

  if [[ "$STEP3_CPU_FALLBACK" -eq 1 ]]; then
    log_info "Step 8 settings: ${STEP3_MEDIA_MODE}, ${WAIFU2X_SCALE}x upscale, denoise ${WAIFU2X_NOISE}, CPU fallback enabled."
  else
    log_info "Step 8 settings: ${STEP3_MEDIA_MODE}, ${WAIFU2X_SCALE}x upscale, denoise ${WAIFU2X_NOISE}, CPU fallback disabled."
  fi
}

choose_step8_trim_seconds() {
  local seconds
  print_divider
  read -r -p "Trim how many seconds from start of each video? [10] " seconds
  seconds="${seconds:-10}"
  while ! is_number "$seconds"; do
    log_warn "Please enter a valid number of seconds (example: 10 or 3.5)."
    read -r -p "Trim how many seconds from start of each video? [10] " seconds
    seconds="${seconds:-10}"
  done
  if awk -v s="$seconds" 'BEGIN { exit !(s > 0) }'; then
    STEP8_TRIM_SECONDS="$seconds"
  else
    STEP8_TRIM_SECONDS="10"
    log_warn "Value must be greater than 0. Using default 10 seconds."
  fi
  log_info "Step 9 trim-start amount set to ${STEP8_TRIM_SECONDS}s."
}

choose_step9_trim_end_seconds() {
  local seconds
  print_divider
  read -r -p "Trim how many seconds from end of each video? [10] " seconds
  seconds="${seconds:-10}"
  while ! is_number "$seconds"; do
    log_warn "Please enter a valid number of seconds (example: 10 or 3.5)."
    read -r -p "Trim how many seconds from end of each video? [10] " seconds
    seconds="${seconds:-10}"
  done
  if awk -v s="$seconds" 'BEGIN { exit !(s > 0) }'; then
    STEP9_TRIM_END_SECONDS="$seconds"
  else
    STEP9_TRIM_END_SECONDS="10"
    log_warn "Value must be greater than 0. Using default 10 seconds."
  fi
  log_info "Step 10 trim-end amount set to ${STEP9_TRIM_END_SECONDS}s."
}

step8_trim_video_lead() {
  local files=()
  local file duration ext base tmp
  local i total progress=0
  local trimmed=0 approximate=0 skipped_short=0 failed=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" \
                      -o -iname "*.avi" -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.mpg" -o -iname "*.mpeg" \
                      -o -iname "*.3gp" -o -iname "*.m2ts" -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No video files found to trim."
    return 0
  fi

  log_info "Trimming first ${STEP8_TRIM_SECONDS}s from $total video file(s)."
  for ((i=0; i<total; i++)); do
    file="${files[$i]}"
    duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null | head -n 1)"
    if [[ -n "$duration" ]] && awk -v d="$duration" -v s="$STEP8_TRIM_SECONDS" 'BEGIN { exit !(d <= s) }'; then
      skipped_short=$((skipped_short + 1))
      progress=$((progress + 1))
      progress_draw "Step 9 Trim Start" "$progress" "$total"
      continue
    fi

    ext="$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')"
    base="${file%.*}"
    tmp="${base}.trimstart-tmp.$$.$ext"
    rm -f "$tmp"

    # Exact trim-start cuts require decoding. A stream-copy seek snaps to the
    # previous keyframe, which keeps some lead-in and trims less than requested.
    if ffmpeg -hide_banner -loglevel error -y -i "$file" -ss "$STEP8_TRIM_SECONDS" -map 0 -map_metadata 0 -c:v libx264 -crf 20 -preset medium -c:a aac -c:s copy -c:d copy -c:t copy "$tmp" && [[ -s "$tmp" ]]; then
      mv -f "$tmp" "$file"
      trimmed=$((trimmed + 1))
      progress=$((progress + 1))
      progress_draw "Step 9 Trim Start" "$progress" "$total"
      continue
    fi

    rm -f "$tmp" 2>/dev/null || true
    if ffmpeg -hide_banner -loglevel error -y -ss "$STEP8_TRIM_SECONDS" -i "$file" -map 0 -c copy -avoid_negative_ts make_zero "$tmp" && [[ -s "$tmp" ]]; then
      mv -f "$tmp" "$file"
      trimmed=$((trimmed + 1))
      approximate=$((approximate + 1))
      log_warn "Trim used keyframe-aligned fallback and may start earlier than requested: $file"
    else
      rm -f "$tmp" 2>/dev/null || true
      failed=$((failed + 1))
      log_err "Trim failed: $file"
    fi

    progress=$((progress + 1))
      progress_draw "Step 9 Trim Start" "$progress" "$total"
  done

  log_info "Step 9 trim-start summary:"
  printf "  - Trim seconds:        %ss\n" "$STEP8_TRIM_SECONDS"
  printf "  - Files trimmed:       %d\n" "$trimmed"
  printf "  - Approximate trims:   %d\n" "$approximate"
  printf "  - Skipped (too short): %d\n" "$skipped_short"
  printf "  - Failed:              %d\n" "$failed"
}

step9_trim_video_tail() {
  local files=()
  local file duration keep_duration ext base tmp
  local i total progress=0
  local trimmed=0 approximate=0 skipped_short=0 failed=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" \
                      -o -iname "*.avi" -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.mpg" -o -iname "*.mpeg" \
                      -o -iname "*.3gp" -o -iname "*.m2ts" -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No video files found to trim."
    return 0
  fi

  log_info "Trimming last ${STEP9_TRIM_END_SECONDS}s from $total video file(s)."
  for ((i=0; i<total; i++)); do
    file="${files[$i]}"
    duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null | head -n 1)"
    if [[ -n "$duration" ]] && awk -v d="$duration" -v s="$STEP9_TRIM_END_SECONDS" 'BEGIN { exit !(d <= s) }'; then
      skipped_short=$((skipped_short + 1))
      progress=$((progress + 1))
      progress_draw "Step 10 Trim End" "$progress" "$total"
      continue
    fi
    keep_duration="$(awk -v d="$duration" -v s="$STEP9_TRIM_END_SECONDS" 'BEGIN { printf "%.6f", (d - s) }')"

    ext="$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')"
    base="${file%.*}"
    tmp="${base}.trimend-tmp.$$.$ext"
    rm -f "$tmp"

    if ffmpeg -hide_banner -loglevel error -y -i "$file" -t "$keep_duration" -map 0 -map_metadata 0 -c:v libx264 -crf 20 -preset medium -c:a aac -c:s copy -c:d copy -c:t copy "$tmp" && [[ -s "$tmp" ]]; then
      mv -f "$tmp" "$file"
      trimmed=$((trimmed + 1))
      progress=$((progress + 1))
      progress_draw "Step 10 Trim End" "$progress" "$total"
      continue
    fi

    rm -f "$tmp" 2>/dev/null || true
    if ffmpeg -hide_banner -loglevel error -y -i "$file" -t "$keep_duration" -map 0 -c copy -avoid_negative_ts make_zero "$tmp" && [[ -s "$tmp" ]]; then
      mv -f "$tmp" "$file"
      trimmed=$((trimmed + 1))
      approximate=$((approximate + 1))
      log_warn "Trim used keyframe-aligned fallback and may end later than requested: $file"
    else
      rm -f "$tmp" 2>/dev/null || true
      failed=$((failed + 1))
      log_err "Trim failed: $file"
    fi

    progress=$((progress + 1))
    progress_draw "Step 10 Trim End" "$progress" "$total"
  done

  log_info "Step 10 trim-end summary:"
  printf "  - Trim seconds:        %ss\n" "$STEP9_TRIM_END_SECONDS"
  printf "  - Files trimmed:       %d\n" "$trimmed"
  printf "  - Approximate trims:   %d\n" "$approximate"
  printf "  - Skipped (too short): %d\n" "$skipped_short"
  printf "  - Failed:              %d\n" "$failed"
}

choose_resize_height() {
  local choice custom

  print_divider
  echo "Step 4 Resize: choose max media height"
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
  local num fn desc selected_num

  print_divider
  printf "%sLocal Gallery Cleaner v%s%s\n" "$C_BOLD" "$SCRIPT_VERSION" "$C_RESET"
  printf "Working directory: %s\n" "$PWD"
  print_divider
  ensure_prerequisites

  echo "Choose steps to run:"
  echo "  0. Core cleanup (steps 1-7)"
  for num in "${STEP_ORDER[@]}"; do
    printf "  %2d. %s\n" "$num" "$(step_description "$num")"
  done
  read -r -p "Steps (example: 1,2,4-6) > " input
  input="${input// /}"

  if [[ "$input" == "0" ]]; then
    selected=(1 2 3 4 5 6 7)
  else
    IFS=',' read -r -a raw <<< "$input"
    for token in "${raw[@]+"${raw[@]}"}"; do
      if [[ -z "$token" ]]; then
        continue
      fi
      if [[ "$token" =~ ^([0-9]+)-([0-9]+)$ ]]; then
        local range_start range_end n
        range_start="${BASH_REMATCH[1]}"
        range_end="${BASH_REMATCH[2]}"
        if [[ "$range_start" -le "$range_end" ]]; then
          for ((n=range_start; n<=range_end; n++)); do
            selected+=("$n")
          done
        else
          for ((n=range_start; n>=range_end; n--)); do
            selected+=("$n")
          done
        fi
      elif is_int "$token"; then
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

  for num in "${sorted[@]+"${sorted[@]}"}"; do
    if [[ "$num" -lt 1 || "$num" -gt 11 ]]; then
      log_warn "Skipping out-of-range step: $num"
    fi
  done

  for num in "${STEP_ORDER[@]}"; do
    for selected_num in "${sorted[@]+"${sorted[@]}"}"; do
      if [[ "$selected_num" == "$num" ]]; then
        valid_selected+=("$num")
        break
      fi
    done
  done

  if [[ "${#valid_selected[@]}" -eq 0 ]]; then
    log_err "No runnable steps selected."
    exit 1
  fi

  print_divider
  echo "Run plan:"
  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
    printf "  %2d. %s\n" "$num" "$(step_description "$num")"
  done

  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
    case "$num" in
      4) choose_resize_height ;;
      8) choose_step3_upscale_options ;;
      9) choose_step8_trim_seconds ;;
      10) choose_step9_trim_end_seconds ;;
    esac
  done

  read -r -p "Proceed? [y/N] " confirm
  confirm="${confirm:-N}"
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    log_warn "Cancelled."
    exit 0
  fi

  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
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
  printf "%sAll selected steps finished.%s\n" "$C_BOLD" "$C_RESET"
}

main "$@"
