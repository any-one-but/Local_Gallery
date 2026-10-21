// lg-auth: the Mac-password half of the app's lock, with no window of its own.
// The gallery's lock screen is the whole UI (frontend/js/features/
// passcode-lock.js); Touch ID is shown in the gallery's own window by the
// lg-touchid.node add-on (lg-touchid.m). This only answers.
//
//   lg-auth check     -> {"available":bool,"biometrics":bool}
//   lg-auth password  (the password on stdin)
//                     -> ok | wrong | failed
//
// Why there is no macOS dialog. macOS's own (LAContext.evaluatePolicy, drawn
// by its coreautha process) goes where macOS puts it -- high up, centred
// beside the Dock -- and nothing moves it, LARight.authorize(in: window)
// included (measured, 2026-10-21).
//
// The password is checked by macOS's directory service (OpenDirectory,
// ODRecord.verifyPassword) against the logged-in account. It arrives on stdin
// rather than as an argument, so it never shows in a process listing, and is
// not kept.
//
// Built by scripts/build-auth-helper.js and copied into Contents/Resources.

import Foundation
import LocalAuthentication
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

default:
  emit("failed")
  exit(2)
}
