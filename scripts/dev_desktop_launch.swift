import AppKit
import Darwin

// Launch Services gives the development app its own privacy identity. A direct
// exec inherits the terminal's TCC responsibility, even inside Electron.app.
let args = CommandLine.arguments
guard args.count >= 4 else { exit(64) }
let bundle = URL(fileURLWithPath: args[1])
let pidFile = URL(fileURLWithPath: args[2])
let configuration = NSWorkspace.OpenConfiguration()
configuration.createsNewApplicationInstance = true
configuration.allowsRunningApplicationSubstitution = false
configuration.addsToRecentItems = false
configuration.arguments = Array(args.dropFirst(3))
configuration.environment = ProcessInfo.processInfo.environment

var application: NSRunningApplication?
var interrupted: Int32?
var exitWatch: DispatchSourceRead?
func stopApplication(_ app: NSRunningApplication) {
    guard !app.isTerminated else { return }
    kill(app.processIdentifier, SIGTERM)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
        if !app.isTerminated { kill(app.processIdentifier, SIGKILL) }
    }
}
var signals: [DispatchSourceSignal] = []
for number in [SIGINT, SIGTERM] {
    signal(number, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler {
        interrupted = number
        if let application { stopApplication(application) }
    }
    source.resume()
    signals.append(source)
}
NSWorkspace.shared.openApplication(at: bundle, configuration: configuration) { app, error in
    DispatchQueue.main.async {
        guard let app else {
            fputs("Development app launch failed: \(error?.localizedDescription ?? "No process returned")\n", stderr)
            exit(1)
        }
        application = app
        let queue = kqueue()
        var registration = kevent(ident: UInt(app.processIdentifier), filter: Int16(EVFILT_PROC),
                                  flags: UInt16(EV_ADD | EV_ONESHOT), fflags: NOTE_EXIT | UInt32(NOTE_EXITSTATUS), data: 0, udata: nil)
        guard queue >= 0, kevent(queue, &registration, 1, nil, 0, nil) == 0 else {
            if !app.isTerminated { kill(app.processIdentifier, SIGTERM) }
            fputs("Development app exit could not be supervised.\n", stderr)
            exit(1)
        }
        let watch = DispatchSource.makeReadSource(fileDescriptor: queue, queue: .main)
        watch.setEventHandler {
            var event = kevent()
            var timeout = timespec()
            guard kevent(queue, nil, 0, &event, 1, &timeout) == 1 else { return }
            let status = Int32(event.data)
            let signal = status & 0x7f
            exit(interrupted.map { 128 + $0 } ?? (signal == 0 ? (status >> 8) & 0xff : 128 + signal))
        }
        watch.setCancelHandler { close(queue) }
        exitWatch = watch
        watch.resume()
        do {
            try Data("\(app.processIdentifier)\n".utf8).write(to: pidFile, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: pidFile.path)
        } catch {
            kill(app.processIdentifier, SIGTERM)
            fputs("Development PID could not be recorded.\n", stderr)
            exit(1)
        }
        if interrupted != nil { stopApplication(app) }
    }
}
RunLoop.main.run()
