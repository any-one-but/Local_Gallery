// lg-auth: the checks behind the app's lock -- Touch ID (or an Apple Watch)
// and the Mac's own login password -- with no window of its own. The gallery's
// lock screen is the whole of the UI (frontend/js/features/passcode-lock.js);
// this only answers.
//
//   lg-auth check     -> {"available":bool,"biometrics":bool}
//   lg-auth touchid "<reason>"
//                     -> ok | cancel | failed | unavailable
//                        Waits for a finger (or the Watch). SIGTERM ends it
//                        with "cancel" -- the app does that when the password
//                        is typed instead, or the lock screen goes away.
//   lg-auth password  (the password on stdin)
//                     -> ok | wrong | failed
//
// Why there is no macOS dialog. macOS's own (LAContext.evaluatePolicy, drawn
// by its coreautha process) goes where macOS puts it -- high up, centred
// beside the Dock -- and nothing moves it, LARight.authorize(in: window)
// included (measured). So the fingerprint check runs through Apple's
// LAAuthenticationView, which takes it out of the dialog and into a view of
// the asker's; that view sits in a window nobody can see (alpha 0, out of the
// way), so the check runs with no UI at all and the lock screen draws its own.
// The check itself is still macOS's.
//
// The password is checked by macOS's directory service (OpenDirectory,
// ODRecord.verifyPassword) against the logged-in account. It arrives on stdin
// rather than as an argument, so it never shows in a process listing, and is
// not kept.
//
// Electron's systemPreferences.promptTouchID only offers macOS's dialog, which
// is why there is a helper at all. It is built by scripts/build-auth-helper.js
// and copied into Contents/Resources.

import AppKit
import Foundation
import LocalAuthentication
import LocalAuthenticationEmbeddedUI
import OpenDirectory

func emit(_ s: String) {
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "check"

// Touch ID or a paired Apple Watch -- whatever this Mac can do without typing.
func biometricPolicy() -> LAPolicy {
  if #available(macOS 15.0, *) { return .deviceOwnerAuthenticationWithBiometricsOrCompanion }
  return .deviceOwnerAuthenticationWithBiometricsOrWatch
}

switch mode {
case "check":
  let available = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
  let bio = LAContext().canEvaluatePolicy(biometricPolicy(), error: nil)
  emit("{\"available\":\(available),\"biometrics\":\(bio)}")
  exit(0)

case "password":
  let data = FileHandle.standardInput.readDataToEndOfFile()
  var password = String(data: data, encoding: .utf8) ?? ""
  if password.hasSuffix("\n") { password.removeLast() }
  if password.isEmpty {
    emit("wrong")
    exit(0)
  }
  do {
    let node = try ODNode(session: ODSession.default(), type: ODNodeType(kODNodeTypeAuthentication))
    let record = try node.record(withRecordType: kODRecordTypeUsers, name: NSUserName(), attributes: nil)
    do {
      try record.verifyPassword(password)
      emit("ok")
    } catch {
      emit("wrong")
    }
  } catch {
    emit("failed")
  }
  exit(0)

case "touchid":
  break

default:
  emit("failed")
  exit(2)
}

let reason = args.count > 2 && !args[2].isEmpty ? args[2] : "unlock Local Gallery"
let context = LAContext()
if !context.canEvaluatePolicy(biometricPolicy(), error: nil) {
  emit("unavailable")
  exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// The view has to live in a window; this one is never seen and never takes a
// click or the keyboard.
let host = NSPanel(
  contentRect: NSRect(x: 0, y: 0, width: 56, height: 56),
  styleMask: [.borderless, .nonactivatingPanel],
  backing: .buffered,
  defer: false
)
host.alphaValue = 0
host.ignoresMouseEvents = true
host.hasShadow = false
let view = LAAuthenticationView(context: context, controlSize: .regular)
view.frame = NSRect(x: 0, y: 0, width: 56, height: 56)
host.contentView?.addSubview(view)
host.orderFrontRegardless()

var answered = false
func answer(_ word: String) {
  if answered { return }
  answered = true
  context.invalidate()
  emit(word)
  exit(0)
}

context.evaluatePolicy(biometricPolicy(), localizedReason: reason) { ok, error in
  DispatchQueue.main.async {
    if ok {
      answer("ok")
      return
    }
    switch (error as? LAError)?.code {
    case .userCancel?, .appCancel?, .systemCancel?:
      answer("cancel")
    default:
      // Too many misses, a lockout, Touch ID went away: the password is the
      // way in, and the lock screen says so.
      answer("failed")
    }
  }
}

signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { answer("cancel") }
term.resume()
app.run()
