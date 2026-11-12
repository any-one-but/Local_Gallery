// lg-touchid.node: Touch ID inside the gallery's own window.
//
// macOS only takes a fingerprint for a Touch ID view that is really on screen
// (measured with Jo, 2026-10-21: an invisible or 2%-opaque view waited forever,
// a visible one answered in about a second). So the lock screen's fingerprint
// is Apple's LAAuthenticationView, placed by this add-on exactly where the
// page draws its own glyph. It lives in the app's own process, the app that is
// in front, while the page keeps the keyboard for the password field. macOS's
// dialog is never shown: a context paired with an LAAuthenticationView draws
// its UI in the view instead.
//
// The view is in a small borderless window of its own, a child of the
// gallery's window, floating over the glyph (2026-11-12). It used to be a
// subview of the gallery's window, above the page. There Apple's view kept
// deciding it was covered -- the macOS log, for whole launches: "is not
// visible to user because it is occluded", then "will pause mechanisms" and
// BKOperation::cancel, a burst as the lock screen appeared and then every
// quarter second -- and each time the scan under the finger was cancelled:
// the print flickered without filling, or filled and drained, and unlocking
// took many tries. Nothing was over it (no window above the gallery's; the
// page's layer under it).
//
// What its watcher (AppKit's NSOcclusionDetectionView) wants, measured in a
// bare AppKit window on 2026-11-12: the view drawn solid and untransformed,
// in a part of a window that takes mouse events, with nothing over it. A
// see-through, click-through panel failed it 36 times in 8 seconds; a solid
// panel that takes the mouse, never. So the panel is opaque, filled with the
// lock screen's own colour (the page sends it, so the square cannot be seen),
// and takes mouse events (a click on it brings the gallery forward, as a
// click on the page would).
//
// Apple's view also only runs while its window is the key window, and this
// one must not be: the keyboard belongs to the page's password field. So the
// panel answers isKeyWindow with its parent's answer and passes the parent's
// become-key / resign-key notifications on as its own (LGTouchPanel).
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
//   start(handle, x, y, w, h, reason, r, g, b)
//                                      -> "started" | "unavailable" | "failed"
//        handle: BrowserWindow.getNativeWindowHandle(); x/y/w/h: points from
//        the top-left of the window's content; r/g/b: the lock screen's
//        colour there, sRGB 0..1
//   move(x, y, w, h, r, g, b)          -> undefined
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
static NSPanel *touchPanel = nil;
static NSView *hostView = nil;
static NSSize touchSize = {0, 0};
static NSMutableArray *keyObservers = nil;

// The window Apple's view sits in. Never key itself (see the top of the file):
// it reports its parent's key state as its own.
@interface LGTouchPanel : NSPanel
@end

@implementation LGTouchPanel
- (BOOL)canBecomeKeyWindow {
  return NO;
}
- (BOOL)canBecomeMainWindow {
  return NO;
}
- (BOOL)isKeyWindow {
  NSWindow *parent = self.parentWindow;
  return parent ? parent.isKeyWindow : NO;
}
// A click on the fingerprint is a click on the lock screen.
- (void)sendEvent:(NSEvent *)event {
  if (event.type == NSEventTypeLeftMouseDown) {
    [NSApp activateIgnoringOtherApps:YES];
    [self.parentWindow makeKeyAndOrderFront:nil];
    return;
  }
  [super sendEvent:event];
}
@end

// The lock screen's colour from the call's arguments (three numbers, 0..1),
// or nil when they are not there: the panel is then see-through, which works
// but trips Apple's watcher now and then.
static NSColor *readColour(napi_env env, napi_value *argv, size_t count) {
  if (count < 3) return nil;
  double c[3];
  for (int i = 0; i < 3; i++) {
    if (napi_get_value_double(env, argv[i], &c[i]) != 0 || !(c[i] >= 0 && c[i] <= 1)) return nil;
  }
  return [NSColor colorWithSRGBRed:c[0] green:c[1] blue:c[2] alpha:1];
}

static void paintPanel(NSPanel *panel, NSColor *colour) {
  panel.opaque = colour != nil;
  panel.backgroundColor = colour ?: NSColor.clearColor;
}

static LAPolicy biometricPolicy(void) {
  if (@available(macOS 15.0, *)) return LAPolicyDeviceOwnerAuthenticationWithBiometricsOrCompanion;
  return LAPolicyDeviceOwnerAuthenticationWithBiometricsOrWatch;
}

// Top-left points -> the host view's own coordinates.
static NSRect frameIn(NSView *host, double x, double y, double w, double h) {
  CGFloat top = host.isFlipped ? y : host.bounds.size.height - y - h;
  return NSMakeRect(x, top, w, h);
}

// Apple's view is a fixed size for its control size (64pt square for Regular),
// set by constraints of its own; it is shown at that size, centred on the
// page's square. (Pinned to the page's 56pt square it fought those
// constraints, and AppKit logged the conflict on every check.)
static NSRect centredOnScreen(NSView *host, double x, double y, double w, double h, NSSize size) {
  NSRect inHost = frameIn(host, x + (w - size.width) / 2, y + (h - size.height) / 2, size.width, size.height);
  return [host.window convertRectToScreen:[host convertRect:inHost toView:nil]];
}

static void removeView(void) {
  for (id token in keyObservers) [NSNotificationCenter.defaultCenter removeObserver:token];
  keyObservers = nil;
  if (touchPanel) {
    [touchPanel.parentWindow removeChildWindow:touchPanel];
    [touchPanel orderOut:nil];
  }
  touchPanel = nil;
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
  size_t argc = 9;
  napi_value argv[9] = {0};
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
  NSWindow *parent = host.window;
  if (!parent) return str(env, "failed");
  LAAuthenticationView *glyph = [[LAAuthenticationView alloc] initWithContext:c controlSize:NSControlSizeRegular];
  glyph.translatesAutoresizingMaskIntoConstraints = NO;
  NSSize size = glyph.fittingSize;
  if (!(size.width > 0 && size.height > 0)) size = NSMakeSize(r[2], r[3]);
  NSRect frame = centredOnScreen(host, r[0], r[1], r[2], r[3], size);
  LGTouchPanel *panel = [[LGTouchPanel alloc] initWithContentRect:frame
                                                        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                                                          backing:NSBackingStoreBuffered
                                                            defer:NO];
  panel.releasedWhenClosed = NO;
  paintPanel(panel, argc >= 9 ? readColour(env, argv + 6, 3) : nil);
  panel.hasShadow = NO;
  panel.hidesOnDeactivate = NO;
  panel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorTransient;
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
  [view addSubview:glyph];
  [NSLayoutConstraint activateConstraints:@[
    [glyph.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [glyph.centerYAnchor constraintEqualToAnchor:view.centerYAnchor],
  ]];
  panel.contentView = view;
  // A child window rides on the gallery's window (its space, its moves) and
  // stays above it.
  [parent addChildWindow:panel ordered:NSWindowAbove];
  [panel orderFront:nil];
  // The parent's key changes, told again as the panel's own.
  keyObservers = [NSMutableArray array];
  for (NSNotificationName name in @[ NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification ]) {
    __weak NSPanel *weakPanel = panel;
    id token = [NSNotificationCenter.defaultCenter addObserverForName:name
                                                                object:parent
                                                                 queue:nil
                                                            usingBlock:^(NSNotification *note) {
                                                              (void)note;
                                                              NSPanel *p = weakPanel;
                                                              if (p) [NSNotificationCenter.defaultCenter postNotificationName:name object:p];
                                                            }];
    [keyObservers addObject:token];
  }
  context = c;
  touchPanel = panel;
  hostView = host;
  touchSize = size;
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
  size_t argc = 7;
  napi_value argv[7] = {0};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  double r[4];
  if (argc >= 4 && touchPanel && hostView && hostView.window && readRect(env, argv, r)) {
    if (argc >= 7) paintPanel(touchPanel, readColour(env, argv + 4, 3));
    NSRect frame = centredOnScreen(hostView, r[0], r[1], r[2], r[3], touchSize);
    if (!NSEqualRects(frame, touchPanel.frame)) [touchPanel setFrame:frame display:YES];
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
