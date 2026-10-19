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
//
// The dialog is drawn by macOS itself; the app gives focus back to its own
// window once this exits (electron/commands.js, system_auth).

import Foundation
import LocalAuthentication

func emit(_ s: String) {
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
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
done.wait()
emit(answer)
exit(0)
