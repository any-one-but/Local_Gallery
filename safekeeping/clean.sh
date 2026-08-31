#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="1.17.0"
# Fallback cap for the resize step if the connected display resolution cannot
# be detected. Normal runs replace this with the highest-resolution active
# monitor, measured by pixel count.
MAX_MEDIA_HEIGHT=3200
MAX_MEDIA_WIDTH=0
MAX_MEDIA_PIXELS=0
PROGRESS_BAR_WIDTH=32
PROGRESS_BAR_MIN_WIDTH=4
EMPTY_ITEMS_BUCKET_NAME="_quarantined_media"
SIMILAR_ITEMS_BUCKET_NAME="_quarantined_media"
# Where step 12's height test writes its sample renders. It sits in the media
# folder so the results can be browsed like anything else, which means every
# step's find has to prune it: it is full of images the run must not treat as
# library media and re-process.
VHS_TEST_FOLDER_NAME="_vhs_height_test"
# czkawka similarity tuning. The scans used to run at pure defaults, which
# leaves accuracy on the table: the default Nearest resize filter produces
# noisy perceptual hashes that both collide distinct images (false culls) and
# drift real near-duplicates past the threshold (missed dupes). Lanczos3 gives
# cleaner, more representative hashes so both error modes drop; the hash size
# and algorithm are pinned so behavior stays stable across czkawka versions.
# For hash size 16, czkawka recommends max-difference up to 20; 8 stays fairly
# strict while catching more real near-dupes than the default 5. Video accuracy
# scales mainly with scan-duration, so we compare a longer window per file.
CZKAWKA_IMAGE_HASH_SIZE=16
CZKAWKA_IMAGE_HASH_ALG="Gradient"
CZKAWKA_IMAGE_FILTER="Lanczos3"
CZKAWKA_IMAGE_MAX_DIFF=8
CZKAWKA_VIDEO_TOLERANCE=10
CZKAWKA_VIDEO_SCAN_DURATION=20
STEP8_TRIM_SECONDS=10
STEP9_TRIM_END_SECONDS=10
STEP12_IMAGE_FORMAT="avif"
# AVIF encode tuning for the recompress step. The image path stages through a
# Lanczos3 resize and hands off to avifenc/libaom. Quality is libavif's own
# 0..100 scale (100 = lossless), not a CRF; higher is better. sharpyuv uses a
# better RGB-to-YUV420 conversion but is off by default because it is unmeasured
# here.
STEP12_AVIF_QUALITY=45
STEP12_AVIF_SPEED=6
STEP12_AVIF_SHARPYUV=0
STEP12_WEBP_QUALITY=80
STEP14_AV1_CRF=32
STEP14_AV1_PRESET=6
# Step 15 pace. slow = one file at a time with the encoder free to take the
# whole machine, which is how this step has always run. ultra = several files
# at once, the pool sized from the machine (see step15_ultra_jobs) and each
# job held to its share of the cores.
STEP15_RECOMPRESS_PACE="slow"
STEP15_ULTRA_IMAGE_JOBS=0
STEP15_ULTRA_VIDEO_JOBS=0
STEP15_ULTRA_MAX_JOBS=32
# Threads handed to each job while ultra is running. Set per pool by
# step15_ultra_threads; ignored at the slow pace, where the encoder decides.
STEP15_JOB_THREADS=1
# VHS step: analog NTSC/VHS look via ntsc-rs. Height is the scanline size
# the picture is resized to before the effect. 800 was the standalone
# script's hardcoded size; 480 is 480p; then every 100px up to 1500.
STEP13_VHS_HEIGHT=800
STEP13_VHS_HEIGHTS=(480 500 600 700 800 900 1000 1100 1200 1300 1400 1500)
STEP13_VHS_CLI="/Applications/ntsc-rs.app/Contents/MacOS/ntsc-rs-cli"
# Optimage step. The app binary is the CLI entry point that matters: the
# bundled cli/optimage handles PNG and JPEG only, while the app itself handles
# every format it advertises AND uses whatever the app's own Preferences say —
# which is what "drag it in and let it work" means. Files are handed over in
# batches so the progress bar moves; each batch is one app launch.
STEP5_OPTIMAGE_BIN="/Applications/Optimage.app/Contents/MacOS/Optimage"
STEP5_OPTIMAGE_BATCH=200
# fast = one file at a time, each tool free to use the machine as it likes.
# slow = one file at a time, one CPU thread, background priority, so it can
# sit running without loading the machine. ultra = several files at once, the
# pool sized from the machine (see step13_vhs_ultra_jobs).
STEP13_VHS_PACE="fast"
# Ultra pace pool sizes. 0 means "work it out from this machine"; a positive
# number overrides that. The ceiling is a guard against a very wide machine
# opening more slots than the disk and the memory bus can feed.
STEP13_VHS_ULTRA_IMAGE_JOBS=0
STEP13_VHS_ULTRA_VIDEO_JOBS=0
STEP13_VHS_ULTRA_MAX_JOBS=32
# Threads handed to each job while ultra is running. Set per pool by
# step13_vhs_ultra_threads so the slots add up to the machine rather than each
# one trying to take all of it.
STEP13_VHS_JOB_THREADS=1
# Step 11 delete criteria, chosen up front by choose_step12_delete_criteria.
# 0 means nothing has been chosen, which is only reachable if the step is
# invoked without going through the menu.
STEP12_DELETE_CHOICE=0
# Opening an archive can reveal more archives, so step 10 rescans after
# each pass. This caps how deep that chain may go.
STEP11_ARCHIVE_MAX_PASSES=8
# Color grade step: five dials, each a whole percentage from -100 to 100,
# zero meaning "leave it alone". They are the gallery app's own filter
# controls -- same names, same arithmetic, same order -- so the numbers set
# here mean what they mean in the app. color_grade_filter_chain has the math.
COLOR_GRADE_BRIGHTNESS=0
COLOR_GRADE_CONTRAST=0
COLOR_GRADE_SATURATION=0
COLOR_GRADE_TEMPERATURE=0
COLOR_GRADE_HUE=0
# The quick set, in dial order: brightness, contrast, saturation, temperature,
# hue shift. A gentle lift rather than a look -- enough to bring a flat picture
# up, not enough to be read as an effect.
COLOR_GRADE_ENHANCE=(0 5 10 0 5)
STEP_ORDER=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15)

# ── Terminal capabilities, palette, and box-drawing glyphs ───────────
# A TTY gets the full DOS-style UI (16 colors, line/block glyphs); a pipe
# falls back to plain 7-bit ASCII so logs stay readable.
if [[ -t 1 ]]; then
  UI_TTY=1
else
  UI_TTY=0
fi

if [[ "$UI_TTY" -eq 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_BLUE=$'\033[34m'
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_WHITE=$'\033[97m'

  G_H='─';  G_V='│'
  G_TL='┌'; G_TR='┐'; G_BL='└'; G_BR='┘'; G_ML='├'; G_MR='┤'
  G_DH='═'; G_DV='║'; G_DTL='╔'; G_DTR='╗'; G_DBL='╚'; G_DBR='╝'
  G_BARF='█'; G_BARE='░'
  G_ARROW='»'; G_DOT='·'; G_BULL='•'
else
  C_RESET=""; C_BOLD=""; C_DIM=""
  C_BLUE=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_WHITE=""

  G_H='-';  G_V='|'
  G_TL='+'; G_TR='+'; G_BL='+'; G_BR='+'; G_ML='+'; G_MR='+'
  G_DH='='; G_DV='|'; G_DTL='+'; G_DTR='+'; G_DBL='+'; G_DBR='+'
  G_BARF='#'; G_BARE='-'
  G_ARROW='>'; G_DOT='.'; G_BULL='*'
fi

UI_STATUS_ACTIVE=0
UI_CURSOR_HIDDEN=0
UI_PROGRESS_KEY=""
UI_PROGRESS_PCT=-1
UI_WIDTH_MAX=64

ui_cols() {
  local w="${COLUMNS:-}"
  if ! is_int "$w" || [[ "$w" -le 0 ]]; then
    w="$(tput cols 2>/dev/null || printf "80")"
  fi
  if ! is_int "$w" || [[ "$w" -le 0 ]]; then w=80; fi
  printf "%s" "$w"
}

# Tidy frame width: track the terminal but cap it so boxes stay compact.
ui_width() {
  local w
  w="$(ui_cols)"
  if [[ "$w" -gt "$UI_WIDTH_MAX" ]]; then w="$UI_WIDTH_MAX"; fi
  if [[ "$w" -lt 24 ]]; then w=24; fi
  printf "%s" "$w"
}

# Repeat a (possibly multibyte) glyph N times. tr can't do this safely for
# UTF-8 box characters, so build the run a character at a time.
ui_repeat() {
  local ch="$1" n="${2:-0}" out="" i
  [[ "$n" -lt 0 ]] && n=0
  for ((i=0; i<n; i++)); do out+="$ch"; done
  printf "%s" "$out"
}

ui_hide_cursor() {
  if [[ "$UI_TTY" -eq 1 && "$UI_CURSOR_HIDDEN" -eq 0 ]]; then
    printf "\033[?25l"
    UI_CURSOR_HIDDEN=1
  fi
}

ui_show_cursor() {
  if [[ "$UI_TTY" -eq 1 && "$UI_CURSOR_HIDDEN" -eq 1 ]]; then
    printf "\033[?25h"
    UI_CURSOR_HIDDEN=0
  fi
}

ui_on_signal() { ui_show_cursor; exit 130; }
trap 'ui_show_cursor' EXIT
trap 'ui_on_signal' INT TERM

ui_clear_status_line() {
  if [[ "$UI_TTY" -eq 1 && "${UI_STATUS_ACTIVE:-0}" -eq 1 ]]; then
    printf "\r\033[K"
    UI_STATUS_ACTIVE=0
    ui_show_cursor
  fi
}

ui_box_top()    { ui_clear_status_line; printf "%s%s%s%s%s\n" "$C_DIM" "$G_TL" "$(ui_repeat "$G_H" $(( $(ui_width) - 2 )))" "$G_TR" "$C_RESET"; }
ui_box_sep()    { ui_clear_status_line; printf "%s%s%s%s%s\n" "$C_DIM" "$G_ML" "$(ui_repeat "$G_H" $(( $(ui_width) - 2 )))" "$G_MR" "$C_RESET"; }
ui_box_bottom() { ui_clear_status_line; printf "%s%s%s%s%s\n" "$C_DIM" "$G_BL" "$(ui_repeat "$G_H" $(( $(ui_width) - 2 )))" "$G_BR" "$C_RESET"; }

# A single boxed row. Text must be plain ASCII so byte length == column width.
ui_box_line() {
  local text="$1" color="${2:-$C_RESET}"
  local w inner pad
  w="$(ui_width)"
  inner=$(( w - 2 ))
  pad=$(( inner - ${#text} - 1 ))
  [[ "$pad" -lt 0 ]] && pad=0
  ui_clear_status_line
  printf "%s%s%s %s%s%s%s%s%s%s\n" \
    "$C_DIM" "$G_V" "$C_RESET" \
    "$color" "$text" "$C_RESET" \
    "$(ui_repeat ' ' "$pad")" \
    "$C_DIM" "$G_V" "$C_RESET"
}

# Double-ruled title banner with an optional right-aligned tag (e.g. version).
ui_banner() {
  local left="$1" right="${2:-}"
  local w inner pad
  w="$(ui_width)"
  inner=$(( w - 2 ))
  pad=$(( inner - ${#left} - ${#right} - 4 ))
  [[ "$pad" -lt 1 ]] && pad=1
  ui_clear_status_line
  printf "%s%s%s%s%s\n" "$C_BOLD$C_CYAN" "$G_DTL" "$(ui_repeat "$G_DH" "$inner")" "$G_DTR" "$C_RESET"
  printf "%s%s%s  %s%s%s%s%s%s%s  %s%s%s\n" \
    "$C_BOLD$C_CYAN" "$G_DV" "$C_RESET" \
    "$C_BOLD$C_WHITE" "$left" "$C_RESET" \
    "$(ui_repeat ' ' "$pad")" \
    "$C_DIM" "$right" "$C_RESET" \
    "$C_BOLD$C_CYAN" "$G_DV" "$C_RESET"
  printf "%s%s%s%s%s\n" "$C_BOLD$C_CYAN" "$G_DBL" "$(ui_repeat "$G_DH" "$inner")" "$G_DBR" "$C_RESET"
}

# Lightweight section header for prompts/sub-menus.
ui_section() {
  ui_clear_status_line
  printf "\n%s%s%s %s%s%s\n" "$C_BOLD$C_CYAN" "$G_ARROW" "$C_RESET" "$C_BOLD$C_WHITE" "$1" "$C_RESET"
}

# Per-step header: arrow + step label, underlined by a thin rule.
ui_step_header() {
  local num="$1" desc="$2"
  ui_clear_status_line
  UI_PROGRESS_KEY=""
  UI_PROGRESS_PCT=-1
  printf "\n%s%s%s %sSTEP %s%s  %s%s%s\n" \
    "$C_BOLD$C_CYAN" "$G_ARROW" "$C_RESET" \
    "$C_BOLD$C_WHITE" "$num" "$C_RESET" \
    "$C_BOLD" "$desc" "$C_RESET"
  printf "%s%s%s\n" "$C_DIM" "$(ui_repeat "$G_H" "$(ui_width)")" "$C_RESET"
}

# Styled prompt prefix; use as: read -r -p "$(ui_prompt 'Question')" var
ui_prompt() {
  printf "%s%s%s %s%s%s %s>%s " \
    "$C_BOLD$C_CYAN" "$G_ARROW" "$C_RESET" \
    "$C_BOLD" "$1" "$C_RESET" \
    "$C_DIM" "$C_RESET"
}

log_info() { ui_clear_status_line; printf "%s%s[INFO]%s %s\n" "$C_BOLD" "$C_BLUE" "$C_RESET" "$*"; }
log_ok()   { ui_clear_status_line; printf "%s%s[ OK ]%s %s\n" "$C_BOLD" "$C_GREEN" "$C_RESET" "$*"; }
log_warn() { ui_clear_status_line; printf "%s%s[WARN]%s %s\n" "$C_BOLD" "$C_YELLOW" "$C_RESET" "$*"; }
log_err()  { ui_clear_status_line; printf "%s%s[FAIL]%s %s\n" "$C_BOLD" "$C_RED" "$C_RESET" "$*" >&2; }

print_divider() {
  ui_clear_status_line
  printf "%s%s%s\n" "$C_DIM" "$(ui_repeat "$G_H" "$(ui_width)")" "$C_RESET"
}

# Dim sub-step note. Signature kept (current,total,label); only the label shows.
phase_note() {
  local label="$3"
  ui_clear_status_line
  printf "%s   %s %s%s\n" "$C_DIM" "$G_DOT" "$label" "$C_RESET"
}

summary_item() {
  local label="$1" value="$2"
  ui_clear_status_line
  printf "   %s%-22s%s %s%s%s\n" "$C_DIM" "$label" "$C_RESET" "$C_BOLD" "$value" "$C_RESET"
}

progress_draw() {
  local label="$1"
  local current="${2:-0}"
  local total="${3:-1}"
  local mode="${4:-inline}"
  local pct filled empty bar_width suffix term_cols line_budget bar

  if ! is_int "$current"; then current=0; fi
  if ! is_int "$total" || [[ "$total" -le 0 ]]; then total=1; fi
  [[ "$current" -lt 0 ]] && current=0
  [[ "$current" -gt "$total" ]] && current="$total"
  pct=$(( current * 100 / total ))

  if [[ "$UI_TTY" -eq 1 && "$mode" != "line" ]]; then
    # Anti-flicker: only repaint when the percentage actually changes (or on
    # completion). Big libraries call this thousands of times per step.
    if [[ "$label" == "$UI_PROGRESS_KEY" && "$pct" -eq "$UI_PROGRESS_PCT" && "$current" -lt "$total" ]]; then
      return 0
    fi
    UI_PROGRESS_KEY="$label"
    UI_PROGRESS_PCT="$pct"
  fi

  bar_width="$PROGRESS_BAR_WIDTH"
  suffix="$(printf "%3d%%  %d/%d" "$pct" "$current" "$total")"

  if [[ "$UI_TTY" -eq 1 && "$mode" != "line" ]]; then
    term_cols="$(ui_cols)"
    line_budget=$(( term_cols - ${#label} - ${#suffix} - 6 ))
    if [[ "$line_budget" -lt "$bar_width" ]]; then bar_width="$line_budget"; fi
    if [[ "$bar_width" -lt "$PROGRESS_BAR_MIN_WIDTH" ]]; then bar_width="$PROGRESS_BAR_MIN_WIDTH"; fi
  fi

  filled=$(( pct * bar_width / 100 ))
  [[ "$filled" -gt "$bar_width" ]] && filled="$bar_width"
  [[ "$filled" -lt 0 ]] && filled=0
  empty=$(( bar_width - filled ))

  if [[ "$UI_TTY" -eq 1 && "$mode" != "line" ]]; then
    ui_hide_cursor
    bar="${C_GREEN}$(ui_repeat "$G_BARF" "$filled")${C_DIM}$(ui_repeat "$G_BARE" "$empty")${C_RESET}"
    # Write content first, then clear-to-end-of-line — never blanks the row,
    # so there is no flash between frames.
    printf "\r%s%s%s %s[%s%s]%s %s%s%s\033[K" \
      "$C_DIM" "$label" "$C_RESET" \
      "$C_DIM" "$bar" "$C_DIM" "$C_RESET" \
      "$C_BOLD" "$suffix" "$C_RESET"
    UI_STATUS_ACTIVE=1
    if [[ "$current" -ge "$total" ]]; then
      printf "\n"
      UI_STATUS_ACTIVE=0
      UI_PROGRESS_KEY=""
      UI_PROGRESS_PCT=-1
      ui_show_cursor
    fi
  else
    ui_clear_status_line
    printf "%s [%s%s] %s\n" "$label" "$(ui_repeat "$G_BARF" "$filled")" "$(ui_repeat "$G_BARE" "$empty")" "$suffix"
  fi
}

run_with_spinner() {
  local label="$1"
  shift
  local pid rc i=0
  local spinner='|/-\'
  local mark

  if [[ "$UI_TTY" -ne 1 ]]; then
    "$@"
    return $?
  fi

  # Discard the worker's own chatter (czkawka/ffmpeg progress) so it can't
  # fight the spinner. Callers that need output redirect it to a file inside
  # their own command, which is unaffected by this.
  ui_hide_cursor
  "$@" >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    mark="${spinner:$(( i % 4 )):1}"
    printf "\r%s%s%s %s%s%s\033[K" "$C_DIM" "$label" "$C_RESET" "$C_CYAN" "$mark" "$C_RESET"
    UI_STATUS_ACTIVE=1
    i=$((i + 1))
    sleep 0.12
  done
  wait "$pid"
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    printf "\r%s%s%s  %s[ ok ]%s\033[K\n" "$C_DIM" "$label" "$C_RESET" "$C_GREEN" "$C_RESET"
  else
    printf "\r%s%s%s  %s[fail]%s\033[K\n" "$C_DIM" "$label" "$C_RESET" "$C_RED" "$C_RESET"
  fi
  UI_STATUS_ACTIVE=0
  ui_show_cursor
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

find_magick_command() {
  if command -v magick >/dev/null 2>&1; then
    printf "magick"
    return 0
  fi
  # ImageMagick 6 shipped the resizer as 'convert'; IM7 renamed it to 'magick'
  # and keeps 'convert' only as a compatibility shim. Accept either.
  if command -v convert >/dev/null 2>&1; then
    printf "convert"
    return 0
  fi
  return 1
}

find_ntsc_rs_command() {
  if [[ -n "${NTSC_RS_CLI:-}" && -x "${NTSC_RS_CLI}" ]]; then
    printf "%s" "$NTSC_RS_CLI"
    return 0
  fi
  if [[ -x "$STEP13_VHS_CLI" ]]; then
    printf "%s" "$STEP13_VHS_CLI"
    return 0
  fi
  if command -v ntsc-rs-cli >/dev/null 2>&1; then
    command -v ntsc-rs-cli
    return 0
  fi
  return 1
}

find_optimage_command() {
  if [[ -n "${OPTIMAGE_BIN:-}" && -x "${OPTIMAGE_BIN}" ]]; then
    printf "%s" "$OPTIMAGE_BIN"
    return 0
  fi
  if [[ -x "$STEP5_OPTIMAGE_BIN" ]]; then
    printf "%s" "$STEP5_OPTIMAGE_BIN"
    return 0
  fi
  return 1
}

ensure_prerequisites() {
  local missing_labels=()
  local missing_formulas=()
  local still_missing=()
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
  # The recompress step's still-image encoder depends on which output format is
  # configured, so only pull the chain that will actually be used.
  if [[ "$STEP12_IMAGE_FORMAT" == "webp" ]]; then
    if ! command -v cwebp >/dev/null 2>&1; then
      missing_labels+=("cwebp (formula: webp)")
      missing_formulas+=("webp")
    fi
  else
    if ! command -v avifenc >/dev/null 2>&1; then
      missing_labels+=("avifenc (formula: libavif)")
      missing_formulas+=("libavif")
    fi
    if ! find_magick_command >/dev/null 2>&1; then
      missing_labels+=("magick (formula: imagemagick)")
      missing_formulas+=("imagemagick")
    fi
  fi
  if [[ "${#missing_labels[@]}" -eq 0 ]]; then
    log_ok "All prerequisite tools are installed."
    return 0
  fi

  ui_section "MISSING PREREQUISITES"
  for label in "${missing_labels[@]+"${missing_labels[@]}"}"; do
    printf "   %s%s%s %s\n" "$C_YELLOW" "$G_BULL" "$C_RESET" "$label"
  done
  read -r -p "$(ui_prompt 'Install missing prerequisites now? [Y/n]')" ans
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
  still_missing=()
  command -v fdupes  >/dev/null 2>&1 || still_missing+=("fdupes")
  command -v ffmpeg  >/dev/null 2>&1 || still_missing+=("ffmpeg")
  command -v ffprobe >/dev/null 2>&1 || still_missing+=("ffprobe")
  command -v mat2    >/dev/null 2>&1 || still_missing+=("mat2")
  find_czkawka_command >/dev/null 2>&1 || still_missing+=("czkawka")
  if [[ "$STEP12_IMAGE_FORMAT" == "webp" ]]; then
    command -v cwebp >/dev/null 2>&1 || still_missing+=("cwebp")
  else
    command -v avifenc >/dev/null 2>&1 || still_missing+=("avifenc")
    find_magick_command >/dev/null 2>&1 || still_missing+=("magick")
  fi
  if [[ "${#still_missing[@]}" -gt 0 ]]; then
    log_err "Still missing after install: ${still_missing[*]}"
    exit 1
  fi

  log_ok "Prerequisites ready."
}

step_description() {
  case "${1:-}" in
    1) printf "Quarantine duplicate, similar, and empty files" ;;
    2) printf "Sanitize file and folder names" ;;
    3) printf "Convert videos and animated GIFs to MP4" ;;
    4) printf "Remove metadata" ;;
    5) printf "Compress media with Optimage" ;;
    6) printf "Trim video starts" ;;
    7) printf "Trim video ends" ;;
    8) printf "Extract MP3 audio from videos" ;;
    9) printf "Quarantine static videos and video-frame images" ;;
    10) printf "Open archives in place and delete them" ;;
    11) printf "Delete files recursively" ;;
    12) printf "Apply VHS look to images and videos" ;;
    13) printf "Color grade media" ;;
    14) printf "Resize oversized media" ;;
    15) printf "Recompress media (images to AVIF/WebP, videos to AV1)" ;;
    *) printf "Unknown step" ;;
  esac
}

step_function_name() {
  case "${1:-}" in
    1) printf "step1_quarantine_clutter" ;;
    2) printf "step7_sanitize_names" ;;
    3) printf "step2_convert_videos" ;;
    4) printf "step4_remove_metadata" ;;
    5) printf "step_optimage_compress" ;;
    6) printf "step8_trim_video_lead" ;;
    7) printf "step9_trim_video_tail" ;;
    8) printf "step10_extract_video_audio_mp3" ;;
    9) printf "step13_quarantine_static_media" ;;
    10) printf "step11_unpack_archives" ;;
    11) printf "step12_delete_files_recursive" ;;
    12) printf "step13_apply_vhs_effect" ;;
    13) printf "step_color_grade" ;;
    14) printf "step4_resize_media" ;;
    15) printf "step_recompress_media" ;;
    *) printf "" ;;
  esac
}

ensure_step_requirements() {
  local step_num="$1"
  case "$step_num" in
    1)
      # Union of the three merged passes: dedupe, similar-media culling,
      # empty-item quarantine.
      require_cmd fdupes
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
    2)
      require_cmd find
      require_cmd mv
      ;;
    3)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      ;;
    4)
      require_cmd mat2
      ;;
    5)
      require_cmd find
      if ! find_optimage_command >/dev/null 2>&1; then
        log_err "Required command not found: Optimage"
        log_err "Install the Optimage app in /Applications, then run this again."
        return 1
      fi
      ;;
    6)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      ;;
    7)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      ;;
    8)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      ;;
    9)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd mkdir
      ;;
    10)
      require_cmd find
      require_cmd mv
      require_cmd rm
      require_cmd mkdir
      ensure_unarchive_ready || return 1
      ;;
    11)
      require_cmd find
      require_cmd rm
      require_cmd stat
      ;;
    12)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      if ! find_ntsc_rs_command >/dev/null 2>&1; then
        log_err "Required command not found: ntsc-rs-cli"
        log_err "Install the ntsc-rs app in /Applications, then run this again."
        return 1
      fi
      ;;
    13)
      require_cmd find
      require_cmd awk
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      ;;
    14)
      require_cmd sips
      require_cmd ffprobe
      require_cmd ffmpeg
      ;;
    15)
      require_cmd find
      require_cmd ffmpeg
      require_cmd ffprobe
      require_cmd mv
      require_cmd rm
      if [[ "$STEP12_IMAGE_FORMAT" == "webp" ]]; then
        ensure_cwebp_ready || return 1
      else
        ensure_avif_tools_ready || return 1
      fi
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

  ui_step_header "$step_num" "$desc"
  start_ts=$(date +%s)
  "$fn"
  end_ts=$(date +%s)
  elapsed=$(( end_ts - start_ts ))
  log_ok "Step $step_num done in ${elapsed}s"
}

# Step 1 runs the three cheap scan-and-move passes back to back: exact
# duplicates, lower-quality near-duplicates, and empty items. They were
# separate menu steps before; folding them into one keeps the expensive
# re-encoding steps off files that are about to be removed anyway. Name
# sanitization used to be a fourth pass here and is now step 2, so the
# renaming happens after the quarantining rather than in the middle of it.
step1_quarantine_clutter() {
  ui_section "Pass 1/3: Duplicate files"
  step1_dedupe
  ui_section "Pass 2/3: Similar media"
  step6_move_similar_media
  ui_section "Pass 3/3: Empty files and folders"
  step9_move_empty_items
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
  if [[ -s "$dedupe_log" ]]; then
    log_info "Duplicate sets found and removed."
  else
    log_info "No duplicate groups were found."
  fi
  rm -f "$dedupe_log"
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
  else
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
  fi

  # Animated GIFs are just videos in a worse container, so fold their MP4
  # conversion into this same pass instead of running it as a separate step.
  convert_gifs_to_mp4
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
      progress_draw "Step 8 MP3" "$progress" "$total"
      continue
    fi

    audio_stream="$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$file" 2>/dev/null | head -n 1)"
    if [[ -z "$audio_stream" ]]; then
      skipped_no_audio=$((skipped_no_audio + 1))
      progress=$((progress + 1))
      progress_draw "Step 8 MP3" "$progress" "$total"
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
    progress_draw "Step 8 MP3" "$progress" "$total"
  done

  log_info "Step 8 audio extraction summary:"
  summary_item "MP3 files created" "$created"
  summary_item "Skipped (exists)" "$skipped_existing"
  summary_item "Skipped (no audio)" "$skipped_no_audio"
  summary_item "Failed" "$failed"
}

detect_largest_active_display() {
  local detected=""

  if command -v system_profiler >/dev/null 2>&1; then
    detected="$(system_profiler SPDisplaysDataType 2>/dev/null | awk '
      function consider_online() {
        if (pending_pixels > online_pixels) {
          online_pixels = pending_pixels
          online_w = pending_w
          online_h = pending_h
        }
        pending_w = 0
        pending_h = 0
        pending_pixels = 0
      }
      /^[[:space:]]*Resolution:/ {
        if (match($0, /[0-9]+[[:space:]]*x[[:space:]]*[0-9]+/)) {
          dims = substr($0, RSTART, RLENGTH)
          split(dims, parts, /x/)
          gsub(/[[:space:]]/, "", parts[1])
          gsub(/[[:space:]]/, "", parts[2])
          pending_w = parts[1] + 0
          pending_h = parts[2] + 0
          pending_pixels = pending_w * pending_h
          if (pending_pixels > any_pixels) {
            any_pixels = pending_pixels
            any_w = pending_w
            any_h = pending_h
          }
        }
        next
      }
      /^[[:space:]]*Online:[[:space:]]*Yes/ {
        consider_online()
        next
      }
      /^[[:space:]]*Online:[[:space:]]*No/ {
        pending_w = 0
        pending_h = 0
        pending_pixels = 0
        next
      }
      END {
        if (online_pixels > 0) print online_w, online_h, online_pixels
        else if (any_pixels > 0) print any_w, any_h, any_pixels
      }
    ')"
  fi

  if [[ "$detected" =~ ^[0-9]+[[:space:]][0-9]+[[:space:]][0-9]+$ ]]; then
    printf "%s" "$detected"
    return 0
  fi
  return 1
}

set_resize_limit_from_displays() {
  local detected

  if [[ "$MAX_MEDIA_PIXELS" -gt 0 ]]; then
    return 0
  fi

  if detected="$(detect_largest_active_display)"; then
    read -r MAX_MEDIA_WIDTH MAX_MEDIA_HEIGHT MAX_MEDIA_PIXELS <<< "$detected"
    log_info "Resize limit set to ${MAX_MEDIA_WIDTH}x${MAX_MEDIA_HEIGHT} (${MAX_MEDIA_PIXELS} pixels) from the largest active display."
  else
    MAX_MEDIA_PIXELS=0
    log_warn "Could not detect display resolution. Using fallback ${MAX_MEDIA_HEIGHT}px height cap."
  fi
}

media_resize_target_dimensions() {
  local w="$1" h="$2" even="${3:-0}"
  local max_pixels="${MAX_MEDIA_PIXELS:-0}"

  if ! is_int "$w" || ! is_int "$h" || [[ "$w" -le 0 || "$h" -le 0 ]]; then
    return 1
  fi

  if is_int "$max_pixels" && [[ "$max_pixels" -gt 0 ]]; then
    if [[ $(( w * h )) -le "$max_pixels" ]]; then
      return 1
    fi
    awk -v w="$w" -v h="$h" -v max="$max_pixels" -v even="$even" 'BEGIN {
      scale = sqrt(max / (w * h));
      nw = int(w * scale);
      nh = int(h * scale);
      if (nw < 1) nw = 1;
      if (nh < 1) nh = 1;
      if (even) {
        nw = int(nw / 2) * 2;
        nh = int(nh / 2) * 2;
        if (nw < 2) nw = 2;
        if (nh < 2) nh = 2;
      }
      while (nw * nh > max && nw > 1 && nh > 1) {
        if (w >= h) {
          nw -= even ? 2 : 1;
          nh = int(nw * h / w);
        } else {
          nh -= even ? 2 : 1;
          nw = int(nh * w / h);
        }
        if (even) {
          nw = int(nw / 2) * 2;
          nh = int(nh / 2) * 2;
          if (nw < 2) nw = 2;
          if (nh < 2) nh = 2;
        }
      }
      print nw, nh;
    }'
    return 0
  fi

  if [[ "$h" -le "$MAX_MEDIA_HEIGHT" ]]; then
    return 1
  fi
  awk -v w="$w" -v h="$h" -v max_h="$MAX_MEDIA_HEIGHT" -v even="$even" 'BEGIN {
    nw = int(w * max_h / h);
    nh = max_h;
    if (nw < 1) nw = 1;
    if (even) {
      nw = int(nw / 2) * 2;
      nh = int(nh / 2) * 2;
      if (nw < 2) nw = 2;
      if (nh < 2) nh = 2;
    }
    print nw, nh;
  }'
}

step4_resize_media() {
  local images=() videos=()
  local file ext base tmp dims
  local i total w h nw nh
  local all_total=0 all_done=0
  local img_resized=0 img_skipped=0 img_failed=0
  local vid_resized=0 vid_skipped=0 vid_failed=0

  set_resize_limit_from_displays

  while IFS= read -r -d '' file; do
    images+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" \
                      -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \) -print0
  )

  while IFS= read -r -d '' file; do
    videos+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" \
                      -o -iname "*.webm" -o -iname "*.avi" \) -print0
  )

  all_total=$(( ${#images[@]} + ${#videos[@]} ))
  if [[ "$all_total" -eq 0 ]]; then
    log_warn "No media found to evaluate for resizing."
    return 0
  fi

  total=${#images[@]}
  if [[ "$total" -gt 0 ]]; then
    if [[ "$MAX_MEDIA_PIXELS" -gt 0 ]]; then
      log_info "Checking $total image file(s) for resolution > ${MAX_MEDIA_PIXELS} pixels."
    else
      log_info "Checking $total image file(s) for height > ${MAX_MEDIA_HEIGHT}px."
    fi
    for (( i=0; i<total; i++ )); do
      file="${images[$i]}"

      w=$(sips -g pixelWidth "$file" 2>/dev/null | awk '/pixelWidth/ {print $2; exit}')
      h=$(sips -g pixelHeight "$file" 2>/dev/null | awk '/pixelHeight/ {print $2; exit}')
      if ! is_int "$w" || ! is_int "$h"; then
        img_skipped=$((img_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 14 Resize" "$all_done" "$all_total"
        continue
      fi
      if ! dims="$(media_resize_target_dimensions "$w" "$h" 0)"; then
        img_skipped=$((img_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 14 Resize" "$all_done" "$all_total"
        continue
      fi

      read -r nw nh <<< "$dims"
      if sips -z "$nh" "$nw" "$file" >/dev/null 2>&1; then
        img_resized=$((img_resized + 1))
      else
        img_failed=$((img_failed + 1))
        log_err "Resize failed: $file"
      fi
      all_done=$((all_done + 1))
      progress_draw "Step 14 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No images found to evaluate for resizing."
  fi

  total=${#videos[@]}
  if [[ "$all_done" -gt 0 ]]; then
    progress_draw "Step 14 Resize" "$all_done" "$all_total"
  fi
  if [[ "$total" -gt 0 ]]; then
    if [[ "$MAX_MEDIA_PIXELS" -gt 0 ]]; then
      log_info "Checking $total video file(s) for resolution > ${MAX_MEDIA_PIXELS} pixels."
    else
      log_info "Checking $total video file(s) for height > ${MAX_MEDIA_HEIGHT}px."
    fi
    for (( i=0; i<total; i++ )); do
      file="${videos[$i]}"

      w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$file" 2>/dev/null | head -n 1)
      h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$file" 2>/dev/null | head -n 1)
      if ! is_int "$w" || ! is_int "$h"; then
        vid_skipped=$((vid_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 14 Resize" "$all_done" "$all_total"
        continue
      fi
      if ! dims="$(media_resize_target_dimensions "$w" "$h" 1)"; then
        vid_skipped=$((vid_skipped + 1))
        all_done=$((all_done + 1))
        progress_draw "Step 14 Resize" "$all_done" "$all_total"
        continue
      fi

      read -r nw nh <<< "$dims"
      ext=$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')
      base="${file%.*}"
      tmp="${base}.resize-tmp.$$.$ext"
      rm -f "$tmp"

      case "$ext" in
        mp4|m4v)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${nh}" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy -movflags +faststart "$tmp"
          ;;
        mov|mkv|avi)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${nh}" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
          ;;
        webm)
          ffmpeg -hide_banner -loglevel error -y -i "$file" -vf "scale=${nw}:${nh}" -map 0 -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a copy -c:s copy "$tmp"
          ;;
        *)
          vid_skipped=$((vid_skipped + 1))
          all_done=$((all_done + 1))
          progress_draw "Step 14 Resize" "$all_done" "$all_total"
          continue
          ;;
      esac

      if [[ -s "$tmp" ]]; then
        mv -f "$tmp" "$file"
        vid_resized=$((vid_resized + 1))
      else
        rm -f "$tmp"
        vid_failed=$((vid_failed + 1))
        log_err "Resize failed: $file"
      fi
      all_done=$((all_done + 1))
      progress_draw "Step 14 Resize" "$all_done" "$all_total"
    done
  else
    log_warn "No videos found to evaluate for resizing."
  fi

  log_info "Step 14 resize summary:"
  if [[ "$MAX_MEDIA_PIXELS" -gt 0 ]]; then
    summary_item "Max display" "${MAX_MEDIA_WIDTH}x${MAX_MEDIA_HEIGHT}"
    summary_item "Max resolution" "${MAX_MEDIA_PIXELS} pixels"
  else
    summary_item "Max height" "${MAX_MEDIA_HEIGHT}px"
  fi
  summary_item "Images resized" "$img_resized"
  summary_item "Images skipped" "$img_skipped"
  summary_item "Images failed" "$img_failed"
  summary_item "Videos resized" "$vid_resized"
  summary_item "Videos skipped" "$vid_skipped"
  summary_item "Videos failed" "$vid_failed"
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
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \
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

  log_info "Step 4 metadata summary:"
  summary_item "Cleaned" "$cleaned"
  summary_item "Failed" "$failed"
}

# ── Step 5: Optimage compression ─────────────────────────────────────
# The last pass of the core cleanup, and deliberately the least configurable
# one in this script: it hands the files to Optimage and passes no compression
# flags at all, so the result is exactly what dragging them onto the app would
# produce. Anything set here would be a second home for those settings and
# would drift from the app's own. -exit YES is the documented blocking form,
# so the app quits when the batch is done instead of sitting open.
#
# The app works in place, subject to its own Preferences — if "Move original
# to Trash" or a Destination folder is set there, that is what happens here
# too. Change it in Optimage, not in this file.

# Sum the byte sizes of the NUL-separated paths on stdin, in one pass.
step5_optimage_total_bytes() {
  xargs -0 stat -f %z 2>/dev/null | awk '{ t += $1 } END { printf "%d", t + 0 }'
}

step_optimage_compress() {
  local optimage
  local files=() batch=()
  local file
  local i total progress=0
  local batch_size failed=0 batches=0
  local before_bytes=0 after_bytes=0 saved_bytes=0

  if ! optimage="$(find_optimage_command)"; then
    log_err "Optimage not found at ${STEP5_OPTIMAGE_BIN}."
    return 1
  fi

  # Absolute paths, deliberately. Handed a relative path, Optimage silently
  # leaves the file untouched and still exits 0, so a whole run reports success
  # and compresses nothing. Every other step in this script works in "./x"
  # form, which is exactly the shape that fails here.
  while IFS= read -r -d '' file; do
    files+=("${PWD}/${file#./}")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.webp" \
                  -o -iname "*.heic" -o -iname "*.heif" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.bmp" \
                  -o -iname "*.tga" -o -iname "*.svg" -o -iname "*.pdf" -o -iname "*.ico" -o -iname "*.icns" \
                  -o -iname "*.mp4" -o -iname "*.m4v" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.webm" \
                  -o -iname "*.mpg" -o -iname "*.mpeg" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No Optimage-supported files found."
    return 0
  fi

  batch_size="$STEP5_OPTIMAGE_BATCH"
  if ! is_int "$batch_size" || [[ "$batch_size" -lt 1 ]]; then batch_size=200; fi

  before_bytes="$(printf "%s\0" "${files[@]}" | step5_optimage_total_bytes)"

  log_info "Compressing $total file(s) with Optimage at its own settings."
  progress_draw "Step 5 Optimage" 0 "$total"

  for (( i=0; i<total; i+=batch_size )); do
    batch=("${files[@]:i:batch_size}")
    batches=$((batches + 1))
    if ! "$optimage" -exit YES "${batch[@]}" >/dev/null 2>&1; then
      failed=$((failed + 1))
      log_err "Optimage returned an error on batch ${batches}."
    fi
    progress=$(( i + ${#batch[@]} ))
    progress_draw "Step 5 Optimage" "$progress" "$total"
  done

  after_bytes="$(printf "%s\0" "${files[@]}" | step5_optimage_total_bytes)"
  saved_bytes=$(( before_bytes - after_bytes ))
  [[ "$saved_bytes" -lt 0 ]] && saved_bytes=0

  log_info "Step 5 Optimage summary:"
  summary_item "Files handed over" "$total"
  summary_item "Batches" "$batches"
  summary_item "Failed batches" "$failed"
  summary_item "Before" "$(human_size "$before_bytes")"
  summary_item "After" "$(human_size "$after_bytes")"
  summary_item "Approx. saved" "$(human_size "$saved_bytes")"
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
  if ! run_with_spinner "Step 1: quick-checking zero-byte files" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print -quit > "$2"' _ "$bucket_root" "$pre_zero_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 1 pre-check failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 1: quick-checking empty folders" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print -quit > "$2"' _ "$bucket_root" "$pre_empty_tmp"; then
    rm -f "$pre_zero_tmp" "$pre_empty_tmp"
    log_err "Step 1 pre-check failed (empty folder scan)."
    exit 1
  fi
  first_zero="$(cat "$pre_zero_tmp" 2>/dev/null || true)"
  first_empty="$(cat "$pre_empty_tmp" 2>/dev/null || true)"
  rm -f "$pre_zero_tmp" "$pre_empty_tmp"
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Quick scan complete."
  if [[ -z "$first_zero" && -z "$first_empty" ]]; then
    log_info "No 0-byte files or empty folders found. Nothing to quarantine."
    return 0
  fi

  list_zero_tmp="$(mktemp)"
  list_empty_tmp="$(mktemp)"
  if ! run_with_spinner "Step 1: scanning zero-byte files recursively" bash -c 'find . -path "$1" -prune -o -type f -size 0 -print0 > "$2"' _ "$bucket_root" "$list_zero_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 1 scan failed (zero-byte file scan)."
    exit 1
  fi
  if ! run_with_spinner "Step 1: scanning empty folders recursively" bash -c 'find . -path "$1" -prune -o -mindepth 1 -type d -empty -print0 > "$2"' _ "$bucket_root" "$list_empty_tmp"; then
    rm -f "$list_zero_tmp" "$list_empty_tmp"
    log_err "Step 1 scan failed (empty folder scan)."
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

  # Keep only top-most empty directories so nested empties are quarantined with parents.
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
    progress_draw "Step 1 Filter" "$progress" "$empty_dir_count"
  done
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Top-level empty folders selected."

  total=$(( zero_file_count + selected_dir_count ))
  log_info "Quarantining ${zero_file_count} zero-byte file(s) and ${selected_dir_count} empty folder(s)."
  log_info "Bucket folder: ${bucket_root}"
  mkdir -p "$bucket_root/zero_size_files" "$bucket_root/empty_folders"

  progress=0
  for ((i=0; i<zero_file_count; i++)); do
    file="${zero_files[$i]}"
    if move_item_into_bucket "$file" "$bucket_root" "zero_size_files"; then
      moved_files=$((moved_files + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to quarantine file: $file"
    fi
    progress=$((progress + 1))
    progress_draw "Step 1 Empty items" "$progress" "$total"
  done

  for ((i=0; i<selected_dir_count; i++)); do
    dir="${selected_empty_dirs[$i]}"
    if [[ ! -d "$dir" ]]; then
      # Might have become non-existent after parent quarantine; count it.
      moved_dirs=$((moved_dirs + 1))
      progress=$((progress + 1))
      progress_draw "Step 1 Empty items" "$progress" "$total"
      continue
    fi
    if move_item_into_bucket "$dir" "$bucket_root" "empty_folders"; then
      moved_dirs=$((moved_dirs + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to quarantine folder: $dir"
    fi
    progress=$((progress + 1))
    progress_draw "Step 1 Empty items" "$progress" "$total"
  done

  log_info "Step 1 empty-item summary:"
  summary_item "Zero-byte files quarantined" "$moved_files"
  summary_item "Empty folders quarantined" "$moved_dirs"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
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
    \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
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
      progress_draw "Step 2 Sanitize" "$progress" "$total"
      continue
    fi

    if [[ -e "$target" ]]; then
      failed=$((failed + 1))
      log_err "Rename skipped (target exists): $path -> $target"
      progress=$((progress + 1))
      progress_draw "Step 2 Sanitize" "$progress" "$total"
      continue
    fi

    if mv "$path" "$target"; then
      renamed=$((renamed + 1))
    else
      failed=$((failed + 1))
      log_err "Rename failed: $path"
    fi

    progress=$((progress + 1))
    progress_draw "Step 2 Sanitize" "$progress" "$total"
  done

  log_info "Step 2 sanitization summary:"
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
        log_err "Folder combine quarantine failed: $d"
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
  printf "  - Folders quarantined: %d\n" "$folders_moved"
  printf "  - Failed quarantines:  %d\n" "$folders_failed"
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

  if ! run_with_spinner "Step 1: scanning similar images with czkawka" "$czkawka_cmd" image \
      -d "$PWD" -e "$bucket_root_abs" -x IMAGE \
      -c "$CZKAWKA_IMAGE_HASH_SIZE" -g "$CZKAWKA_IMAGE_HASH_ALG" \
      -z "$CZKAWKA_IMAGE_FILTER" -s "$CZKAWKA_IMAGE_MAX_DIFF" \
      -f "$image_report" -W -N; then
    rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
    log_err "Czkawka image scan failed."
    exit 1
  fi
  phase=$((phase + 1))
  phase_note "$phase" "$phase_total" "Image similarity scan complete."

  if ! run_with_spinner "Step 1: scanning similar videos with czkawka" "$czkawka_cmd" video \
      -d "$PWD" -e "$bucket_root_abs" -x VIDEO \
      -t "$CZKAWKA_VIDEO_TOLERANCE" -A "$CZKAWKA_VIDEO_SCAN_DURATION" \
      -f "$video_report" -W -N; then
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
  phase_note "$phase" "$phase_total" "Ranked similar groups and planned quarantines."

  if [[ "$total_planned_moves" -eq 0 ]]; then
    rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
    log_info "No similar media files selected for quarantine."
    phase=$((phase + 1))
    phase_note "$phase" "$phase_total" "No similar-media quarantines were needed."
    return 0
  fi

  mkdir -p "$bucket_root/similar_images" "$bucket_root/similar_videos"
  log_info "Quarantining similar media into: $bucket_root"

  progress=0
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if [[ ! -e "$rel" ]]; then
      missing=$((missing + 1))
      progress=$((progress + 1))
      progress_draw "Step 1 Similar" "$progress" "$total_planned_moves"
      continue
    fi

    if is_video_media_ext "$rel"; then
      subdir="similar_videos"
    elif is_image_media_ext "$rel"; then
      subdir="similar_images"
    else
      missing=$((missing + 1))
      progress=$((progress + 1))
      progress_draw "Step 1 Similar" "$progress" "$total_planned_moves"
      continue
    fi

    if move_item_into_bucket "$rel" "$bucket_root" "$subdir"; then
      moved=$((moved + 1))
    else
      failed=$((failed + 1))
      log_err "Failed to quarantine similar media: $rel"
    fi

    progress=$((progress + 1))
    progress_draw "Step 1 Similar" "$progress" "$total_planned_moves"
  done < "$filtered_move_list"

  rm -f "$image_report" "$video_report" "$keep_list" "$move_list" "$filtered_move_list"
  log_info "Step 1 similar-media summary:"
  summary_item "Image groups found" "$image_groups"
  summary_item "Video groups found" "$video_groups"
  summary_item "Keepers selected" "$(( image_keep + video_keep ))"
  summary_item "Quarantine candidates" "$total_move_candidates"
  summary_item "Skipped keep conflicts" "$skipped_keep_conflicts"
  summary_item "Files quarantined" "$moved"
  summary_item "Missing or skipped" "$missing"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
}

choose_step8_trim_seconds() {
  local seconds
  ui_section "STEP 6 OPTIONS  -  TRIM VIDEO STARTS"
  read -r -p "$(ui_prompt 'Trim how many seconds from start of each video? [10]')" seconds
  seconds="${seconds:-10}"
  while ! is_number "$seconds"; do
    log_warn "Please enter a valid number of seconds (example: 10 or 3.5)."
    read -r -p "$(ui_prompt 'Trim how many seconds from start of each video? [10]')" seconds
    seconds="${seconds:-10}"
  done
  if awk -v s="$seconds" 'BEGIN { exit !(s > 0) }'; then
    STEP8_TRIM_SECONDS="$seconds"
  else
    STEP8_TRIM_SECONDS="10"
    log_warn "Value must be greater than 0. Using default 10 seconds."
  fi
  log_info "Step 6 trim-start amount set to ${STEP8_TRIM_SECONDS}s."
}

choose_step9_trim_end_seconds() {
  local seconds
  ui_section "STEP 7 OPTIONS  -  TRIM VIDEO ENDS"
  read -r -p "$(ui_prompt 'Trim how many seconds from end of each video? [10]')" seconds
  seconds="${seconds:-10}"
  while ! is_number "$seconds"; do
    log_warn "Please enter a valid number of seconds (example: 10 or 3.5)."
    read -r -p "$(ui_prompt 'Trim how many seconds from end of each video? [10]')" seconds
    seconds="${seconds:-10}"
  done
  if awk -v s="$seconds" 'BEGIN { exit !(s > 0) }'; then
    STEP9_TRIM_END_SECONDS="$seconds"
  else
    STEP9_TRIM_END_SECONDS="10"
    log_warn "Value must be greater than 0. Using default 10 seconds."
  fi
  log_info "Step 7 trim-end amount set to ${STEP9_TRIM_END_SECONDS}s."
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
      progress_draw "Step 6 Trim Start" "$progress" "$total"
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
      progress_draw "Step 6 Trim Start" "$progress" "$total"
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
      progress_draw "Step 6 Trim Start" "$progress" "$total"
  done

  log_info "Step 6 trim-start summary:"
  summary_item "Trim seconds" "${STEP8_TRIM_SECONDS}s"
  summary_item "Files trimmed" "$trimmed"
  summary_item "Approximate trims" "$approximate"
  summary_item "Skipped (too short)" "$skipped_short"
  summary_item "Failed" "$failed"
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
      progress_draw "Step 7 Trim End" "$progress" "$total"
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
      progress_draw "Step 7 Trim End" "$progress" "$total"
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
    progress_draw "Step 7 Trim End" "$progress" "$total"
  done

  log_info "Step 7 trim-end summary:"
  summary_item "Trim seconds" "${STEP9_TRIM_END_SECONDS}s"
  summary_item "Files trimmed" "$trimmed"
  summary_item "Approximate trims" "$approximate"
  summary_item "Skipped (too short)" "$skipped_short"
  summary_item "Failed" "$failed"
}

# Byte size of a file (0 if it cannot be read).
file_size() {
  stat -f%z "$1" 2>/dev/null || printf "0"
}

# Human-readable byte count for summaries.
human_size() {
  local b="${1:-0}"
  if ! is_int "$b"; then
    printf "n/a"
    return
  fi
  awk -v b="$b" 'BEGIN {
    split("B KB MB GB TB", u, " ");
    i = 1;
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    if (i == 1) printf "%d %s", b, u[i]; else printf "%.1f %s", b, u[i]
  }'
}

# Offer to install cwebp (Homebrew formula: webp) for the WebP recompress path.
ensure_cwebp_ready() {
  local ans
  if command -v cwebp >/dev/null 2>&1; then
    return 0
  fi
  ui_section "CWEBP REQUIRED"
  printf "   WebP recompression needs the 'cwebp' tool (Homebrew formula: webp).\n"
  read -r -p "$(ui_prompt 'Install cwebp via Homebrew now? [Y/n]')" ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log_err "Cannot run WebP recompression without cwebp."
    return 1
  fi
  load_homebrew_env || true
  if ! command -v brew >/dev/null 2>&1; then
    log_err "Homebrew not available; cannot install cwebp."
    return 1
  fi
  brew install webp || return 1
  load_homebrew_env || true
  command -v cwebp >/dev/null 2>&1
}

# Offer to install the AVIF encode chain: avifenc (Homebrew formula: libavif)
# and magick (formula: imagemagick).
ensure_avif_tools_ready() {
  local ans label formula
  local missing_labels=()
  local missing_formulas=()

  if ! command -v avifenc >/dev/null 2>&1; then
    missing_labels+=("avifenc (Homebrew formula: libavif)")
    missing_formulas+=("libavif")
  fi
  if ! find_magick_command >/dev/null 2>&1; then
    missing_labels+=("magick (Homebrew formula: imagemagick)")
    missing_formulas+=("imagemagick")
  fi

  if [[ "${#missing_labels[@]}" -eq 0 ]]; then
    return 0
  fi

  ui_section "AVIF ENCODER REQUIRED"
  printf "   AVIF recompression needs a Lanczos resizer and the libaom encoder.\n"
  for label in "${missing_labels[@]+"${missing_labels[@]}"}"; do
    printf "   %s%s%s %s\n" "$C_YELLOW" "$G_BULL" "$C_RESET" "$label"
  done
  read -r -p "$(ui_prompt 'Install missing AVIF tools via Homebrew now? [Y/n]')" ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log_err "Cannot run AVIF recompression without avifenc and magick."
    return 1
  fi

  load_homebrew_env || true
  if ! command -v brew >/dev/null 2>&1; then
    log_err "Homebrew not available; cannot install AVIF tools."
    return 1
  fi

  for formula in "${missing_formulas[@]+"${missing_formulas[@]}"}"; do
    if brew list --formula "$formula" >/dev/null 2>&1; then
      log_info "Formula already installed: $formula"
      continue
    fi
    log_info "Installing $formula via Homebrew..."
    brew install "$formula" || return 1
  done

  load_homebrew_env || true
  if ! command -v avifenc >/dev/null 2>&1 || ! find_magick_command >/dev/null 2>&1; then
    log_err "AVIF tools are still missing after install."
    return 1
  fi
  return 0
}

avif_resize_geometry() {
  if [[ "${MAX_MEDIA_PIXELS:-0}" -gt 0 ]]; then
    printf "%s@>" "$MAX_MEDIA_PIXELS"
  else
    printf "x%s>" "$MAX_MEDIA_HEIGHT"
  fi
}

# Two-stage AVIF encode. ImageMagick does a Lanczos3 shrink-only resize, then
# avifenc/libaom does the compression; the PNG hand-off exists because avifenc
# has no scaler of its own.
encode_image_to_avif() {
  local src="$1"
  local dst="$2"
  local magick_cmd stage rc=0 resize_geometry
  local sharp_flag=()
  # At the slow pace each encode owns the machine, which is what "all" means.
  # Under the ultra pool it has to be told its share, or every one of N jobs
  # spawns a core's worth of threads and they spend the run fighting.
  local avif_jobs="all"
  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    avif_jobs="${STEP15_JOB_THREADS:-1}"
  fi

  magick_cmd="$(find_magick_command 2>/dev/null)" || return 1
  command -v avifenc >/dev/null 2>&1 || return 1
  [[ "$STEP12_AVIF_SHARPYUV" -eq 1 ]] && sharp_flag=(--sharpyuv)
  resize_geometry="$(avif_resize_geometry)"

  stage="$(mktemp "${TMPDIR:-/tmp}/local_gallery_avif.XXXXXX")"
  rm -f "$stage"
  stage="${stage}.png"

  if ! step15_run "$magick_cmd" "$src" -colorspace sRGB -filter Lanczos \
       -resize "$resize_geometry" -depth 8 -strip "$stage" >/dev/null 2>&1 \
     || [[ ! -s "$stage" ]]; then
    rm -f "$stage"
    return 1
  fi

  if ! avifenc -q "$STEP12_AVIF_QUALITY" -s "$STEP12_AVIF_SPEED" -y 420 -j "$avif_jobs" \
       --cicp 1/13/6 --range full \
       --ignore-exif --ignore-xmp --ignore-icc \
       "${sharp_flag[@]+"${sharp_flag[@]}"}" \
       "$stage" "$dst" >/dev/null 2>&1; then
    rc=1
  fi

  rm -f "$stage"
  return "$rc"
}

# Step 15 image half: re-encode still images to AVIF (default) or WebP.
# ── Step 15 pace ──────────────────────────────────────────────────────
# The step has always run one file at a time with the encoder free to take
# the whole machine. That is still the default, and is what "slow" means
# here. Ultra keeps several files in flight instead, each held to its share
# of the cores -- the same trade the VHS step makes, and for the same reason:
# these encoders do not thread far enough to fill a modern machine on their
# own, so the way to use it is to run more of them rather than to ask each
# one to try harder.

# Run one job under the ultra pace's thread budget. The tools that take their
# width from the environment rather than a flag are covered here; the ones
# with a flag (avifenc -j, libsvtav1 lp) are told directly at their call site.
step15_run() {
  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    env "MAGICK_THREAD_LIMIT=${STEP15_JOB_THREADS:-1}" \
        "OMP_NUM_THREADS=${STEP15_JOB_THREADS:-1}" \
        "RAYON_NUM_THREADS=${STEP15_JOB_THREADS:-1}" "$@"
  else
    "$@"
  fi
}

# How many files ultra keeps in flight. Both numbers were measured rather than
# reasoned about, on an M4 Pro (10 performance + 4 efficiency cores, 48 GB),
# by timing the real pipeline over a fixed set at every width:
#
#   images (24 x 4000x3000 PNG to AVIF)
#     slow 103.0s | 4 jobs 28.4s | 7 jobs 19.9s | 10 jobs 16.5s
#     *14 jobs 13.7s* | 16 jobs 16.4s | 18 jobs 17.5s
#
#   videos (28 x 4s 1080p to AV1)
#     slow 66.2s | 2 jobs 52.2s | 4 jobs 42.6s | 7 jobs ~31.5s
#     10 jobs ~34.5s | 14 jobs ~33s | 18 jobs ~29.6s | 22 jobs 29.9s
#
# The two halves do not have the same shape, and that is the whole finding.
#
# An image job is almost perfectly *serial* -- 4.10s of CPU for 4.27s of wall,
# because the Lanczos resize and avifenc between them do not thread far. So
# the right width is one job per logical core, efficiency cores counted in: a
# short single-threaded job on a slow core is still throughput. The peak sits
# exactly at the core count and the curve turns back up immediately after it,
# which is why this is a measured number and not "as many as possible".
#
# A video job does not behave that way, because SVT-AV1 already threads well
# on its own. Past about half the cores the curve simply goes *flat*: every
# width from 7 to 22 lands between 29.6s and 34.5s, a spread smaller than the
# run-to-run variance (repeat passes over the same widths moved by ~3s, and
# one contaminated pass by 20s). There is no peak to find, so the number to
# take is the narrowest width that reaches the plateau. Wider buys nothing
# measurable and costs memory and headroom.
#
# So: images win about 7.5x, videos about 2x. The asymmetry is real and is
# just how much each encoder was leaving on the table to begin with.
step15_ultra_jobs() {
  local kind="$1" jobs cores mem mem_cap override

  cores="$(machine_cpu_total)"
  mem="$(machine_mem_gb)"

  # The memory caps come from measured peak RSS per job -- 358 MB for an
  # image, 744 MB for a video -- budgeted at 1 GB and 2 GB so a 4K source has
  # room. On any machine with memory to match its cores neither cap binds;
  # they are here so a small one degrades instead of swapping.
  if [[ "$kind" == "video" ]]; then
    override="${STEP15_ULTRA_VIDEO_JOBS:-0}"
    jobs=$(( cores / 2 ))
    mem_cap=$(( mem / 2 ))
  else
    override="${STEP15_ULTRA_IMAGE_JOBS:-0}"
    jobs="$cores"
    mem_cap="$mem"
  fi

  if is_int "$override" && [[ "$override" -gt 0 ]]; then
    printf "%s" "$override"
    return 0
  fi

  # Two is the floor: an ultra that runs one file at a time is just slow.
  if [[ "$jobs" -lt 2 ]]; then jobs=2; fi
  if [[ "$mem_cap" -lt 2 ]]; then mem_cap=2; fi
  if [[ "$jobs" -gt "$mem_cap" ]]; then jobs="$mem_cap"; fi
  if [[ "$jobs" -gt "$STEP15_ULTRA_MAX_JOBS" ]]; then
    jobs="$STEP15_ULTRA_MAX_JOBS"
  fi
  printf "%s" "$jobs"
}

# Each job is told how many threads it may use, so the slots add up to the
# machine instead of every one of them trying to take the whole of it.
step15_ultra_threads() {
  local jobs="$1" cores threads
  cores="$(machine_cpu_total)"
  if ! is_int "$jobs" || [[ "$jobs" -lt 1 ]]; then
    jobs=1
  fi
  threads=$(( cores / jobs ))
  if [[ "$threads" -lt 1 ]]; then threads=1; fi
  printf "%s" "$threads"
}

choose_step15_pace() {
  local choice

  ui_section "STEP 15 OPTIONS  -  RECOMPRESS PACE"
  printf "   How should it run?\n"
  printf "   %2d  %s\n" 1 "Slow (one file at a time, the way it has always run)"
  printf "   %2d  %s\n" 2 "Ultra (several files at once, uses the whole computer)"
  read -r -p "$(ui_prompt 'Pace [1]')" choice
  choice="${choice:-1}"
  while true; do
    case "$choice" in
      1|s|S|slow|Slow|SLOW)
        STEP15_RECOMPRESS_PACE="slow"
        break
        ;;
      2|u|U|ultra|Ultra|ULTRA)
        STEP15_RECOMPRESS_PACE="ultra"
        break
        ;;
      *)
        log_warn "Choose 1 for slow or 2 for ultra."
        read -r -p "$(ui_prompt 'Pace [1]')" choice
        choice="${choice:-1}"
        ;;
    esac
  done

  if [[ "$STEP15_RECOMPRESS_PACE" == "ultra" ]]; then
    log_info "Step 15 will run ultra: $(step15_ultra_jobs image) pictures or $(step15_ultra_jobs video) videos at a time. The computer will be busy."
  else
    log_info "Step 15 will run slow: one file at a time."
  fi
}

# ── Step 15: one file's worth of work ─────────────────────────────────
# Each half's per-file work is a function that prints "<outcome> <bytes
# saved>" and nothing else, so the serial loop and the pool tally the same
# results the same way. A pool child cannot reach the parent's counters, and
# a second copy of the accounting is exactly how the two paces would come to
# disagree about what happened.

RC_CONVERTED=0
RC_NOGAIN=0
RC_SAME=0
RC_EXISTS=0
RC_FAILED=0
RC_PROBE=0
RC_AV1=0
RC_SAVED=0

recompress_reset_counters() {
  RC_CONVERTED=0
  RC_NOGAIN=0
  RC_SAME=0
  RC_EXISTS=0
  RC_FAILED=0
  RC_PROBE=0
  RC_AV1=0
  RC_SAVED=0
}

recompress_tally() {
  local line="$1" file="$2" outcome saved
  outcome="${line%% *}"
  saved="${line##* }"
  case "$outcome" in
    converted)
      RC_CONVERTED=$(( RC_CONVERTED + 1 ))
      if is_int "$saved"; then
        RC_SAVED=$(( RC_SAVED + saved ))
      fi
      ;;
    nogain) RC_NOGAIN=$(( RC_NOGAIN + 1 )) ;;
    same)   RC_SAME=$(( RC_SAME + 1 )) ;;
    exists) RC_EXISTS=$(( RC_EXISTS + 1 )) ;;
    av1)    RC_AV1=$(( RC_AV1 + 1 )) ;;
    probe)
      RC_PROBE=$(( RC_PROBE + 1 ))
      log_err "Video probe failed: $file"
      ;;
    *)
      RC_FAILED=$(( RC_FAILED + 1 ))
      log_err "Recompress failed: $file"
      ;;
  esac
}

recompress_image_one() {
  local file="$1" target="$2"
  local ext base out tmp oldsize newsize enc_ok=1

  ext=$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')
  base="${file%.*}"

  if [[ "$ext" == "$target" ]]; then
    printf "same 0"
    return 0
  fi

  out="${base}.${target}"
  if [[ -e "$out" && "$out" != "$file" ]]; then
    # A different file already owns the target name; don't clobber it.
    printf "exists 0"
    return 0
  fi

  # The temp name is derived from the file's own path, so two pool slots
  # working on different files can never pick the same one.
  tmp="${base}.recompress-tmp.$$.${target}"
  rm -f "$tmp"

  if [[ "$target" == "avif" ]]; then
    encode_image_to_avif "$file" "$tmp" || enc_ok=0
  else
    step15_run cwebp -quiet -q "$STEP12_WEBP_QUALITY" "$file" -o "$tmp" >/dev/null 2>&1 || enc_ok=0
  fi

  if [[ "$enc_ok" -ne 1 || ! -s "$tmp" ]]; then
    rm -f "$tmp"
    printf "failed 0"
    return 0
  fi

  oldsize=$(file_size "$file")
  newsize=$(file_size "$tmp")
  if is_int "$oldsize" && is_int "$newsize" && [[ "$newsize" -ge "$oldsize" ]]; then
    rm -f "$tmp"
    printf "nogain 0"
    return 0
  fi

  mv -f "$tmp" "$out"
  if [[ "$out" != "$file" ]]; then
    rm -f "$file"
  fi
  if is_int "$oldsize" && is_int "$newsize"; then
    printf "converted %s" "$(( oldsize - newsize ))"
  else
    printf "converted 0"
  fi
  return 0
}

recompress_encode_av1() {
  local src="$1" dst="$2"
  local width=()
  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    # SVT-AV1 takes its width from lp (level of parallelism); left alone it
    # opens the whole machine per job, which is the thing the pool exists to
    # stop. -threads covers ffmpeg's own filter and mux side.
    width=(-threads "${STEP15_JOB_THREADS:-1}" -svtav1-params "lp=${STEP15_JOB_THREADS:-1}")
  fi
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$src" -map 0:v:0 -map 0:a? \
    -c:v libsvtav1 -crf "$STEP14_AV1_CRF" -preset "$STEP14_AV1_PRESET" \
    "${width[@]+"${width[@]}"}" \
    -c:a libopus -b:a 96k -movflags +faststart "$dst" >/dev/null 2>&1
}

recompress_video_one() {
  local file="$1"
  local base out tmp codec oldsize newsize

  base="${file%.*}"
  out="${base}.mp4"

  if ! codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
    -of csv=p=0 "$file" 2>/dev/null | head -n 1) || [[ -z "$codec" ]]; then
    printf "probe 0"
    return 0
  fi
  if [[ "$codec" == "av1" ]]; then
    printf "av1 0"
    return 0
  fi
  if [[ -e "$out" && "$out" != "$file" ]]; then
    printf "exists 0"
    return 0
  fi

  tmp="${base}.av1-tmp.$$.mp4"
  rm -f "$tmp"
  if ! recompress_encode_av1 "$file" "$tmp" || [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    printf "failed 0"
    return 0
  fi

  oldsize=$(file_size "$file")
  newsize=$(file_size "$tmp")
  if is_int "$oldsize" && is_int "$newsize" && [[ "$newsize" -ge "$oldsize" ]]; then
    rm -f "$tmp"
    printf "nogain 0"
    return 0
  fi

  mv -f "$tmp" "$out"
  if [[ "$out" != "$file" ]]; then
    rm -f "$file"
  fi
  if is_int "$oldsize" && is_int "$newsize"; then
    printf "converted %s" "$(( oldsize - newsize ))"
  else
    printf "converted 0"
  fi
  return 0
}

# Ultra pace: keep several files in flight at once.
#
# Bash 3.2 (the macOS system bash this may run under) has no `wait -n`, so the
# pool is polled rather than woken: each slot holds one child pid and a status
# file the child writes its result line into, since a child cannot reach the
# parent's counters. A child that dies without writing one is counted as a
# failure, which is what an out-of-memory kill looks like from here. Unlike
# step 12's pool the slots need no scratch folder of their own -- every temp
# file here is named after the source file, so they cannot collide.
step15_run_pool() {
  local kind="$1" jobs="$2" target="$3" workdir="$4" label="$5"
  shift 5
  local files=( "$@" )
  local count=${#files[@]}
  local next=0 finished=0 reaped slot pid file statusfile line
  local pids=() slotfiles=()

  if [[ "$count" -eq 0 ]]; then
    return 0
  fi

  # No point opening more slots than there are files to put in them.
  if [[ "$jobs" -gt "$count" ]]; then
    jobs="$count"
  fi
  if [[ "$jobs" -lt 1 ]]; then
    jobs=1
  fi
  STEP15_JOB_THREADS="$(step15_ultra_threads "$jobs")"

  for (( slot=0; slot<jobs; slot++ )); do
    pids[$slot]=0
    slotfiles[$slot]=""
  done

  while [[ "$finished" -lt "$count" ]]; do
    for (( slot=0; slot<jobs; slot++ )); do
      if [[ "${pids[$slot]}" -ne 0 ]]; then
        continue
      fi
      if [[ "$next" -ge "$count" ]]; then
        break
      fi
      file="${files[$next]}"
      next=$(( next + 1 ))
      statusfile="${workdir}/status${slot}"
      rm -f "$statusfile"
      (
        if [[ "$kind" == "video" ]]; then
          recompress_video_one "$file" > "$statusfile"
        else
          recompress_image_one "$file" "$target" > "$statusfile"
        fi
        exit 0
      ) >/dev/null 2>&1 &
      pids[$slot]=$!
      slotfiles[$slot]="$file"
    done

    reaped=0
    for (( slot=0; slot<jobs; slot++ )); do
      pid="${pids[$slot]}"
      if [[ "$pid" -eq 0 ]]; then
        continue
      fi
      if kill -0 "$pid" 2>/dev/null; then
        continue
      fi
      wait "$pid" >/dev/null 2>&1 || true
      statusfile="${workdir}/status${slot}"
      line="failed 0"
      if [[ -s "$statusfile" ]]; then
        line="$(cat "$statusfile" 2>/dev/null || printf "failed 0")"
      fi
      recompress_tally "$line" "${slotfiles[$slot]}"
      pids[$slot]=0
      slotfiles[$slot]=""
      finished=$(( finished + 1 ))
      reaped=1
      progress_draw "$label" "$finished" "$count"
    done

    if [[ "$reaped" -eq 0 && "$finished" -lt "$count" ]]; then
      sleep 0.2
    fi
  done

  return 0
}

step11_recompress_images() {
  local files=()
  local file target workdir jobs=1
  local i total progress=0

  set_resize_limit_from_displays
  target="$STEP12_IMAGE_FORMAT"
  recompress_reset_counters

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \
                      -o -iname "*.bmp" -o -iname "*.tif" -o -iname "*.tiff" \
                      -o -iname "*.webp" -o -iname "*.avif" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No images found to recompress."
    return 0
  fi

  if [[ "$target" == "avif" ]]; then
    log_info "Recompressing $total image(s) to AVIF (Lanczos3 shrink-only, quality ${STEP12_AVIF_QUALITY}, speed ${STEP12_AVIF_SPEED}). Originals are replaced only when smaller."
  else
    log_info "Recompressing $total image(s) to ${target} (quality ${STEP12_WEBP_QUALITY}). Originals are replaced only when smaller."
  fi

  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    jobs="$(step15_ultra_jobs image)"
    log_info "Ultra pace: ${jobs} picture(s) at a time."
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_recompress.XXXXXX")"
    step15_run_pool image "$jobs" "$target" "$workdir" "Step 15 Recompress" "${files[@]}"
    rm -rf "$workdir"
  else
    for (( i=0; i<total; i++ )); do
      file="${files[$i]}"
      recompress_tally "$(recompress_image_one "$file" "$target")" "$file"
      progress=$((progress + 1))
      progress_draw "Step 15 Recompress" "$progress" "$total"
    done
  fi

  log_info "Step 15 recompress summary:"
  summary_item "Format" "$target"
  if [[ "$target" == "avif" ]]; then
    summary_item "Encoder" "avifenc q${STEP12_AVIF_QUALITY} s${STEP12_AVIF_SPEED} 4:2:0"
    if [[ "${MAX_MEDIA_PIXELS:-0}" -gt 0 ]]; then
      summary_item "Resize limit" "${MAX_MEDIA_PIXELS} pixels"
    else
      summary_item "Resize filter" "Lanczos3 (max ${MAX_MEDIA_HEIGHT}px)"
    fi
  fi
  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    summary_item "Pace" "ultra (${jobs} at a time)"
  else
    summary_item "Pace" "slow"
  fi
  summary_item "Converted" "$RC_CONVERTED"
  summary_item "No size gain (kept)" "$RC_NOGAIN"
  summary_item "Already ${target}" "$RC_SAME"
  summary_item "Name conflict (kept)" "$RC_EXISTS"
  summary_item "Failed" "$RC_FAILED"
  summary_item "Approx. saved" "$(human_size "$RC_SAVED")"
}

# GIF-to-MP4 sub-pass of the video conversion step (no longer a standalone
# menu step). Animated GIFs become muted MP4; static GIFs are left alone.
convert_gifs_to_mp4() {
  local files=()
  local file base out tmp frames oldsize newsize enc_ok
  local i total progress=0
  local converted=0 skipped_static=0 nogain=0 skipped_existing=0 failed=0
  local saved_bytes=0

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find . -type f -iname "*.gif" -print0)

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No GIF files found."
    return 0
  fi

  log_info "Evaluating $total GIF(s). Animated GIFs become muted MP4; static GIFs are skipped."

  for (( i=0; i<total; i++ )); do
    file="${files[$i]}"
    base="${file%.*}"
    out="${base}.mp4"

    frames=$(ffprobe -v error -select_streams v:0 -count_frames \
      -show_entries stream=nb_read_frames -of csv=p=0 "$file" 2>/dev/null | head -n 1)
    if ! is_int "$frames" || [[ "$frames" -le 1 ]]; then
      skipped_static=$((skipped_static + 1))
      progress=$((progress + 1))
      progress_draw "Step 3 GIF-MP4" "$progress" "$total"
      continue
    fi

    if [[ -e "$out" ]]; then
      skipped_existing=$((skipped_existing + 1))
      progress=$((progress + 1))
      progress_draw "Step 3 GIF-MP4" "$progress" "$total"
      continue
    fi

    tmp="${base}.gifconv-tmp.$$.mp4"
    rm -f "$tmp"
    enc_ok=1
    ffmpeg -hide_banner -loglevel error -y -i "$file" \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -pix_fmt yuv420p \
      -c:v libx264 -crf 23 -preset medium -an -movflags +faststart "$tmp" >/dev/null 2>&1 || enc_ok=0

    if [[ "$enc_ok" -ne 1 || ! -s "$tmp" ]]; then
      rm -f "$tmp"
      failed=$((failed + 1))
      log_err "GIF conversion failed: $file"
      progress=$((progress + 1))
      progress_draw "Step 3 GIF-MP4" "$progress" "$total"
      continue
    fi

    oldsize=$(file_size "$file")
    newsize=$(file_size "$tmp")
    if is_int "$oldsize" && is_int "$newsize" && [[ "$newsize" -ge "$oldsize" ]]; then
      rm -f "$tmp"
      nogain=$((nogain + 1))
      progress=$((progress + 1))
      progress_draw "Step 3 GIF-MP4" "$progress" "$total"
      continue
    fi

    mv -f "$tmp" "$out"
    rm -f "$file"
    if is_int "$oldsize" && is_int "$newsize"; then
      saved_bytes=$(( saved_bytes + oldsize - newsize ))
    fi
    converted=$((converted + 1))
    progress=$((progress + 1))
    progress_draw "Step 3 GIF-MP4" "$progress" "$total"
  done

  log_info "Step 3 GIF conversion summary:"
  summary_item "Converted to MP4" "$converted"
  summary_item "Static (skipped)" "$skipped_static"
  summary_item "No size gain (kept)" "$nogain"
  summary_item "MP4 exists (skipped)" "$skipped_existing"
  summary_item "Failed" "$failed"
  summary_item "Approx. saved" "$(human_size "$saved_bytes")"
}

video_unique_frame_count_after_decimate() {
  local file="$1"
  local count

  if ! count="$(ffmpeg -hide_banner -nostats -loglevel error -i "$file" -map 0:v:0 \
      -vf mpdecimate -an -f null - -progress pipe:1 2>/dev/null \
      | awk -F= '/^frame=/{v=$2} END{if (v ~ /^[0-9]+$/) print v}')"; then
    return 1
  fi
  if ! is_int "$count"; then
    return 1
  fi
  printf "%s" "$count"
}

video_is_single_frame_or_static() {
  local file="$1"
  local frames unique_frames

  frames="$(ffprobe -v error -select_streams v:0 -count_frames \
    -show_entries stream=nb_read_frames -of csv=p=0 "$file" 2>/dev/null | head -n 1 || true)"
  if is_int "$frames" && [[ "$frames" -le 1 ]]; then
    return 0
  fi

  if ! unique_frames="$(video_unique_frame_count_after_decimate "$file")"; then
    return 2
  fi
  if [[ "$unique_frames" -le 1 ]]; then
    return 0
  fi
  return 1
}

media_first_frame_hash() {
  local file="$1"
  local hash

  hash="$(ffmpeg -hide_banner -loglevel error -i "$file" -map 0:v:0 -frames:v 1 \
    -vf "format=rgb24,scale=16:16:flags=area,format=gray" -f framehash -hash MD5 - 2>/dev/null \
    | awk -F, '/^[0-9]/{gsub(/[[:space:]]/, "", $NF); print $NF; exit}' || true)"
  if [[ -z "$hash" ]]; then
    return 1
  fi
  printf "%s" "$hash"
}

append_video_frame_hashes() {
  local file="$1"
  local output_file="$2"

  ffmpeg -hide_banner -loglevel error -i "$file" -map 0:v:0 \
    -vf "format=rgb24,scale=16:16:flags=area,format=gray" -an -f framehash -hash MD5 - 2>/dev/null \
    | awk -F, '/^[0-9]/{gsub(/[[:space:]]/, "", $NF); if ($NF != "") print $NF}' >> "$output_file"
}

quarantine_video_frame_images() {
  local bucket_root="./${SIMILAR_ITEMS_BUCKET_NAME}"
  local empty_bucket_root="./${EMPTY_ITEMS_BUCKET_NAME}"
  local videos=()
  local images=()
  local video image hash
  local video_hashes video_hashes_sorted
  local i total progress=0
  local scanned_videos=0 video_probe_failed=0 frame_hashes=0
  local quarantined=0 kept=0 unreadable=0 failed=0

  while IFS= read -r -d '' video; do
    videos+=("$video")
  done < <(
    find . \
      \( -path "$bucket_root" -o -path "$empty_bucket_root" \) -prune -o \
      -type f \( -iname "*.mp4" -o -iname "*.m4v" -o -iname "*.mov" -o -iname "*.wmv" \
                 -o -iname "*.flv" -o -iname "*.avi" -o -iname "*.webm" -o -iname "*.mkv" \
                 -o -iname "*.mpg" -o -iname "*.mpeg" -o -iname "*.3gp" -o -iname "*.m2ts" \
                 -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  while IFS= read -r -d '' image; do
    images+=("$image")
  done < <(
    find . \
      \( -path "$bucket_root" -o -path "$empty_bucket_root" \) -prune -o \
      -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \
                 -o -iname "*.bmp" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \
                 -o -iname "*.heif" -o -iname "*.avif" \) -print0
  )

  if [[ "${#videos[@]}" -eq 0 || "${#images[@]}" -eq 0 ]]; then
    log_warn "No videos or still images found for video-frame image quarantine."
    return 0
  fi

  video_hashes="$(mktemp)"
  video_hashes_sorted="$(mktemp)"
  : > "$video_hashes"

  log_info "Indexing frames from ${#videos[@]} video file(s)."
  for (( i=0; i<${#videos[@]}; i++ )); do
    video="${videos[$i]}"
    if append_video_frame_hashes "$video" "$video_hashes"; then
      scanned_videos=$((scanned_videos + 1))
    else
      video_probe_failed=$((video_probe_failed + 1))
    fi
    progress=$((progress + 1))
    progress_draw "Step 9 Video index" "$progress" "${#videos[@]}"
  done

  sort -u "$video_hashes" > "$video_hashes_sorted"
  frame_hashes="$(wc -l < "$video_hashes_sorted" | tr -d ' ')"
  if ! is_int "$frame_hashes"; then frame_hashes=0; fi
  if [[ "$frame_hashes" -eq 0 ]]; then
    rm -f "$video_hashes" "$video_hashes_sorted"
    log_warn "No readable video frames found for image comparison."
    return 0
  fi

  log_info "Comparing ${#images[@]} still image file(s) against ${frame_hashes} video frame hash(es)."
  mkdir -p "$bucket_root/video_frame_images"

  progress=0
  total=${#images[@]}
  for (( i=0; i<total; i++ )); do
    image="${images[$i]}"
    if ! hash="$(media_first_frame_hash "$image")"; then
      unreadable=$((unreadable + 1))
    elif grep -F -x -q -- "$hash" "$video_hashes_sorted"; then
      if move_item_into_bucket "$image" "$bucket_root" "video_frame_images"; then
        quarantined=$((quarantined + 1))
      else
        failed=$((failed + 1))
        log_err "Failed to quarantine video-frame image: $image"
      fi
    else
      kept=$((kept + 1))
    fi
    progress=$((progress + 1))
    progress_draw "Step 9 Frame images" "$progress" "$total"
  done

  rm -f "$video_hashes" "$video_hashes_sorted"
  log_info "Step 9 video-frame image quarantine summary:"
  summary_item "Videos indexed" "$scanned_videos"
  summary_item "Video probe failed" "$video_probe_failed"
  summary_item "Images quarantined" "$quarantined"
  summary_item "Images kept" "$kept"
  summary_item "Unreadable images" "$unreadable"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
}

quarantine_single_frame_videos() {
  local bucket_root="./${SIMILAR_ITEMS_BUCKET_NAME}"
  local empty_bucket_root="./${EMPTY_ITEMS_BUCKET_NAME}"
  local files=()
  local file
  local i total progress=0
  local quarantined=0 kept_animated=0 unreadable=0 failed=0
  local rc

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . \
      \( -path "$bucket_root" -o -path "$empty_bucket_root" \) -prune -o \
      -type f \( -iname "*.mp4" -o -iname "*.m4v" -o -iname "*.mov" -o -iname "*.wmv" \
                 -o -iname "*.flv" -o -iname "*.avi" -o -iname "*.webm" -o -iname "*.mkv" \
                 -o -iname "*.mpg" -o -iname "*.mpeg" -o -iname "*.3gp" -o -iname "*.m2ts" \
                 -o -iname "*.vob" -o -iname "*.ogv" -o -iname "*.gifv" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No video files found for static-video quarantine."
    return 0
  fi

  log_info "Checking $total video file(s) for single-frame/no-animation content."
  mkdir -p "$bucket_root/single_frame_videos"

  for (( i=0; i<total; i++ )); do
    file="${files[$i]}"
    rc=0
    video_is_single_frame_or_static "$file" || rc=$?
    case "$rc" in
      0)
        if move_item_into_bucket "$file" "$bucket_root" "single_frame_videos"; then
          quarantined=$((quarantined + 1))
        else
          failed=$((failed + 1))
          log_err "Failed to quarantine static video: $file"
        fi
        ;;
      1)
        kept_animated=$((kept_animated + 1))
        ;;
      *)
        unreadable=$((unreadable + 1))
        ;;
    esac
    progress=$((progress + 1))
    progress_draw "Step 9 Static videos" "$progress" "$total"
  done

  log_info "Step 9 static-video quarantine summary:"
  summary_item "Videos quarantined" "$quarantined"
  summary_item "Animated/kept" "$kept_animated"
  summary_item "Unreadable" "$unreadable"
  summary_item "Failed" "$failed"
  summary_item "Bucket" "$bucket_root"
}

step13_quarantine_static_media() {
  quarantine_video_frame_images
  quarantine_single_frame_videos
}

# Combined recompression pass: still images to AVIF/WebP, then videos to AV1.
step_recompress_media() {
  step11_recompress_images
  step13_reencode_videos_av1
}

# Step 15 video half: re-encode videos to AV1 (libsvtav1) with Opus audio in an
# MP4 container. Already-AV1 videos are skipped; originals are replaced only
# when the AV1 version is smaller.
step13_reencode_videos_av1() {
  local files=()
  local file workdir jobs=1
  local i total progress=0

  recompress_reset_counters

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
       -o -path "./${VHS_TEST_FOLDER_NAME}" \) -prune -o \
      -type f \( -iname "*.mp4" -o -iname "*.m4v" -o -iname "*.mov" \
                      -o -iname "*.mkv" -o -iname "*.webm" -o -iname "*.avi" \) -print0
  )

  total=${#files[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No videos found to re-encode."
    return 0
  fi

  log_info "Re-encoding $total video(s) to AV1 (CRF ${STEP14_AV1_CRF}, preset ${STEP14_AV1_PRESET}). Originals replaced only when smaller."

  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    jobs="$(step15_ultra_jobs video)"
    log_info "Ultra pace: ${jobs} video(s) at a time."
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_av1.XXXXXX")"
    step15_run_pool video "$jobs" "" "$workdir" "Step 15 AV1" "${files[@]}"
    rm -rf "$workdir"
  else
    for (( i=0; i<total; i++ )); do
      file="${files[$i]}"
      recompress_tally "$(recompress_video_one "$file")" "$file"
      progress=$((progress + 1))
      progress_draw "Step 15 AV1" "$progress" "$total"
    done
  fi

  log_info "Step 15 AV1 re-encode summary:"
  if [[ "${STEP15_RECOMPRESS_PACE:-slow}" == "ultra" ]]; then
    summary_item "Pace" "ultra (${jobs} at a time)"
  else
    summary_item "Pace" "slow"
  fi
  summary_item "Re-encoded" "$RC_CONVERTED"
  summary_item "Already AV1" "$RC_AV1"
  summary_item "Probe failed" "$RC_PROBE"
  summary_item "No size gain (kept)" "$RC_NOGAIN"
  summary_item "Name conflict (kept)" "$RC_EXISTS"
  summary_item "Failed" "$RC_FAILED"
  summary_item "Approx. saved" "$(human_size "$RC_SAVED")"
}

# ── Step 10: open archives in place ──────────────────────────────────
# Every archive anywhere below the working directory is expanded next to
# itself and then deleted. Unpacking can reveal further archives (an
# archive of archives), so the scan repeats until a pass finds nothing
# new; STEP11_ARCHIVE_MAX_PASSES stops a self-nesting archive from
# looping forever. An archive that fails to open is left on disk and is
# never retried in a later pass, so a broken or password-locked file
# cannot stall the loop.

is_archive_path() {
  local lower
  lower="$(printf "%s" "${1##*/}" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *.tar.gz|*.tar.bz2|*.tar.xz|*.tar.zst|*.tar.lzma|*.tar.lz|*.tar) return 0 ;;
    *.tgz|*.tbz|*.tbz2|*.txz|*.tzst) return 0 ;;
    *.zip|*.zipx|*.cbz|*.rar|*.cbr|*.7z|*.cb7) return 0 ;;
    *.gz|*.bz2|*.xz|*.zst|*.lzma) return 0 ;;
    *.cab|*.arj|*.lha|*.lzh|*.sit|*.sitx) return 0 ;;
    *) return 1 ;;
  esac
}

# Archive name minus its extension, treating the two-part tarball suffixes
# as one extension so "album.tar.gz" yields "album" and not "album.tar".
archive_stem_name() {
  local base="$1" lower
  lower="$(printf "%s" "$base" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *.tar.gz|*.tar.bz2|*.tar.xz|*.tar.zst|*.tar.lzma|*.tar.lz)
      base="${base%.*}"
      base="${base%.*}"
      ;;
    *.*)
      base="${base%.*}"
      ;;
  esac
  if [[ -z "$base" ]]; then
    base="archive"
  fi
  printf "%s" "$base"
}

# unar reads every format we look for, so it is the preferred opener; the
# per-format fallbacks below keep zip and tar files working on a machine
# that never installed it. stdin is closed for every opener: a
# password-protected archive would otherwise sit at a prompt forever.
extract_archive_into_dir() {
  local file="$1" dest="$2"
  local lower base seven_cmd
  base="${file##*/}"
  lower="$(printf "%s" "$base" | tr '[:upper:]' '[:lower:]')"

  if command -v unar >/dev/null 2>&1; then
    if unar -q -f -D -o "$dest" "$file" </dev/null >/dev/null 2>&1; then
      return 0
    fi
  fi

  seven_cmd=""
  if command -v 7zz >/dev/null 2>&1; then
    seven_cmd="7zz"
  elif command -v 7z >/dev/null 2>&1; then
    seven_cmd="7z"
  fi

  case "$lower" in
    *.tar|*.tar.gz|*.tgz|*.tar.bz2|*.tbz|*.tbz2|*.tar.xz|*.txz|*.tar.zst|*.tzst|*.tar.lzma|*.tar.lz)
      if tar -xf "$file" -C "$dest" </dev/null >/dev/null 2>&1; then
        return 0
      fi
      ;;
    *.zip|*.zipx|*.cbz)
      if command -v unzip >/dev/null 2>&1; then
        if unzip -qq -o "$file" -d "$dest" </dev/null >/dev/null 2>&1; then
          return 0
        fi
      fi
      ;;
    *.rar|*.cbr)
      if command -v unrar >/dev/null 2>&1; then
        if unrar x -o+ -idq "$file" "$dest/" </dev/null >/dev/null 2>&1; then
          return 0
        fi
      fi
      ;;
    *.gz|*.bz2|*.xz|*.zst|*.lzma)
      if extract_single_stream_archive "$file" "$dest" "$lower"; then
        return 0
      fi
      ;;
  esac

  if [[ -n "$seven_cmd" ]]; then
    if "$seven_cmd" x -y -bso0 -bsp0 -o"$dest" "$file" </dev/null >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

# A bare .gz/.bz2/.xz/.zst/.lzma holds one file rather than a directory, so
# it is decompressed to a single output named after the archive.
extract_single_stream_archive() {
  local file="$1" dest="$2" lower="$3"
  local out
  out="$dest/$(archive_stem_name "${file##*/}")"
  case "$lower" in
    *.gz)   command -v gzip  >/dev/null 2>&1 || return 1; gzip  -cd "$file" >"$out" 2>/dev/null || return 1 ;;
    *.bz2)  command -v bzip2 >/dev/null 2>&1 || return 1; bzip2 -cd "$file" >"$out" 2>/dev/null || return 1 ;;
    *.xz|*.lzma) command -v xz >/dev/null 2>&1 || return 1; xz -cd "$file" >"$out" 2>/dev/null || return 1 ;;
    *.zst)  command -v zstd  >/dev/null 2>&1 || return 1; zstd  -cdq "$file" -o "$out" >/dev/null 2>&1 || return 1 ;;
    *) return 1 ;;
  esac
  if [[ -s "$out" ]]; then
    return 0
  fi
  rm -f "$out" 2>/dev/null || true
  return 1
}

# Offer to install unar, which reads rar/7z/cab/sit as well as zip and tar.
# Declining is allowed: the step still runs, using the zip and tar tools
# macOS ships with, and says which formats it will have to skip.
ensure_unarchive_ready() {
  local ans
  if command -v unar >/dev/null 2>&1; then
    return 0
  fi
  ui_section "UNARCHIVER RECOMMENDED"
  printf "   Opening rar, 7z, cab and sit archives needs the 'unar' tool (Homebrew formula: unar).\n"
  printf "   Without it this step still opens zip and tar archives.\n"
  read -r -p "$(ui_prompt 'Install unar via Homebrew now? [Y/n]')" ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log_warn "Continuing without unar; rar/7z/cab/sit archives will be reported as failed and left in place."
    return 0
  fi
  load_homebrew_env || true
  if ! command -v brew >/dev/null 2>&1; then
    log_warn "Homebrew not available; continuing with zip and tar support only."
    return 0
  fi
  brew install unar || log_warn "unar install failed; continuing with zip and tar support only."
  load_homebrew_env || true
  return 0
}

step11_unpack_archives() {
  local pass=0 worked_passes=0 stage_seq=0
  local opened=0 failed=0
  local failed_list archives file total i progress
  local parent stage entries target label

  failed_list="$(mktemp)"

  while :; do
    pass=$((pass + 1))
    archives=()
    while IFS= read -r -d '' file; do
      if ! is_archive_path "$file"; then
        continue
      fi
      if grep -qxF -- "$file" "$failed_list" 2>/dev/null; then
        continue
      fi
      archives+=("$file")
    done < <(
      find . -type f \
        -not -path "./${EMPTY_ITEMS_BUCKET_NAME}/*" \
        -not -path "./${SIMILAR_ITEMS_BUCKET_NAME}/*" \
        -not -path "./${VHS_TEST_FOLDER_NAME}/*" \
        -not -path "*/.lg_unpack.*" \
        -print0
    )

    total=${#archives[@]}
    if [[ "$total" -eq 0 ]]; then
      if [[ "$pass" -eq 1 ]]; then
        log_warn "No archive files found."
        rm -f "$failed_list"
        return 0
      fi
      break
    fi

    worked_passes=$((worked_passes + 1))
    if [[ "$pass" -eq 1 ]]; then
      log_info "Opening $total archive file(s) in place."
      label="Step 10 Archives"
    else
      log_info "Pass $pass: $total archive(s) revealed by the previous pass."
      label="Step 10 Archives (pass $pass)"
    fi

    progress=0
    progress_draw "$label" "$progress" "$total"

    for (( i=0; i<total; i++ )); do
      file="${archives[$i]}"
      parent="$(dirname "$file")"
      stage_seq=$((stage_seq + 1))
      stage="${parent}/.lg_unpack.$$.${stage_seq}"
      rm -rf "$stage"
      mkdir -p "$stage"

      if ! extract_archive_into_dir "$file" "$stage"; then
        rm -rf "$stage"
        printf "%s\n" "$file" >> "$failed_list"
        failed=$((failed + 1))
        log_err "Could not open archive: $file"
        progress=$((progress + 1))
        progress_draw "$label" "$progress" "$total"
        continue
      fi

      entries=()
      while IFS= read -r -d '' target; do
        entries+=("$target")
      done < <(find "$stage" -mindepth 1 -maxdepth 1 -print0)

      if [[ "${#entries[@]}" -eq 0 ]]; then
        rm -rf "$stage"
        printf "%s\n" "$file" >> "$failed_list"
        failed=$((failed + 1))
        log_err "Archive opened to nothing, left in place: $file"
        progress=$((progress + 1))
        progress_draw "$label" "$progress" "$total"
        continue
      fi

      # An archive holding exactly one item is unwrapped straight into the
      # folder it sat in; anything else gets a folder named after it, so
      # loose contents never scatter across their neighbours.
      if [[ "${#entries[@]}" -eq 1 ]]; then
        target="$(unique_target_path "${parent}/$(basename "${entries[0]}")")"
        mv "${entries[0]}" "$target"
        rm -rf "$stage"
      else
        target="$(unique_target_path "${parent}/$(archive_stem_name "${file##*/}")")"
        mv "$stage" "$target"
      fi

      if [[ ! -e "$target" ]]; then
        rm -rf "$stage"
        printf "%s\n" "$file" >> "$failed_list"
        failed=$((failed + 1))
        log_err "Unpacked contents did not appear, archive left in place: $file"
        progress=$((progress + 1))
        progress_draw "$label" "$progress" "$total"
        continue
      fi

      rm -f "$file"
      opened=$((opened + 1))
      progress=$((progress + 1))
      progress_draw "$label" "$progress" "$total"
    done

    if [[ "$pass" -ge "$STEP11_ARCHIVE_MAX_PASSES" ]]; then
      log_warn "Stopped after $pass passes; any archives still nested inside are left in place."
      break
    fi
  done

  rm -f "$failed_list"

  log_info "Step 10 archive summary:"
  summary_item "Archives opened" "$opened"
  summary_item "Archives failed" "$failed"
  summary_item "Scan passes" "$worked_passes"
}

# ── Step 11: recursive file deletion ─────────────────────────────────
# This step removes files, never folders. The scan starts at the current
# working directory and skips .git metadata so running the cleaner from a
# repository cannot destroy its history by accident.

step12_print_delete_menu() {
  ui_section "STEP 11 OPTIONS  -  DELETE FILES RECURSIVELY"
  printf "   Which files should be deleted?\n"
  printf "   %2s  %s\n" "1"  "All video files"
  printf "   %2s  %s\n" "2"  "All image files"
  printf "   %2s  %s\n" "3"  "All audio files"
  printf "   %2s  %s\n" "4"  "All archive files"
  printf "   %2s  %s\n" "5"  "Documents and text files"
  printf "   %2s  %s\n" "6"  "Metadata, subtitle, and sidecar files"
  printf "   %2s  %s\n" "7"  "Zero-byte files"
  printf "   %2s  %s\n" "8"  "Files larger than a size"
  printf "   %2s  %s\n" "9"  "Files smaller than a size"
  printf "   %2s  %s\n" "10" "Files older than N days"
  printf "   %2s  %s\n" "11" "Files newer than N days"
  printf "   %2s  %s\n" "12" "Specific extension list"
  printf "   %2s  %s\n" "13" "Filename contains text"
  printf "   %2s  %s\n" "14" "Temporary/cache/download leftovers"
  printf "   %2s  %s\n" "15" "Every regular file"
}

step12_find_all_files() {
  find . -name .git -type d -prune -o -type f -print0
}

step12_ext_lower() {
  printf "%s" "${1##*.}" | tr '[:upper:]' '[:lower:]'
}

is_audio_media_ext() {
  local ext
  ext="$(step12_ext_lower "$1")"
  case "$ext" in
    mp3|m4a|aac|flac|wav|aiff|aif|ogg|oga|opus|wma|alac|ape|mka|mid|midi)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_document_media_ext() {
  local ext
  ext="$(step12_ext_lower "$1")"
  case "$ext" in
    pdf|txt|md|markdown|rtf|doc|docx|odt|pages|xls|xlsx|ods|csv|tsv|ppt|pptx|odp|epub|mobi|azw|azw3)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_sidecar_metadata_ext() {
  local ext
  ext="$(step12_ext_lower "$1")"
  case "$ext" in
    xmp|json|xml|nfo|srt|vtt|ass|ssa|sub|idx|cue|m3u|m3u8|pls|sfv|md5|sha1|sha256)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_temp_cache_path() {
  local lower base
  lower="$(printf "%s" "$1" | tr '[:upper:]' '[:lower:]')"
  base="${lower##*/}"
  case "$base" in
    .ds_store|thumbs.db|desktop.ini) return 0 ;;
    *.tmp|*.temp|*.bak|*.old|*.orig|*.swp|*.swo|*.part|*.download|*.crdownload|*.cache) return 0 ;;
    *~) return 0 ;;
  esac
  case "$lower" in
    */__macosx/*|*/.cache/*|*/cache/*|*/tmp/*|*/temp/*|*/.trash/*)
      return 0
      ;;
  esac
  return 1
}

step12_size_to_bytes() {
  local raw lower number unit mult
  raw="$(printf "%s" "$1" | tr -d '[:space:]')"
  lower="$(printf "%s" "$raw" | tr '[:upper:]' '[:lower:]')"

  if [[ "$lower" =~ ^([0-9]+([.][0-9]+)?)(b|byte|bytes|k|kb|kib|m|mb|mib|g|gb|gib|t|tb|tib)?$ ]]; then
    number="${BASH_REMATCH[1]}"
    unit="${BASH_REMATCH[3]:-b}"
  else
    return 1
  fi

  case "$unit" in
    b|byte|bytes) mult=1 ;;
    k|kb|kib) mult=1024 ;;
    m|mb|mib) mult=$((1024 * 1024)) ;;
    g|gb|gib) mult=$((1024 * 1024 * 1024)) ;;
    t|tb|tib) mult=$((1024 * 1024 * 1024 * 1024)) ;;
    *) return 1 ;;
  esac

  awk -v n="$number" -v m="$mult" 'BEGIN { printf "%.0f", n * m }'
}

step12_parse_extension_list() {
  local input="$1"
  local raw ext
  STEP12_EXTENSIONS=()
  IFS=',' read -r -a STEP12_RAW_EXTENSIONS <<< "$input"
  for raw in "${STEP12_RAW_EXTENSIONS[@]+"${STEP12_RAW_EXTENSIONS[@]}"}"; do
    ext="$(printf "%s" "$raw" | tr -d '[:space:]' | sed 's/^\.*//' | tr '[:upper:]' '[:lower:]')"
    if [[ -n "$ext" ]]; then
      STEP12_EXTENSIONS+=("$ext")
    fi
  done
  [[ "${#STEP12_EXTENSIONS[@]}" -gt 0 ]]
}

step12_extension_in_list() {
  local path="$1"
  local ext wanted
  ext="$(step12_ext_lower "$path")"
  for wanted in "${STEP12_EXTENSIONS[@]+"${STEP12_EXTENSIONS[@]}"}"; do
    if [[ "$ext" == "$wanted" ]]; then
      return 0
    fi
  done
  return 1
}

# One source for the wording of a delete criterion: the chooser echoes it,
# the no-match warning names it and the summary reports it.
step12_delete_choice_label() {
  case "${1:-}" in
    1)  printf "%s" "All video files" ;;
    2)  printf "%s" "All image files" ;;
    3)  printf "%s" "All audio files" ;;
    4)  printf "%s" "All archive files" ;;
    5)  printf "%s" "Documents and text files" ;;
    6)  printf "%s" "Metadata, subtitle, and sidecar files" ;;
    7)  printf "%s" "Zero-byte files" ;;
    8)  printf "%s" "Files larger than $(human_size "$STEP12_SIZE_BYTES")" ;;
    9)  printf "%s" "Files smaller than $(human_size "$STEP12_SIZE_BYTES")" ;;
    10) printf "%s" "Files older than ${STEP12_DAYS} day(s)" ;;
    11) printf "%s" "Files newer than ${STEP12_DAYS} day(s)" ;;
    12) printf "%s" "Extensions: ${STEP12_EXTENSIONS[*]}" ;;
    13) printf "%s" "Filename contains: ${STEP12_NAME_NEEDLE}" ;;
    14) printf "%s" "Temporary/cache/download leftovers" ;;
    15) printf "%s" "Every regular file" ;;
    *)  printf "%s" "Unknown criteria" ;;
  esac
}

step12_collect_delete_candidates() {
  local choice="$1"
  local file size lower_path
  STEP12_DELETE_FILES=()
  STEP12_DELETE_LABEL="$(step12_delete_choice_label "$choice")"

  case "$choice" in
    1)
      while IFS= read -r -d '' file; do
        is_video_media_ext "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    2)
      while IFS= read -r -d '' file; do
        is_image_media_ext "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    3)
      while IFS= read -r -d '' file; do
        is_audio_media_ext "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    4)
      while IFS= read -r -d '' file; do
        is_archive_path "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    5)
      while IFS= read -r -d '' file; do
        is_document_media_ext "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    6)
      while IFS= read -r -d '' file; do
        is_sidecar_metadata_ext "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    7)
      while IFS= read -r -d '' file; do
        [[ ! -s "$file" ]] && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    8)
      while IFS= read -r -d '' file; do
        size="$(file_size_bytes "$file")"
        if is_int "$size" && [[ "$size" -gt "$STEP12_SIZE_BYTES" ]]; then
          STEP12_DELETE_FILES+=("$file")
        fi
      done < <(step12_find_all_files)
      ;;
    9)
      while IFS= read -r -d '' file; do
        size="$(file_size_bytes "$file")"
        if is_int "$size" && [[ "$size" -lt "$STEP12_SIZE_BYTES" ]]; then
          STEP12_DELETE_FILES+=("$file")
        fi
      done < <(step12_find_all_files)
      ;;
    10)
      while IFS= read -r -d '' file; do
        STEP12_DELETE_FILES+=("$file")
      done < <(find . -name .git -type d -prune -o -type f -mtime +"$STEP12_DAYS" -print0)
      ;;
    11)
      while IFS= read -r -d '' file; do
        STEP12_DELETE_FILES+=("$file")
      done < <(find . -name .git -type d -prune -o -type f -mtime -"${STEP12_DAYS}" -print0)
      ;;
    12)
      while IFS= read -r -d '' file; do
        step12_extension_in_list "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    13)
      while IFS= read -r -d '' file; do
        lower_path="$(printf "%s" "$file" | tr '[:upper:]' '[:lower:]')"
        [[ "$lower_path" == *"$STEP12_NAME_NEEDLE"* ]] && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    14)
      while IFS= read -r -d '' file; do
        is_temp_cache_path "$file" && STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    15)
      while IFS= read -r -d '' file; do
        STEP12_DELETE_FILES+=("$file")
      done < <(step12_find_all_files)
      ;;
    *)
      return 1
      ;;
  esac
  # Each branch ends in a filtering loop whose status is that of its last
  # test, so a final non-match would otherwise make this function -- and
  # under `set -e` the whole run -- fail.
  return 0
}

step12_collect_parameters() {
  local choice="$1"
  local value

  case "$choice" in
    8|9)
      read -r -p "$(ui_prompt 'Size threshold (examples: 500M, 2GB, 120KB)')" value
      while ! STEP12_SIZE_BYTES="$(step12_size_to_bytes "$value" 2>/dev/null)" || [[ "$STEP12_SIZE_BYTES" -le 0 ]]; do
        log_warn "Enter a valid positive size, like 500M or 2GB."
        read -r -p "$(ui_prompt 'Size threshold')" value
      done
      ;;
    10|11)
      read -r -p "$(ui_prompt 'Number of days')" value
      while ! is_int "$value" || [[ "$value" -le 0 ]]; do
        log_warn "Enter a whole number of days greater than 0."
        read -r -p "$(ui_prompt 'Number of days')" value
      done
      STEP12_DAYS="$value"
      ;;
    12)
      read -r -p "$(ui_prompt 'Extensions to delete (comma-separated)')" value
      while ! step12_parse_extension_list "$value"; do
        log_warn "Enter at least one extension, like mov,webm,gif."
        read -r -p "$(ui_prompt 'Extensions to delete (comma-separated)')" value
      done
      ;;
    13)
      read -r -p "$(ui_prompt 'Filename text to match')" value
      value="$(printf "%s" "$value" | tr '[:upper:]' '[:lower:]')"
      while [[ -z "$value" ]]; do
        log_warn "Enter text to match in the filename or path."
        read -r -p "$(ui_prompt 'Filename text to match')" value
        value="$(printf "%s" "$value" | tr '[:upper:]' '[:lower:]')"
      done
      STEP12_NAME_NEEDLE="$value"
      ;;
  esac
}

# Asked up front from main(), with the other steps' options, so a run is
# decided before it starts. Only the final DELETE gate is left for run time:
# it confirms the actual match list, which earlier steps in the same run can
# still change.
choose_step12_delete_criteria() {
  local choice

  step12_print_delete_menu
  read -r -p "$(ui_prompt 'Delete option')" choice
  while ! is_int "$choice" || [[ "$choice" -lt 1 || "$choice" -gt 15 ]]; do
    log_warn "Choose a number from 1 through 15."
    read -r -p "$(ui_prompt 'Delete option')" choice
  done

  STEP12_DELETE_CHOICE="$choice"
  step12_collect_parameters "$choice"
  log_info "Step 11 will delete: $(step12_delete_choice_label "$choice")."
  log_warn "Step 11 asks you to type DELETE against the matched files before removing anything."
}

step12_delete_files_recursive() {
  local confirm file
  local total i progress=0
  local deleted=0 missing=0 failed=0

  if ! is_int "$STEP12_DELETE_CHOICE" || [[ "$STEP12_DELETE_CHOICE" -lt 1 ]]; then
    log_err "Step 11 has no delete criteria selected."
    return 1
  fi

  step12_collect_delete_candidates "$STEP12_DELETE_CHOICE"

  total=${#STEP12_DELETE_FILES[@]}
  if [[ "$total" -eq 0 ]]; then
    log_warn "No files matched: ${STEP12_DELETE_LABEL}"
    return 0
  fi

  log_warn "Step 11 will permanently delete ${total} file(s): ${STEP12_DELETE_LABEL}"
  printf "   Examples:\n"
  for ((i=0; i<total && i<10; i++)); do
    printf "   %s %s\n" "$G_BULL" "${STEP12_DELETE_FILES[$i]}"
  done
  if [[ "$total" -gt 10 ]]; then
    printf "   %s ...and %d more\n" "$G_BULL" "$((total - 10))"
  fi

  read -r -p "$(ui_prompt 'Type DELETE to permanently delete these files')" confirm
  if [[ "$confirm" != "DELETE" ]]; then
    log_warn "Step 11 cancelled."
    return 0
  fi

  for ((i=0; i<total; i++)); do
    file="${STEP12_DELETE_FILES[$i]}"
    if [[ ! -e "$file" ]]; then
      missing=$((missing + 1))
    elif rm -f -- "$file"; then
      deleted=$((deleted + 1))
    else
      failed=$((failed + 1))
      log_err "Delete failed: $file"
    fi
    progress=$((progress + 1))
    progress_draw "Step 11 Delete" "$progress" "$total"
  done

  log_info "Step 11 recursive delete summary:"
  summary_item "Criteria" "$STEP12_DELETE_LABEL"
  summary_item "Deleted" "$deleted"
  summary_item "Already missing" "$missing"
  summary_item "Failed" "$failed"
}

# ── Step 12: VHS look (ntsc-rs) ──────────────────────────────────────
# Standalone predecessor: safekeeping/VHS.sh. Images and MP4s are resized
# to a chosen height, run through the NTSC/VHS filter, then written back
# over the original. Stills render one frame of the effect instead of a
# throwaway 3-second video; the filter itself does the resize.

is_step13_vhs_height() {
  local h="$1" x
  for x in "${STEP13_VHS_HEIGHTS[@]+"${STEP13_VHS_HEIGHTS[@]}"}"; do
    if [[ "$x" == "$h" ]]; then
      return 0
    fi
  done
  return 1
}

choose_step13_vhs_scale() {
  local choice default_choice="" i=1 h count
  count=${#STEP13_VHS_HEIGHTS[@]}

  for h in "${STEP13_VHS_HEIGHTS[@]+"${STEP13_VHS_HEIGHTS[@]}"}"; do
    if [[ "$h" == "$STEP13_VHS_HEIGHT" ]]; then
      default_choice="$i"
      break
    fi
    i=$((i + 1))
  done
  if [[ -z "$default_choice" ]]; then
    default_choice=1
  fi

  ui_section "STEP 12 OPTIONS  -  VHS EFFECT"
  printf "   How tall should each picture be?\n"
  i=1
  for h in "${STEP13_VHS_HEIGHTS[@]+"${STEP13_VHS_HEIGHTS[@]}"}"; do
    printf "   %2d  %s\n" "$i" "$h"
    i=$((i + 1))
  done
  printf "   %2s  %s\n" "T" "Test: render the first three files at every height, then ask again"
  read -r -p "$(ui_prompt "Height [${default_choice}]")" choice
  choice="${choice:-$default_choice}"
  while true; do
    case "$choice" in
      t|T|test|Test|TEST)
        step13_vhs_height_test || true
        printf "\n"
        read -r -p "$(ui_prompt "Height [${default_choice}]")" choice
        choice="${choice:-$default_choice}"
        continue
        ;;
    esac
    if is_int "$choice" && [[ "$choice" -ge 1 && "$choice" -le "$count" ]]; then
      STEP13_VHS_HEIGHT="${STEP13_VHS_HEIGHTS[$((choice - 1))]}"
      break
    fi
    if is_step13_vhs_height "$choice"; then
      STEP13_VHS_HEIGHT="$choice"
      break
    fi
    log_warn "Choose a number from 1 through ${count}, or T to test."
    read -r -p "$(ui_prompt "Height [${default_choice}]")" choice
    choice="${choice:-$default_choice}"
  done
  log_info "Step 12 VHS height set to ${STEP13_VHS_HEIGHT}px."

  printf "   How should it run?\n"
  printf "   %2d  %s\n" 1 "Fast"
  printf "   %2d  %s\n" 2 "Slow (easy on the computer, takes longer)"
  printf "   %2d  %s\n" 3 "Ultra (several files at once, uses the whole computer)"
  read -r -p "$(ui_prompt 'Pace [1]')" choice
  choice="${choice:-1}"
  while true; do
    case "$choice" in
      1|fast|f|Fast|FAST)
        STEP13_VHS_PACE="fast"
        break
        ;;
      2|slow|s|Slow|SLOW)
        STEP13_VHS_PACE="slow"
        break
        ;;
      3|ultra|u|Ultra|ULTRA)
        STEP13_VHS_PACE="ultra"
        break
        ;;
      *)
        log_warn "Choose 1 for fast, 2 for slow, or 3 for ultra."
        read -r -p "$(ui_prompt 'Pace [1]')" choice
        choice="${choice:-1}"
        ;;
    esac
  done
  case "$STEP13_VHS_PACE" in
    slow)
      log_info "Step 12 will run slow: one file at a time, easy on the computer."
      ;;
    ultra)
      log_info "Step 12 will run ultra: $(step13_vhs_ultra_jobs image) pictures or $(step13_vhs_ultra_jobs video) videos at a time. The computer will be busy."
      ;;
    *)
      log_info "Step 12 will run fast."
      ;;
  esac
}

# ── How wide to open a pool ───────────────────────────────────────────
# Two numbers decide it, and both are read from the machine rather than
# guessed: how many cores are worth scheduling on, and how much memory there
# is to hold that many jobs at once. Step 12 and step 15 both size their ultra
# pools off these.

machine_cpu_total() {
  local n=""
  if command -v sysctl >/dev/null 2>&1; then
    n="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
  fi
  if ! is_int "${n:-}"; then
    n="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  if ! is_int "${n:-}" || [[ "$n" -lt 1 ]]; then
    n=4
  fi
  printf "%s" "$n"
}

machine_mem_gb() {
  local bytes=""
  if command -v sysctl >/dev/null 2>&1; then
    bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  fi
  if ! is_int "${bytes:-}" || [[ "$bytes" -lt 1073741824 ]]; then
    printf "8"
    return 0
  fi
  printf "%s" "$(( bytes / 1073741824 ))"
}

# How many files ultra keeps in flight. Both numbers were measured rather than
# reasoned about, on an M4 Pro (10 performance + 4 efficiency cores, 48 GB),
# by timing the real pipeline over a fixed set at every width:
#
#   images   1 job 20.0s | 5 jobs 4.5s | 10 jobs 3.4s | *14 jobs 2.6s* | 16 jobs 2.9s
#   videos   1 job 57.2s | 2 jobs 31.7s | 4 jobs 19.8s | *6 jobs 16.1s* | 10 jobs 18.4s
#
# Two things came out of that, and both contradict the obvious guess.
#
# An image job is nearly *serial* — 0.73s wall for 0.83s of CPU, split evenly
# between an ffmpeg decode, a single-frame ntsc-rs render and an encode, none
# of which threads far. So the right width is one job per logical core, not
# per pair of them, and the efficiency cores must be counted in: they are
# slower per job, but a short single-threaded job on a slow core is still
# throughput, and the peak sits exactly at the full core count.
#
# A video job self-parallelizes to about 2x (5.2s wall for 10.4s of CPU),
# since the ntsc-rs pass and the x264 re-encode both thread. Divide the
# machine by that and the peak lands at half the cores, which is what the
# sweep found: 6 measured best and 7 was within noise of it.
#
# Past the peak both curves turn back up — 16 image jobs are slower than 14,
# 10 video jobs slower than 6 — which is the whole reason this is a measured
# number and not simply "as many as possible".
step13_vhs_ultra_jobs() {
  local kind="$1" jobs cores mem mem_cap override

  cores="$(machine_cpu_total)"
  mem="$(machine_mem_gb)"

  # The memory caps come from measured peak RSS per job — 192 MB for an image,
  # 537 MB for a video, on 1080p sources — budgeted at 1 GB and 2 GB so a 4K
  # source has room. On any machine with memory to match its cores neither cap
  # binds; they are here so a small one degrades instead of swapping.
  if [[ "$kind" == "video" ]]; then
    override="${STEP13_VHS_ULTRA_VIDEO_JOBS:-0}"
    jobs=$(( cores / 2 ))
    mem_cap=$(( mem / 2 ))
  else
    override="${STEP13_VHS_ULTRA_IMAGE_JOBS:-0}"
    jobs="$cores"
    mem_cap="$mem"
  fi

  if is_int "$override" && [[ "$override" -gt 0 ]]; then
    printf "%s" "$override"
    return 0
  fi

  # Two is the floor: ultra that runs one file at a time is just fast.
  if [[ "$jobs" -lt 2 ]]; then jobs=2; fi
  if [[ "$mem_cap" -lt 2 ]]; then mem_cap=2; fi
  if [[ "$jobs" -gt "$mem_cap" ]]; then jobs="$mem_cap"; fi
  if [[ "$jobs" -gt "$STEP13_VHS_ULTRA_MAX_JOBS" ]]; then
    jobs="$STEP13_VHS_ULTRA_MAX_JOBS"
  fi
  printf "%s" "$jobs"
}

# Each job is told how many threads it may use, so the slots add up to the
# machine instead of every one of them trying to take the whole of it. That
# is the difference between ultra being wider and ultra being slower than
# fast: N jobs each spawning a core's worth of threads is N times the
# contention for the same work.
step13_vhs_ultra_threads() {
  local jobs="$1" cores threads
  cores="$(machine_cpu_total)"
  if ! is_int "$jobs" || [[ "$jobs" -lt 1 ]]; then
    jobs=1
  fi
  threads=$(( cores / jobs ))
  if [[ "$threads" -lt 1 ]]; then threads=1; fi
  printf "%s" "$threads"
}

# Run a command at background priority so slow mode does not fight the rest
# of the machine. Children inherit the policy.
step13_vhs_low_priority() {
  if command -v taskpolicy >/dev/null 2>&1; then
    nice -n 19 taskpolicy -b -d throttle \
      env RAYON_NUM_THREADS=1 OMP_NUM_THREADS=1 MAGICK_THREAD_LIMIT=1 "$@"
  else
    nice -n 19 env RAYON_NUM_THREADS=1 OMP_NUM_THREADS=1 MAGICK_THREAD_LIMIT=1 "$@"
  fi
}

step13_vhs_run() {
  case "${STEP13_VHS_PACE:-fast}" in
    slow)
      step13_vhs_low_priority "$@"
      ;;
    ultra)
      env "RAYON_NUM_THREADS=${STEP13_VHS_JOB_THREADS:-1}" \
          "OMP_NUM_THREADS=${STEP13_VHS_JOB_THREADS:-1}" \
          "MAGICK_THREAD_LIMIT=${STEP13_VHS_JOB_THREADS:-1}" "$@"
      ;;
    *)
      "$@"
      ;;
  esac
}

step13_vhs_ffmpeg() {
  case "${STEP13_VHS_PACE:-fast}" in
    slow)
      step13_vhs_run ffmpeg -nostdin -hide_banner -loglevel error -y \
        -threads 1 -filter_threads 1 "$@"
      ;;
    ultra)
      ffmpeg -nostdin -hide_banner -loglevel error -y \
        -threads "${STEP13_VHS_JOB_THREADS:-2}" \
        -filter_threads "${STEP13_VHS_JOB_THREADS:-2}" "$@"
      ;;
    *)
      ffmpeg -nostdin -hide_banner -loglevel error -y "$@"
      ;;
  esac
}

step13_vhs_scale_filter() {
  if [[ "${STEP13_VHS_PACE:-fast}" == "slow" ]]; then
    printf "bilinear"
  else
    printf "bicubic"
  fi
}

step13_vhs_rest() {
  if [[ "${STEP13_VHS_PACE:-fast}" == "slow" ]]; then
    sleep 0.5
  fi
}

step13_write_vhs_preset() {
  local dest="$1"
  cat > "$dest" << 'EOF'
{"random_seed":0,"use_field":4,"filter_type":1,"input_luma_filter":2,"chroma_lowpass_in":2,"composite_preemphasis":1.0,"composite_noise":true,"composite_noise_intensity":0.05,"composite_noise_frequency":0.5,"composite_noise_detail":1,"snow_intensity":0.00025,"snow_anisotropy":0.5,"video_scanline_phase_shift":2,"video_scanline_phase_shift_offset":0,"chroma_demodulation":1,"luma_smear":0.455,"head_switching":false,"head_switching_height":8,"head_switching_offset":3,"head_switching_horizontal_shift":72.0,"head_switching_start_mid_line":true,"head_switching_mid_line_position":0.95,"head_switching_mid_line_jitter":0.03,"tracking_noise":false,"tracking_noise_height":12,"tracking_noise_wave_intensity":15.0,"tracking_noise_snow_intensity":0.025,"tracking_noise_snow_anisotropy":0.25,"tracking_noise_noise_intensity":0.25,"ringing":true,"ringing_frequency":0.45,"ringing_power":4.0,"ringing_scale":4.0,"luma_noise":true,"luma_noise_intensity":0.01,"luma_noise_frequency":0.5,"luma_noise_detail":1,"chroma_noise":true,"chroma_noise_intensity":0.1,"chroma_noise_frequency":0.05,"chroma_noise_detail":2,"chroma_phase_error":0.0,"chroma_phase_noise_intensity":0.001,"chroma_delay_horizontal":0.0,"chroma_delay_vertical":0,"vhs_settings":true,"vhs_tape_speed":2,"vhs_chroma_loss":0.000025,"vhs_sharpen_enabled":true,"vhs_sharpen":0.25,"vhs_sharpen_frequency":1.0,"vhs_edge_wave_enabled":true,"vhs_edge_wave":0.5,"vhs_edge_wave_speed":4.0,"vhs_edge_wave_frequency":0.05,"vhs_edge_wave_detail":2,"vhs_chroma_vert_blend":false,"chroma_lowpass_out":2,"scale_settings":true,"bandwidth_scale":1.0,"vertical_scale":1.0,"scale_with_video_size":false,"version":1}
EOF
}

# Expand TV-range filter output to full computer range and force even
# width/height so H.264 / JPEG / AVIF will take the frame.
STEP13_VHS_VF="scale=in_range=tv:out_range=pc,scale=trunc(iw/2)*2:trunc(ih/2)*2"

step13_vhs_process_image() {
  local file="$1"
  local height="$2"
  local ntsc="$3"
  local preset="$4"
  local workdir="$5"
  local ext src_png vhs_png final

  ext="$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')"
  src_png="${workdir}/in.png"
  vhs_png="${workdir}/vhs.png"
  final="${workdir}/out.${ext}"
  rm -f "$src_png" "$vhs_png" "$final"

  if ! step13_vhs_ffmpeg -i "$file" -frames:v 1 "$src_png" \
     || [[ ! -s "$src_png" ]]; then
    return 1
  fi

  if ! step13_vhs_run "$ntsc" -i "$src_png" -o "$vhs_png" -p "$preset" -y \
        --codec png --single-frame-time 00:01.50 --duration 00:02.00 --fps 24 \
        --scale "$height" --scale-filter "$(step13_vhs_scale_filter)" --compression-level 1 \
        >/dev/null 2>&1 \
     || [[ ! -s "$vhs_png" ]]; then
    return 1
  fi

  case "$ext" in
    jpg|jpeg)
      if ! step13_vhs_ffmpeg -i "$vhs_png" \
            -vf "$STEP13_VHS_VF" -frames:v 1 -q:v 2 "$final" \
         || [[ ! -s "$final" ]]; then
        return 1
      fi
      ;;
    png)
      if ! step13_vhs_ffmpeg -i "$vhs_png" \
            -vf "$STEP13_VHS_VF" -frames:v 1 "$final" \
         || [[ ! -s "$final" ]]; then
        return 1
      fi
      ;;
    avif)
      if command -v avifenc >/dev/null 2>&1; then
        if ! step13_vhs_ffmpeg -i "$vhs_png" \
              -vf "$STEP13_VHS_VF" -frames:v 1 "${workdir}/pc.png" \
           || [[ ! -s "${workdir}/pc.png" ]]; then
          return 1
        fi
        case "${STEP13_VHS_PACE:-fast}" in
          slow)
            if ! step13_vhs_run avifenc -j 1 -q 70 -s 6 "${workdir}/pc.png" "$final" >/dev/null 2>&1 \
               || [[ ! -s "$final" ]]; then
              return 1
            fi
            ;;
          ultra)
            if ! step13_vhs_run avifenc -j "${STEP13_VHS_JOB_THREADS:-2}" -q 70 -s 6 "${workdir}/pc.png" "$final" >/dev/null 2>&1 \
               || [[ ! -s "$final" ]]; then
              return 1
            fi
            ;;
          *)
            if ! avifenc -q 70 -s 6 "${workdir}/pc.png" "$final" >/dev/null 2>&1 \
               || [[ ! -s "$final" ]]; then
              return 1
            fi
            ;;
        esac
      else
        if ! step13_vhs_ffmpeg -i "$vhs_png" \
              -vf "$STEP13_VHS_VF" -frames:v 1 -q:v 2 "$final" \
           || [[ ! -s "$final" ]]; then
          return 1
        fi
      fi
      ;;
    *)
      return 1
      ;;
  esac

  mv -f "$final" "$file"
  rm -f "$src_png" "$vhs_png" "${workdir}/pc.png"
  return 0
}

step13_vhs_process_video() {
  local file="$1"
  local height="$2"
  local ntsc="$3"
  local preset="$4"
  local workdir="$5"
  local vhs_mp4 final

  vhs_mp4="${workdir}/vhs.mp4"
  final="${workdir}/out.mp4"
  rm -f "$vhs_mp4" "$final"

  if ! step13_vhs_run "$ntsc" -i "$file" -o "$vhs_mp4" -p "$preset" -y \
        --scale "$height" --scale-filter "$(step13_vhs_scale_filter)" \
        --quality 40 --encoding-speed 8 --chroma-subsampling \
        >/dev/null 2>&1 \
     || [[ ! -s "$vhs_mp4" ]]; then
    return 1
  fi

  if step13_vhs_ffmpeg -i "$vhs_mp4" \
        -map 0:v:0 -map 0:a? \
        -vf "$STEP13_VHS_VF" \
        -c:v libx264 -crf 18 -pix_fmt yuv420p -color_range pc \
        -c:a copy -movflags +faststart "$final" \
     && [[ -s "$final" ]]; then
    mv -f "$final" "$file"
    rm -f "$vhs_mp4"
    return 0
  fi

  rm -f "$final"
  if step13_vhs_ffmpeg -i "$vhs_mp4" \
        -map 0:v:0 -map 0:a? \
        -vf "$STEP13_VHS_VF" \
        -c:v libx264 -crf 18 -pix_fmt yuv420p -color_range pc \
        -c:a aac -b:a 192k -movflags +faststart "$final" \
     && [[ -s "$final" ]]; then
    mv -f "$final" "$file"
    rm -f "$vhs_mp4"
    return 0
  fi

  rm -f "$vhs_mp4" "$final"
  return 1
}

# Ultra pace: keep several files in flight at once.
#
# Bash 3.2 (the macOS system bash this may run under) has no `wait -n`, so the
# pool is polled rather than woken: each slot holds one child pid, its own
# scratch folder — the per-file temp names are fixed, so two slots sharing one
# would overwrite each other mid-render — and a status file the child writes
# its exit code into, since a child cannot reach the parent's counters. A
# child that dies without writing one is counted as a failure, which is what
# an out-of-memory kill looks like from here.
#
# Sets STEP13_VHS_POOL_DONE / STEP13_VHS_POOL_FAILED for the caller.
step13_vhs_run_pool() {
  local kind="$1" jobs="$2" workdir="$3" ntsc="$4" preset="$5"
  local base="$6" grand_total="$7"
  shift 7
  local files=( "$@" )
  local count=${#files[@]}
  local next=0 finished=0 reaped slot pid rc file slotdir statusfile display
  local pids=() slotfiles=()
  local plabel="Step 12 VHS"

  if [[ "$kind" == "test" ]]; then
    plabel="Step 12 height test"
  fi

  STEP13_VHS_POOL_DONE=0
  STEP13_VHS_POOL_FAILED=0
  if [[ "$count" -eq 0 ]]; then
    return 0
  fi

  # No point opening more slots than there are files to put in them.
  if [[ "$jobs" -gt "$count" ]]; then
    jobs="$count"
  fi
  if [[ "$jobs" -lt 1 ]]; then
    jobs=1
  fi
  STEP13_VHS_JOB_THREADS="$(step13_vhs_ultra_threads "$jobs")"

  for (( slot=0; slot<jobs; slot++ )); do
    pids[$slot]=0
    slotfiles[$slot]=""
    mkdir -p "${workdir}/slot${slot}"
  done

  while [[ "$finished" -lt "$count" ]]; do
    # Fill every free slot.
    for (( slot=0; slot<jobs; slot++ )); do
      if [[ "${pids[$slot]}" -ne 0 ]]; then
        continue
      fi
      if [[ "$next" -ge "$count" ]]; then
        break
      fi
      file="${files[$next]}"
      next=$(( next + 1 ))
      slotdir="${workdir}/slot${slot}"
      statusfile="${slotdir}/status"
      rm -f "$statusfile"
      (
        rc=0
        case "$kind" in
          video)
            step13_vhs_process_video "$file" "$STEP13_VHS_HEIGHT" "$ntsc" "$preset" "$slotdir" || rc=$?
            ;;
          test)
            # A test item is "<height>|<path>": one pool renders the sample at
            # every height at once, so the height cannot come from the global.
            step13_vhs_process_image "${file#*|}" "${file%%|*}" "$ntsc" "$preset" "$slotdir" || rc=$?
            ;;
          *)
            step13_vhs_process_image "$file" "$STEP13_VHS_HEIGHT" "$ntsc" "$preset" "$slotdir" || rc=$?
            ;;
        esac
        printf "%s" "$rc" > "$statusfile"
        exit 0
      ) >/dev/null 2>&1 &
      pids[$slot]=$!
      slotfiles[$slot]="$file"
    done

    # Collect whatever has landed.
    reaped=0
    for (( slot=0; slot<jobs; slot++ )); do
      pid="${pids[$slot]}"
      if [[ "$pid" -eq 0 ]]; then
        continue
      fi
      if kill -0 "$pid" 2>/dev/null; then
        continue
      fi
      wait "$pid" >/dev/null 2>&1 || true
      statusfile="${workdir}/slot${slot}/status"
      rc=1
      if [[ -s "$statusfile" ]]; then
        rc="$(cat "$statusfile" 2>/dev/null || printf "1")"
      fi
      if ! is_int "$rc"; then
        rc=1
      fi
      if [[ "$rc" -eq 0 ]]; then
        STEP13_VHS_POOL_DONE=$(( STEP13_VHS_POOL_DONE + 1 ))
      else
        STEP13_VHS_POOL_FAILED=$(( STEP13_VHS_POOL_FAILED + 1 ))
        display="${slotfiles[$slot]}"
        if [[ "$kind" == "test" ]]; then
          display="${display#*|}"
        fi
        log_err "VHS effect failed: $display"
      fi
      pids[$slot]=0
      slotfiles[$slot]=""
      finished=$(( finished + 1 ))
      reaped=1
      progress_draw "$plabel" "$(( base + finished ))" "$grand_total"
    done

    if [[ "$reaped" -eq 0 && "$finished" -lt "$count" ]]; then
      sleep 0.2
    fi
  done

  for (( slot=0; slot<jobs; slot++ )); do
    rm -rf "${workdir}/slot${slot}"
  done
  return 0
}

# The height prompt's Test option: render the first three files of the set at
# every height into a folder of their own, so the choice is made by looking
# instead of by guessing what 800 means for this particular material.
#
# It is real work where every other choose_* option is only a question, which
# is a deliberate exception rather than an oversight: what it produces is the
# answer to the question being asked one line further down, and after the
# Proceed? gate would be far too late to be of any use. Nothing outside the
# test folder is touched — the samples are copies, and the originals are never
# opened for writing.
step13_vhs_height_test() {
  local ntsc preset workdir root saved_pace
  local sample=() stills=() items=()
  local file base ext name h i=0 n=0 total

  if ! ntsc="$(find_ntsc_rs_command)"; then
    log_err "ntsc-rs-cli not found. Install the ntsc-rs app in /Applications."
    return 1
  fi

  root="./${VHS_TEST_FOLDER_NAME}"

  # The same finds, in the same order, that the step itself walks, so the
  # sample really is the first three files of the run rather than three
  # arbitrary ones.
  while IFS= read -r -d '' file; do
    sample+=("$file")
    n=$((n + 1))
    if [[ "$n" -ge 3 ]]; then break; fi
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
              -o -path "./${VHS_TEST_FOLDER_NAME}" \
              -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
      -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.avif" \) \
      ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
      -print0
  )

  if [[ "$n" -lt 3 ]]; then
    while IFS= read -r -d '' file; do
      sample+=("$file")
      n=$((n + 1))
      if [[ "$n" -ge 3 ]]; then break; fi
    done < <(
      find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
                -o -path "./${VHS_TEST_FOLDER_NAME}" \
                -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
        -type f -iname "*.mp4" \
        ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
        -print0
    )
  fi

  if [[ "$n" -eq 0 ]]; then
    log_warn "No images or MP4 videos here to test with."
    return 1
  fi

  mkdir -p "${root}/original"

  # A video is sampled as a single frame. The question a height answers is
  # what the picture looks like at that size, and a still answers it exactly
  # as well as a clip would — where re-encoding three videos twelve times over
  # would take long enough that nobody would run the test twice.
  for file in "${sample[@]+"${sample[@]}"}"; do
    i=$((i + 1))
    base="$(basename "$file")"
    ext="$(printf "%s" "${base##*.}" | tr '[:upper:]' '[:lower:]')"
    if [[ "$ext" == "mp4" ]]; then
      name="$(printf "%02d_%s.png" "$i" "${base%.*}")"
      if ! ffmpeg -nostdin -hide_banner -loglevel error -y \
            -i "$file" -frames:v 1 "${root}/original/${name}" >/dev/null 2>&1; then
        log_warn "Could not read a frame from: $file"
        continue
      fi
    else
      name="$(printf "%02d_%s" "$i" "$base")"
      if ! cp -f "$file" "${root}/original/${name}"; then
        log_warn "Could not copy: $file"
        continue
      fi
    fi
    stills+=("$name")
  done

  if [[ "${#stills[@]}" -eq 0 ]]; then
    log_warn "None of the sample files could be read."
    return 1
  fi

  for h in "${STEP13_VHS_HEIGHTS[@]+"${STEP13_VHS_HEIGHTS[@]}"}"; do
    rm -rf "${root}/${h}"
    mkdir -p "${root}/${h}"
    for name in "${stills[@]+"${stills[@]}"}"; do
      cp -f "${root}/original/${name}" "${root}/${h}/${name}"
      items+=("${h}|${root}/${h}/${name}")
    done
  done

  workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_vhs_test.XXXXXX")"
  preset="${workdir}/preset.json"
  step13_write_vhs_preset "$preset"

  total=${#items[@]}
  log_info "Rendering ${#stills[@]} file(s) at ${#STEP13_VHS_HEIGHTS[@]} heights: $total renders."

  # Run wide whatever pace the step is set to. The pace is a choice about how
  # hard to lean on the machine during a long unattended run; this is a short
  # one with somebody sitting in front of it waiting for the answer.
  saved_pace="${STEP13_VHS_PACE:-fast}"
  STEP13_VHS_PACE="ultra"
  step13_vhs_run_pool test "$(step13_vhs_ultra_jobs image)" "$workdir" \
    "$ntsc" "$preset" 0 "$total" "${items[@]}"
  STEP13_VHS_PACE="$saved_pace"
  rm -rf "$workdir"

  log_info "Height test written to ${VHS_TEST_FOLDER_NAME}/"
  summary_item "Files sampled" "${#stills[@]}"
  summary_item "Heights" "${#STEP13_VHS_HEIGHTS[@]}"
  summary_item "Rendered" "$STEP13_VHS_POOL_DONE"
  summary_item "Failed" "$STEP13_VHS_POOL_FAILED"
  summary_item "Untouched copies in" "${VHS_TEST_FOLDER_NAME}/original"

  if [[ "${UI_TTY:-0}" -eq 1 ]] && command -v open >/dev/null 2>&1; then
    open "$root" >/dev/null 2>&1 || true
  fi
  return 0
}

step13_apply_vhs_effect() {
  local images=() videos=()
  local file ntsc preset workdir
  local i total all_total=0 all_done=0
  local img_done=0 img_failed=0
  local vid_done=0 vid_failed=0
  local image_jobs=1 video_jobs=1

  if ! ntsc="$(find_ntsc_rs_command)"; then
    log_err "ntsc-rs-cli not found. Install the ntsc-rs app in /Applications."
    return 1
  fi

  workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_vhs.XXXXXX")"
  preset="${workdir}/preset.json"
  step13_write_vhs_preset "$preset"

  while IFS= read -r -d '' file; do
    images+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
              -o -path "./${VHS_TEST_FOLDER_NAME}" \
              -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
      -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.avif" \) \
      ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
      -print0
  )

  while IFS= read -r -d '' file; do
    videos+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
              -o -path "./${VHS_TEST_FOLDER_NAME}" \
              -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
      -type f -iname "*.mp4" \
      ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
      -print0
  )

  all_total=$(( ${#images[@]} + ${#videos[@]} ))
  if [[ "$all_total" -eq 0 ]]; then
    rm -rf "$workdir"
    log_warn "No images or MP4 videos found for the VHS effect."
    return 0
  fi

  case "${STEP13_VHS_PACE:-fast}" in
    slow)
      log_info "Applying VHS look to $all_total file(s) at height ${STEP13_VHS_HEIGHT}px, slow (one at a time, easy on the computer)."
      ;;
    ultra)
      image_jobs="$(step13_vhs_ultra_jobs image)"
      video_jobs="$(step13_vhs_ultra_jobs video)"
      log_info "Applying VHS look to $all_total file(s) at height ${STEP13_VHS_HEIGHT}px, ultra (${image_jobs} pictures or ${video_jobs} videos at a time)."
      ;;
    *)
      log_info "Applying VHS look to $all_total file(s) at height ${STEP13_VHS_HEIGHT}px, fast."
      ;;
  esac

  # The two kinds are run in separate passes, ultra included: their pools are
  # sized differently, and mixing them would put a video's whole re-encode in
  # a slot sized for a still.
  total=${#images[@]}
  if [[ "$total" -gt 0 ]]; then
    if [[ "${STEP13_VHS_PACE:-fast}" == "ultra" ]]; then
      step13_vhs_run_pool image "$image_jobs" "$workdir" "$ntsc" "$preset" \
        "$all_done" "$all_total" "${images[@]}"
      img_done="$STEP13_VHS_POOL_DONE"
      img_failed="$STEP13_VHS_POOL_FAILED"
      all_done=$(( all_done + total ))
    else
      for (( i=0; i<total; i++ )); do
        file="${images[$i]}"
        if step13_vhs_process_image "$file" "$STEP13_VHS_HEIGHT" "$ntsc" "$preset" "$workdir"; then
          img_done=$((img_done + 1))
        else
          img_failed=$((img_failed + 1))
          log_err "VHS effect failed: $file"
        fi
        all_done=$((all_done + 1))
        progress_draw "Step 12 VHS" "$all_done" "$all_total"
        if [[ "$all_done" -lt "$all_total" ]]; then
          step13_vhs_rest
        fi
      done
    fi
  fi

  total=${#videos[@]}
  if [[ "$total" -gt 0 ]]; then
    if [[ "${STEP13_VHS_PACE:-fast}" == "ultra" ]]; then
      step13_vhs_run_pool video "$video_jobs" "$workdir" "$ntsc" "$preset" \
        "$all_done" "$all_total" "${videos[@]}"
      vid_done="$STEP13_VHS_POOL_DONE"
      vid_failed="$STEP13_VHS_POOL_FAILED"
      all_done=$(( all_done + total ))
    else
      for (( i=0; i<total; i++ )); do
        file="${videos[$i]}"
        if step13_vhs_process_video "$file" "$STEP13_VHS_HEIGHT" "$ntsc" "$preset" "$workdir"; then
          vid_done=$((vid_done + 1))
        else
          vid_failed=$((vid_failed + 1))
          log_err "VHS effect failed: $file"
        fi
        all_done=$((all_done + 1))
        progress_draw "Step 12 VHS" "$all_done" "$all_total"
        if [[ "$all_done" -lt "$all_total" ]]; then
          step13_vhs_rest
        fi
      done
    fi
  fi

  rm -rf "$workdir"

  log_info "Step 12 VHS summary:"
  summary_item "Height" "${STEP13_VHS_HEIGHT}px"
  if [[ "${STEP13_VHS_PACE:-fast}" == "ultra" ]]; then
    summary_item "Pace" "ultra (${image_jobs} pictures / ${video_jobs} videos at a time)"
  else
    summary_item "Pace" "$STEP13_VHS_PACE"
  fi
  summary_item "Images processed" "$img_done"
  summary_item "Images failed" "$img_failed"
  summary_item "Videos processed" "$vid_done"
  summary_item "Videos failed" "$vid_failed"
}

# ── Step 13: colour grade ─────────────────────────────────────────────
#
# Five dials, each a percentage from -100 to 100, zero meaning "leave it
# alone". They are the gallery app's own filter controls under the same
# names, computed the same way and applied in the same order, so a grade set
# here lands on the pixels the app would have shown for the same numbers.
#
# No new tool. Every one of the five is a linear operation on the pixel, and
# ffmpeg — already required by half this script — can carry all five in three
# filters. See color_grade_filter_chain for the arithmetic.

color_grade_percent_valid() {
  local v="${1:-}"
  [[ "$v" =~ ^[+-]?[0-9]+$ ]] || return 1
  v="${v#+}"
  [[ "$v" -ge -100 && "$v" -le 100 ]]
}

# Build the ffmpeg filter chain for the five dials. Prints nothing at all when
# every dial is at zero, which is how the step knows there is no work.
#
# The app's pipeline, in the app's order:
#
#   brightness   c *= 1 + b
#   contrast     c  = (c - 0.5) * (1 + k) + 0.5
#   saturation   c  = luma + (c - luma) * (1 + s),  luma is Rec.709
#   temperature  c *= (1 + t*0.22, 1 + t*0.05, 1 - t*0.24), and then the luma
#                the tint just cost is added back, so only the colour moves
#   hue          the standard hue-rotation matrix, in degrees
#
# A percentage maps to the app's own amount directly: +10% saturation is the
# app's 0.10, and hue shift takes a percentage of a half turn, so -100%/+100%
# is the whole colour wheel. The zero end of each dial is the meaningful one
# and is the same in both directions -- -100% is black, flat grey, greyscale,
# fully cold, half a turn back.
#
# Three filters carry it. Brightness is a diagonal mixer. Contrast is an
# affine ramp, which colorlevels does -- raising it moves the input levels in,
# lowering it moves the output levels in, because doing either the other way
# round would need a level outside 0..1. Saturation, temperature and hue are
# each a 3x3 matrix (temperature included: the luma it adds back is a linear
# function of the pixel), so their product is one more mixer.
color_grade_filter_chain() {
  awk -v b="$COLOR_GRADE_BRIGHTNESS" -v k="$COLOR_GRADE_CONTRAST" \
      -v s="$COLOR_GRADE_SATURATION" -v t="$COLOR_GRADE_TEMPERATURE" \
      -v hp="$COLOR_GRADE_HUE" '
    function levels(imn, imx, omn, omx) {
      return sprintf("colorlevels=rimin=%.6f:gimin=%.6f:bimin=%.6f" \
                     ":rimax=%.6f:gimax=%.6f:bimax=%.6f" \
                     ":romin=%.6f:gomin=%.6f:bomin=%.6f" \
                     ":romax=%.6f:gomax=%.6f:bomax=%.6f",
                     imn, imn, imn, imx, imx, imx, omn, omn, omn, omx, omx, omx)
    }
    function mixer(A,   i, j) {
      return sprintf("colorchannelmixer=rr=%.6f:rg=%.6f:rb=%.6f" \
                     ":gr=%.6f:gg=%.6f:gb=%.6f:br=%.6f:bg=%.6f:bb=%.6f",
                     A[0, 0], A[0, 1], A[0, 2],
                     A[1, 0], A[1, 1], A[1, 2],
                     A[2, 0], A[2, 1], A[2, 2])
    }
    function matmul(A, B, R,   i, j, n) {
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        R[i, j] = 0
        for (n = 0; n < 3; n++) R[i, j] += A[i, n] * B[n, j]
      }
    }
    function copymat(A, R,   i, j) {
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) R[i, j] = A[i, j]
    }
    function peak(A,   i, j, m) {
      m = 0
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++)
        if (A[i, j] > m) m = A[i, j]; else if (-A[i, j] > m) m = -A[i, j]
      return m
    }
    BEGIN {
      LR = 0.2126; LG = 0.7152; LB = 0.0722
      bm = 1 + b / 100;  if (bm < 0) bm = 0
      cm = 1 + k / 100;  if (cm < 0) cm = 0
      sm = 1 + s / 100;  if (sm < 0) sm = 0
      tt = t / 100
      hd = hp / 100 * 180

      n = 0

      # Brightness and contrast are one affine ramp per channel:
      #   out = (cm * bm) * v + (0.5 - 0.5 * cm)
      # and one colorlevels draws it, so both dials ride in a single filter.
      # That is not tidiness. Every ffmpeg filter clips its output to 0..1
      # where the app clips only at the end, so a brightness lift followed by
      # a contrast drop would otherwise come back with the highlights ffmpeg
      # had already flattened to white.
      #
      # The levels are read off the ramp rather than set to 0 and 1: ffmpeg
      # takes an input level below zero and silently treats it as zero, so the
      # window handed over has to be the part of the ramp that already lands
      # inside 0..1. Outside that window colorlevels extends the same line and
      # clips, which is what is wanted.
      slope = cm * bm
      icept = 0.5 - 0.5 * cm
      if (slope < 0.9999 || slope > 1.0001 || icept < -0.0001 || icept > 0.0001) {
        lo = 0; hi = 1
        if (slope > 0.000001) {
          lo = -icept / slope;      if (lo < 0) lo = 0
          hi = (1 - icept) / slope; if (hi > 1) hi = 1
        }
        if (slope <= 0.000001 || hi - lo < 0.000001) {
          # The ramp leaves none of the picture behind -- a flat field, which
          # is one output level with the input window left wide. The app,
          # having no floor under it until the very end, can still get a faint
          # cast out of a frame driven below black, because saturation applied
          # to two negative channels can lift one back over zero. ffmpeg
          # floors at the filter, so this is the one setting where the two
          # part company -- both give a black frame, and only one of them has
          # a tint in it.
          flat = icept + slope * 0.5
          if (flat < 0) flat = 0
          if (flat > 1) flat = 1
          parts[++n] = levels(0, 1, flat, flat)
        } else {
          parts[++n] = levels(lo, hi, icept + slope * lo, icept + slope * hi)
        }
      }

      # Saturation, temperature and hue are each a 3x3 matrix -- temperature
      # included, because the luma it hands back after tinting is itself a
      # linear function of the pixel -- so their product is a single mixer.
      count = 0

      if (sm < 0.9999 || sm > 1.0001) {
        L[0] = LR; L[1] = LG; L[2] = LB
        for (i = 0; i < 3; i++) for (j = 0; j < 3; j++)
          Sm[i, j] = L[j] * (1 - sm) + ((i == j) ? sm : 0)
        stage[++count] = "s"
      }

      if (tt < -0.0001 || tt > 0.0001) {
        mr = 1 + tt * 0.22; mg = 1 + tt * 0.05; mb = 1 - tt * 0.24
        d0 = LR * (1 - mr); d1 = LG * (1 - mg); d2 = LB * (1 - mb)
        Tm[0, 0] = mr + d0; Tm[0, 1] = d1;      Tm[0, 2] = d2
        Tm[1, 0] = d0;      Tm[1, 1] = mg + d1; Tm[1, 2] = d2
        Tm[2, 0] = d0;      Tm[2, 1] = d1;      Tm[2, 2] = mb + d2
        stage[++count] = "t"
      }

      if (hd < -0.0001 || hd > 0.0001) {
        a = hd * 3.14159265358979 / 180
        c1 = cos(a); s1 = sin(a)
        Hm[0, 0] = 0.213 + c1 * 0.787 - s1 * 0.213
        Hm[0, 1] = 0.715 - c1 * 0.715 - s1 * 0.715
        Hm[0, 2] = 0.072 - c1 * 0.072 + s1 * 0.928
        Hm[1, 0] = 0.213 - c1 * 0.213 + s1 * 0.143
        Hm[1, 1] = 0.715 + c1 * 0.285 + s1 * 0.140
        Hm[1, 2] = 0.072 - c1 * 0.072 - s1 * 0.283
        Hm[2, 0] = 0.213 - c1 * 0.213 - s1 * 0.787
        Hm[2, 1] = 0.715 - c1 * 0.715 + s1 * 0.715
        Hm[2, 2] = 0.072 + c1 * 0.928 + s1 * 0.072
        stage[++count] = "h"
      }

      if (count > 0) {
        for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) M[i, j] = (i == j) ? 1 : 0
        for (i = 1; i <= count; i++) {
          if (stage[i] == "s") matmul(Sm, M, R)
          else if (stage[i] == "t") matmul(Tm, M, R)
          else matmul(Hm, M, R)
          copymat(R, M)
        }
        # A mixer coefficient may not leave -2..2. The product can, at the far
        # corner of saturation and hue together; no single one of the three
        # ever does. So when the product will not fit, they go over as one
        # mixer each -- a clip between them, which the combined form avoids,
        # but a far smaller error than a coefficient quietly cut to 2.
        if (peak(M) <= 2) {
          parts[++n] = mixer(M)
        } else {
          for (i = 1; i <= count; i++) {
            if (stage[i] == "s") parts[++n] = mixer(Sm)
            else if (stage[i] == "t") parts[++n] = mixer(Tm)
            else parts[++n] = mixer(Hm)
          }
        }
      }

      out = ""
      for (i = 1; i <= n; i++) out = (i == 1) ? parts[i] : out "," parts[i]
      printf "%s", out
    }
  '
}

color_grade_summary_text() {
  printf "brightness %+d%%, contrast %+d%%, saturation %+d%%, temperature %+d%%, hue shift %+d%%" \
    "$COLOR_GRADE_BRIGHTNESS" "$COLOR_GRADE_CONTRAST" "$COLOR_GRADE_SATURATION" \
    "$COLOR_GRADE_TEMPERATURE" "$COLOR_GRADE_HUE"
}

# Asks for one dial. The answer comes back in COLOR_GRADE_DIAL_VALUE rather
# than on stdout, because the prompt shares that stream.
COLOR_GRADE_DIAL_VALUE=0
color_grade_ask_dial() {
  local label="$1" current="$2" answer
  read -r -p "$(ui_prompt "${label} % [${current}]")" answer
  answer="${answer:-$current}"
  while ! color_grade_percent_valid "$answer"; do
    log_warn "Enter a whole number from -100 to 100."
    read -r -p "$(ui_prompt "${label} % [${current}]")" answer
    answer="${answer:-$current}"
  done
  COLOR_GRADE_DIAL_VALUE="${answer#+}"
}

choose_color_grade() {
  local choice

  ui_section "STEP 13 OPTIONS  -  COLOR GRADE"
  printf "   Five dials, each from -100%% to 100%%. Zero leaves it alone.\n"
  printf "   %2d  %s\n" 1 "Enhance (contrast +5%, saturation +10%, hue shift +5%)"
  printf "   %2d  %s\n" 2 "Set each dial myself"
  read -r -p "$(ui_prompt 'Grade [1]')" choice
  choice="${choice:-1}"
  while true; do
    case "$choice" in
      1|e|E|enhance|Enhance|ENHANCE)
        COLOR_GRADE_BRIGHTNESS="${COLOR_GRADE_ENHANCE[0]}"
        COLOR_GRADE_CONTRAST="${COLOR_GRADE_ENHANCE[1]}"
        COLOR_GRADE_SATURATION="${COLOR_GRADE_ENHANCE[2]}"
        COLOR_GRADE_TEMPERATURE="${COLOR_GRADE_ENHANCE[3]}"
        COLOR_GRADE_HUE="${COLOR_GRADE_ENHANCE[4]}"
        break
        ;;
      2|c|C|custom|Custom|CUSTOM)
        while true; do
          printf "\n"
          color_grade_ask_dial "Brightness" "$COLOR_GRADE_BRIGHTNESS"
          COLOR_GRADE_BRIGHTNESS="$COLOR_GRADE_DIAL_VALUE"
          color_grade_ask_dial "Contrast" "$COLOR_GRADE_CONTRAST"
          COLOR_GRADE_CONTRAST="$COLOR_GRADE_DIAL_VALUE"
          color_grade_ask_dial "Saturation" "$COLOR_GRADE_SATURATION"
          COLOR_GRADE_SATURATION="$COLOR_GRADE_DIAL_VALUE"
          color_grade_ask_dial "Hue shift" "$COLOR_GRADE_HUE"
          COLOR_GRADE_HUE="$COLOR_GRADE_DIAL_VALUE"
          color_grade_ask_dial "Temperature" "$COLOR_GRADE_TEMPERATURE"
          COLOR_GRADE_TEMPERATURE="$COLOR_GRADE_DIAL_VALUE"
          if [[ -n "$(color_grade_filter_chain)" ]]; then
            break
          fi
          log_warn "Every dial is at zero, which would re-encode every file and change nothing."
        done
        break
        ;;
      *)
        log_warn "Choose 1 for Enhance or 2 to set the dials."
        read -r -p "$(ui_prompt 'Grade [1]')" choice
        choice="${choice:-1}"
        ;;
    esac
  done

  log_info "Step 13 color grade set: $(color_grade_summary_text)."
}

color_grade_ffmpeg() {
  ffmpeg -nostdin -hide_banner -loglevel error -y "$@"
}

# The chain is computed in floating point (see COLOR_GRADE_WORK_FMT below),
# and a float frame handed to an encoder comes out at whatever depth that
# encoder likes best -- which for PNG is 16-bit, and with an alpha plane in
# play, RGBA. Neither is what went in. So the frame is pinned back to the
# depth and the channels the source actually had, read off it here.
COLOR_GRADE_WORK_FMT="gbrpf32le"
COLOR_GRADE_OUT_FMT="rgb24"
color_grade_pixel_formats() {
  local file="$1" pf
  pf="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt \
        -of csv=p=0 "$file" 2>/dev/null | head -n 1 || true)"
  case "$pf" in
    rgba|bgra|argb|abgr|ya8|pal8|rgba64*|bgra64*|ya16*|yuva*|gbrap*)
      COLOR_GRADE_WORK_FMT="gbrapf32le"
      case "$pf" in
        *64*|*16*) COLOR_GRADE_OUT_FMT="rgba64le" ;;
        *) COLOR_GRADE_OUT_FMT="rgba" ;;
      esac
      ;;
    *)
      COLOR_GRADE_WORK_FMT="gbrpf32le"
      case "$pf" in
        *48*|*16*) COLOR_GRADE_OUT_FMT="rgb48le" ;;
        *) COLOR_GRADE_OUT_FMT="rgb24" ;;
      esac
      ;;
  esac
}

color_grade_process_image() {
  local file="$1" chain="$2" workdir="$3"
  local ext final staged

  ext="$(printf "%s" "${file##*.}" | tr '[:upper:]' '[:lower:]')"
  final="${workdir}/out.${ext}"
  staged="${workdir}/graded.png"
  rm -f "$final" "$staged"

  # Every ffmpeg filter clips its output to the range of the format it is
  # working in, and the app's does not clip until the end -- so an 8-bit chain
  # loses a highlight that brightness pushed past white and contrast or hue
  # would have brought back. Running the chain in float keeps that headroom,
  # which is the whole reason for the two format filters wrapped around it.
  color_grade_pixel_formats "$file"
  local vf="format=${COLOR_GRADE_WORK_FMT},${chain},format=${COLOR_GRADE_OUT_FMT}"

  case "$ext" in
    jpg|jpeg)
      if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 -q:v 2 "$final" \
         || [[ ! -s "$final" ]]; then
        return 1
      fi
      ;;
    png)
      if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 "$final" \
         || [[ ! -s "$final" ]]; then
        return 1
      fi
      ;;
    webp)
      # cwebp, the same encoder the recompress step uses -- ffmpeg is often
      # built without libwebp, so its own WebP encoder cannot be relied on.
      if command -v cwebp >/dev/null 2>&1; then
        if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 "$staged" \
           || [[ ! -s "$staged" ]]; then
          return 1
        fi
        if ! cwebp -quiet -q 90 "$staged" -o "$final" >/dev/null 2>&1 \
           || [[ ! -s "$final" ]]; then
          return 1
        fi
      else
        if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 \
              -c:v libwebp -quality 90 "$final" \
           || [[ ! -s "$final" ]]; then
          return 1
        fi
      fi
      ;;
    avif)
      # Same split the VHS step makes: avifenc when it is there, because it is
      # the better encoder, and ffmpeg's own AVIF muxer when it is not.
      if command -v avifenc >/dev/null 2>&1; then
        if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 "$staged" \
           || [[ ! -s "$staged" ]]; then
          return 1
        fi
        if ! avifenc -q 70 -s 6 "$staged" "$final" >/dev/null 2>&1 \
           || [[ ! -s "$final" ]]; then
          return 1
        fi
      else
        if ! color_grade_ffmpeg -i "$file" -vf "$vf" -frames:v 1 -q:v 2 "$final" \
           || [[ ! -s "$final" ]]; then
          return 1
        fi
      fi
      ;;
    *)
      return 1
      ;;
  esac

  mv -f "$final" "$file"
  rm -f "$staged"
  return 0
}

color_grade_process_video() {
  local file="$1" chain="$2" workdir="$3"
  local final="${workdir}/out.mp4"
  # Float for the same reason as the still path; the encoder settles the
  # output format, so only the working one has to be asked for.
  local vf="format=gbrpf32le,${chain}"

  rm -f "$final"
  if color_grade_ffmpeg -i "$file" -map 0:v:0 -map 0:a? -vf "$vf" \
        -c:v libx264 -crf 18 -pix_fmt yuv420p \
        -c:a copy -movflags +faststart "$final" \
     && [[ -s "$final" ]]; then
    mv -f "$final" "$file"
    return 0
  fi

  # An audio stream the MP4 container will not take has to be re-encoded.
  rm -f "$final"
  if color_grade_ffmpeg -i "$file" -map 0:v:0 -map 0:a? -vf "$vf" \
        -c:v libx264 -crf 18 -pix_fmt yuv420p \
        -c:a aac -b:a 192k -movflags +faststart "$final" \
     && [[ -s "$final" ]]; then
    mv -f "$final" "$file"
    return 0
  fi

  rm -f "$final"
  return 1
}

step_color_grade() {
  local images=() videos=()
  local file chain workdir
  local i total all_total=0 all_done=0
  local img_done=0 img_failed=0
  local vid_done=0 vid_failed=0

  chain="$(color_grade_filter_chain)"
  if [[ -z "$chain" ]]; then
    log_warn "Every color dial is at zero. Nothing to grade."
    return 0
  fi

  while IFS= read -r -d '' file; do
    images+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
              -o -path "./${VHS_TEST_FOLDER_NAME}" \
              -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
      -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \
                 -o -iname "*.webp" -o -iname "*.avif" \) \
      ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
      -print0
  )

  while IFS= read -r -d '' file; do
    videos+=("$file")
  done < <(
    find . \( -path "./${EMPTY_ITEMS_BUCKET_NAME}" -o -path "./${SIMILAR_ITEMS_BUCKET_NAME}" \
              -o -path "./${VHS_TEST_FOLDER_NAME}" \
              -o -path "./.local-gallery" -o -path "./.git" \) -prune -o \
      -type f -iname "*.mp4" \
      ! -name "*_temp*" ! -name "*_scaled_temp*" ! -name "*_vhs_temp*" ! -name "*_final_temp*" \
      -print0
  )

  all_total=$(( ${#images[@]} + ${#videos[@]} ))
  if [[ "$all_total" -eq 0 ]]; then
    log_warn "No images or MP4 videos found to color grade."
    return 0
  fi

  workdir="$(mktemp -d "${TMPDIR:-/tmp}/local_gallery_grade.XXXXXX")"
  log_info "Color grading $all_total file(s): $(color_grade_summary_text)."

  total=${#images[@]}
  for (( i=0; i<total; i++ )); do
    file="${images[$i]}"
    if color_grade_process_image "$file" "$chain" "$workdir"; then
      img_done=$((img_done + 1))
    else
      img_failed=$((img_failed + 1))
      log_err "Color grade failed: $file"
    fi
    all_done=$((all_done + 1))
    progress_draw "Step 13 Color" "$all_done" "$all_total"
  done

  total=${#videos[@]}
  for (( i=0; i<total; i++ )); do
    file="${videos[$i]}"
    if color_grade_process_video "$file" "$chain" "$workdir"; then
      vid_done=$((vid_done + 1))
    else
      vid_failed=$((vid_failed + 1))
      log_err "Color grade failed: $file"
    fi
    all_done=$((all_done + 1))
    progress_draw "Step 13 Color" "$all_done" "$all_total"
  done

  rm -rf "$workdir"

  log_info "Step 13 color grade summary:"
  summary_item "Brightness" "$(printf '%+d%%' "$COLOR_GRADE_BRIGHTNESS")"
  summary_item "Contrast" "$(printf '%+d%%' "$COLOR_GRADE_CONTRAST")"
  summary_item "Saturation" "$(printf '%+d%%' "$COLOR_GRADE_SATURATION")"
  summary_item "Temperature" "$(printf '%+d%%' "$COLOR_GRADE_TEMPERATURE")"
  summary_item "Hue shift" "$(printf '%+d%%' "$COLOR_GRADE_HUE")"
  summary_item "Images processed" "$img_done"
  summary_item "Images failed" "$img_failed"
  summary_item "Videos processed" "$vid_done"
  summary_item "Videos failed" "$vid_failed"
}

main() {
  local input token confirm
  local selected=() raw=() invalid=()
  local sorted=() valid_selected=()
  local num fn desc selected_num runnable

  printf "\n"
  ui_banner "LOCAL GALLERY CLEANER" "v${SCRIPT_VERSION}"
  printf "  %sworking directory%s  %s%s%s\n" "$C_DIM" "$C_RESET" "$C_BOLD" "$PWD" "$C_RESET"
  ensure_prerequisites

  ui_box_top
  ui_box_line "SELECT STEPS TO RUN" "$C_BOLD$C_WHITE"
  ui_box_sep
  ui_box_line "$(printf '  %2s   %s' "0" "Core cleanup (steps 1-5)")"
  for num in "${STEP_ORDER[@]}"; do
    ui_box_line "$(printf '  %2d   %s' "$num" "$(step_description "$num")")"
  done
  ui_box_bottom
  read -r -p "$(ui_prompt 'Steps (example: 1,2,4-6)')" input
  input="${input// /}"

  if [[ "$input" == "0" ]]; then
    selected=(1 2 3 4 5)
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
    if [[ "$num" -lt 1 || "$num" -gt 15 ]]; then
      log_warn "Skipping out-of-range step: $num"
      continue
    fi
    runnable=0
    for selected_num in "${STEP_ORDER[@]}"; do
      if [[ "$selected_num" == "$num" ]]; then
        runnable=1
        break
      fi
    done
    if [[ "$runnable" -eq 0 ]]; then
      log_warn "Skipping unavailable step: $num"
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

  ui_section "RUN PLAN"
  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
    printf "   %s%2d%s  %s\n" "$C_BOLD$C_CYAN" "$num" "$C_RESET" "$(step_description "$num")"
  done

  # Tools first: a step that cannot run should say so before you answer its
  # questions and before the earlier steps have already reshaped the folder.
  # (ntsc-rs for step 12 and Optimage for step 5 are apps, not formulas, so
  # ensure_prerequisites above cannot have caught them.)
  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
    ensure_step_requirements "$num"
  done

  for num in "${valid_selected[@]+"${valid_selected[@]}"}"; do
    case "$num" in
      6) choose_step8_trim_seconds ;;
      7) choose_step9_trim_end_seconds ;;
      11) choose_step12_delete_criteria ;;
      12) choose_step13_vhs_scale ;;
      13) choose_color_grade ;;
      15) choose_step15_pace ;;
    esac
  done

  printf "\n"
  read -r -p "$(ui_prompt 'Proceed? [y/N]')" confirm
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
    run_step "$num" "$fn" "$desc"
  done

  printf "\n"
  ui_banner "DONE" "all selected steps finished"
}

main "$@"
