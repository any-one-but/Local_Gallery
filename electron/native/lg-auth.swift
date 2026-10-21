// lg-auth: asks macOS to confirm the person at the Mac is its owner -- Touch ID
// (or an Apple Watch) where there is one, else, or on "Use Password...", the
// Mac's own login password. The app's lock uses this instead of a passcode of
// its own.
//
// Electron's systemPreferences.promptTouchID only offers the fingerprint
// (LAPolicyDeviceOwnerAuthenticationWithBiometrics), with no way to fall back
// to the password, so this small helper asks for the wider policy
// (LAPolicyDeviceOwnerAuthentication). It is built by
// scripts/build-auth-helper.js and copied into Contents/Resources.
//
//   lg-auth check              -> {"available":bool,"biometrics":bool}
//   lg-auth prompt "<reason>"  -> one word: ok | cancel | unavailable | failed
//                                 (last line; see "at" below)
//
// The dialog is drawn by macOS itself, by its coreautha process, and macOS
// alone decides where: centred across the main screen's visible area (beside
// the Dock, so a Dock on the left pushes it right of centre) and high up, like
// any alert. Nothing moves it -- not a window of this helper's own, not the
// asking app's window -- and LocalAuthentication has no API for it. So while
// it is up `prompt` reports where it is, one line each time that changes:
//
//   at <x> <y> <width> <height>   (points, global, top-left origin)
//
// and the app moves its lock card under it instead (electron/system-auth.js).
// Window bounds are readable without Screen Recording permission; names are
// not, which is why the dialog is found by its owner.
//
// The app gives focus back to its own window once this exits.

import Foundation
import LocalAuthentication
import CoreGraphics

func emit(_ s: String) {
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}

// The biggest window coreautha has on screen, or nil while it has none.
func dialogBounds() -> CGRect? {
  let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  var best: CGRect? = nil
  for w in info {
    let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
    if !owner.hasPrefix("coreauth") { continue }
    guard let dict = w[kCGWindowBounds as String] as? NSDictionary,
          let r = CGRect(dictionaryRepresentation: dict as CFDictionary),
          r.width > 40, r.height > 40 else { continue }
    if best == nil || r.width * r.height > best!.width * best!.height { best = r }
  }
  return best
}

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "check"

if mode == "check" {
  let ctx = LAContext()
  var err: NSError?
  let available = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
  let bio = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
  emit("{\"available\":\(available),\"biometrics\":\(bio)}")
  exit(0)
}

if mode != "prompt" {
  emit("failed")
  exit(2)
}

let reason = args.count > 2 && !args[2].isEmpty ? args[2] : "unlock Local Gallery"
let ctx = LAContext()
ctx.localizedCancelTitle = "Cancel"
var canErr: NSError?
if !ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &canErr) {
  emit("unavailable")
  exit(0)
}

let done = DispatchSemaphore(value: 0)
var answer = "failed"
ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
  if ok {
    answer = "ok"
  } else if let e = error as? LAError {
    switch e.code {
    case .userCancel, .appCancel, .systemCancel, .userFallback:
      answer = "cancel"
    case .passcodeNotSet, .biometryNotAvailable, .biometryNotEnrolled:
      answer = "unavailable"
    default:
      answer = "failed"
    }
  }
  done.signal()
}
var lastAt = ""
while done.wait(timeout: .now() + .milliseconds(60)) == .timedOut {
  if let r = dialogBounds() {
    let at = "at \(Int(r.minX)) \(Int(r.minY)) \(Int(r.width)) \(Int(r.height))"
    if at != lastAt {
      lastAt = at
      emit(at)
    }
  }
}
emit(answer)
exit(0)
