// lg-touchid.node: Touch ID inside the gallery's own window.
//
// macOS only takes a fingerprint for a Touch ID view that is really on screen
// (measured with Jo, 2026-10-21: an invisible or 2%-opaque view waited forever,
// a visible one answered in about a second). So the lock screen's fingerprint
// is Apple's LAAuthenticationView, placed by this add-on into the gallery's
// window exactly where the page draws its own glyph, above the page. It lives
// in the app's own process, the app that is in front, while the page keeps the
// keyboard for the password field. macOS's dialog is never shown: a context
// paired with an LAAuthenticationView draws its UI in the view instead.
//
// Built by scripts/build-auth-helper.js with clang alone (no node-gyp, no
// headers to download): the few Node-API calls it makes are declared below and
// resolved from Electron at load (-undefined dynamic_lookup). Node-API is the
// stable ABI, so the binary does not depend on the Electron version.
//
// Everything is called from Electron's main process, which is AppKit's main
// thread. The check's answer arrives on another thread, so it is left in
// `answer` and read by poll() rather than calling into JavaScript.
//
//   available()                        -> bool: Touch ID or a Watch can be used
//   start(handle, x, y, w, h, reason)  -> "started" | "unavailable" | "failed"
//        handle: BrowserWindow.getNativeWindowHandle(); x/y/w/h: points from
//        the top-left of the window's content
//   move(x, y, w, h)                   -> undefined
//   poll()                             -> "idle" | "waiting" | "ok" | "failed" | "cancel"
//   stop()                             -> undefined (removes the view, ends the check)

#import <AppKit/AppKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <LocalAuthenticationEmbeddedUI/LocalAuthenticationEmbeddedUI.h>
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>

// --- Node-API, the part used ------------------------------------------------
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

extern napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
extern napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
extern napi_status napi_get_value_double(napi_env, napi_value, double *);
extern napi_status napi_get_buffer_info(napi_env, napi_value, void **, size_t *);
extern napi_status napi_create_string_utf8(napi_env, const char *, size_t, napi_value *);
extern napi_status napi_get_value_string_utf8(napi_env, napi_value, char *, size_t, size_t *);
extern napi_status napi_get_undefined(napi_env, napi_value *);
extern napi_status napi_get_boolean(napi_env, int, napi_value *);

#define NAPI_AUTO_LENGTH SIZE_MAX

static napi_value str(napi_env env, const char *s) {
  napi_value v = NULL;
  napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v);
  return v;
}

static napi_value undef(napi_env env) {
  napi_value v = NULL;
  napi_get_undefined(env, &v);
  return v;
}

// --- State ----------------------------------------------------------------------
enum { IDLE = 0, WAITING, OK, FAILED, CANCEL };
static _Atomic int answer = IDLE;
// Bumped by every start and stop, so a late answer from an earlier check is
// ignored (the reply arrives on another thread).
static _Atomic int generation = 0;
static LAContext *context = nil;
static NSView *touchView = nil;
static NSView *hostView = nil;

static LAPolicy biometricPolicy(void) {
  if (@available(macOS 15.0, *)) return LAPolicyDeviceOwnerAuthenticationWithBiometricsOrCompanion;
  return LAPolicyDeviceOwnerAuthenticationWithBiometricsOrWatch;
}

// Top-left points -> the host view's own coordinates.
static NSRect frameIn(NSView *host, double x, double y, double w, double h) {
  CGFloat top = host.isFlipped ? y : host.bounds.size.height - y - h;
  return NSMakeRect(x, top, w, h);
}

static void removeView(void) {
  [touchView removeFromSuperview];
  touchView = nil;
  hostView = nil;
}

static void endCheck(void) {
  atomic_fetch_add(&generation, 1);
  LAContext *c = context;
  context = nil;
  [c invalidate];
  removeView();
}

static int readRect(napi_env env, napi_value *argv, double out[4]) {
  for (int i = 0; i < 4; i++) {
    if (napi_get_value_double(env, argv[i], &out[i]) != 0) return 0;
  }
  return out[2] > 0 && out[3] > 0;
}

// --- Calls ------------------------------------------------------------------------
static napi_value js_available(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value v = NULL;
  napi_get_boolean(env, [[LAContext new] canEvaluatePolicy:biometricPolicy() error:nil], &v);
  return v;
}

static napi_value js_start(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value argv[6] = {0};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 5) return str(env, "failed");
  void *data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &length) != 0 || length < sizeof(void *)) return str(env, "failed");
  NSView *handleView = (__bridge NSView *)(*(void **)data);
  NSView *host = handleView.window.contentView ?: handleView;
  double r[4];
  if (!host || !readRect(env, argv + 1, r)) return str(env, "failed");
  char reasonBuf[256] = "unlock Local Gallery";
  if (argc >= 6) napi_get_value_string_utf8(env, argv[5], reasonBuf, sizeof reasonBuf, NULL);

  endCheck();
  LAContext *c = [LAContext new];
  if (![c canEvaluatePolicy:biometricPolicy() error:nil]) return str(env, "unavailable");
  // The view draws at its own (large) size unless held to one, so it sits in
  // a holder of exactly the page's square, pinned to its edges.
  NSView *view = [[NSView alloc] initWithFrame:frameIn(host, r[0], r[1], r[2], r[3])];
  LAAuthenticationView *glyph = [[LAAuthenticationView alloc] initWithContext:c controlSize:NSControlSizeRegular];
  glyph.translatesAutoresizingMaskIntoConstraints = NO;
  [view addSubview:glyph];
  [NSLayoutConstraint activateConstraints:@[
    [glyph.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [glyph.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [glyph.topAnchor constraintEqualToAnchor:view.topAnchor],
    [glyph.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
  ]];
  // Above the page (the web contents is a sibling view).
  [host addSubview:view positioned:NSWindowAbove relativeTo:nil];
  context = c;
  touchView = view;
  hostView = host;
  atomic_store(&answer, WAITING);
  int mine = atomic_fetch_add(&generation, 1) + 1;
  NSString *reason = [NSString stringWithUTF8String:reasonBuf] ?: @"unlock Local Gallery";
  [c evaluatePolicy:biometricPolicy()
    localizedReason:reason
              reply:^(BOOL ok, NSError *error) {
                int word = FAILED;
                if (ok) {
                  word = OK;
                } else if (error.code == LAErrorUserCancel || error.code == LAErrorAppCancel ||
                           error.code == LAErrorSystemCancel) {
                  word = CANCEL;
                }
                // Only the check still current may answer.
                int expected = WAITING;
                if (atomic_load(&generation) == mine) atomic_compare_exchange_strong(&answer, &expected, word);
              }];
  return str(env, "started");
}

static napi_value js_move(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4] = {0};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  double r[4];
  if (argc >= 4 && touchView && hostView && readRect(env, argv, r)) {
    touchView.frame = frameIn(hostView, r[0], r[1], r[2], r[3]);
  }
  return undef(env);
}

static napi_value js_poll(napi_env env, napi_callback_info info) {
  (void)info;
  int a = atomic_load(&answer);
  if (a == OK || a == FAILED || a == CANCEL) {
    // An answer is read once; the view goes with it.
    atomic_store(&answer, IDLE);
    context = nil;
    removeView();
  }
  switch (a) {
    case WAITING: return str(env, "waiting");
    case OK: return str(env, "ok");
    case FAILED: return str(env, "failed");
    case CANCEL: return str(env, "cancel");
    default: return str(env, "idle");
  }
}

static napi_value js_stop(napi_env env, napi_callback_info info) {
  (void)info;
  atomic_store(&answer, IDLE);
  endCheck();
  return undef(env);
}

static void define(napi_env env, napi_value exports, const char *name, napi_callback cb) {
  napi_value fn = NULL;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL, &fn);
  napi_set_named_property(env, exports, name, fn);
}

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  define(env, exports, "available", js_available);
  define(env, exports, "start", js_start);
  define(env, exports, "move", js_move);
  define(env, exports, "poll", js_poll);
  define(env, exports, "stop", js_stop);
  return exports;
}

__attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1(void) {
  return 8;
}
