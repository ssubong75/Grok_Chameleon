import AppKit
import Foundation
import SwiftUI

private struct ScanSummary: Decodable {
    let source: String
    let target: String
    let library_items: Int
    let metadata_json: Int
    let root_media: Int
    let upload_media: Int
    let gallery_folders: Int
    let gallery_media: Int
    let prompts: Int
    let build_accounts: Int
    let imagine_accounts: Int
    let account_auth_files: Int
    let bytes: Int64
}

private enum MigrationMode {
    case scan
    case convert
    case importMedia

    var argument: String {
        switch self {
        case .scan: return "--scan"
        case .convert: return "--convert"
        case .importMedia: return "--import-media"
        }
    }

    var displayTitle: String {
        switch self {
        case .scan: return "Scan"
        case .convert: return "Convert"
        case .importMedia: return "Import"
        }
    }
}

private enum MigrationError: LocalizedError {
    case scriptMissing
    case pythonMissing
    case processFailed(Int32, String)

    var errorDescription: String? {
        switch self {
        case .scriptMissing:
            return "migration.py was not found."
        case .pythonMissing:
            return "Grok Chameleon Python was not found. Keep Migration.app next to Grok Chameleon.app."
        case let .processFailed(code, output):
            let detail = output.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty ? "Migration failed with code \(code)." : detail
        }
    }
}

private final class TextAccumulator {
    private let lock = NSLock()
    private var storage = ""

    func append(_ value: String) {
        lock.lock()
        storage += value
        lock.unlock()
    }

    func value() -> String {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private func uniqueURLs(_ urls: [URL]) -> [URL] {
    var seen = Set<String>()
    return urls.filter { seen.insert($0.standardizedFileURL.path).inserted }
}

private func grokAppCandidates() -> [URL] {
    var candidates: [URL] = []
    var cursor = Bundle.main.bundleURL.deletingLastPathComponent()
    for _ in 0..<6 {
        candidates.append(cursor.appendingPathComponent("Grok Chameleon.app", isDirectory: true))
        candidates.append(cursor.appendingPathComponent("Grok Chameleon/Grok Chameleon.app", isDirectory: true))
        let parent = cursor.deletingLastPathComponent()
        if parent.path == cursor.path { break }
        cursor = parent
    }

    let home = FileManager.default.homeDirectoryForCurrentUser
    for relative in [
        "Desktop/Grok Chameleon/Grok Chameleon.app",
        "Downloads/Grok Chameleon/Grok Chameleon.app",
        "Applications/Grok Chameleon.app",
    ] {
        candidates.append(home.appendingPathComponent(relative, isDirectory: true))
    }
    candidates.append(URL(fileURLWithPath: "/Applications/Grok Chameleon.app", isDirectory: true))

    for application in NSWorkspace.shared.runningApplications {
        guard application.localizedName == "Grok Chameleon", let bundleURL = application.bundleURL else { continue }
        candidates.append(bundleURL)
    }
    return uniqueURLs(candidates)
}

private func pythonExecutable() -> URL? {
    var candidates: [URL] = []
    for appURL in grokAppCandidates() {
        let bin = appURL.appendingPathComponent("Contents/Resources/Python/bin", isDirectory: true)
        candidates.append(bin.appendingPathComponent("python3.14"))
        candidates.append(bin.appendingPathComponent("python3"))
    }
    candidates.append(URL(fileURLWithPath: "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14"))
    candidates.append(URL(fileURLWithPath: "/usr/bin/python3"))
    return uniqueURLs(candidates).first { FileManager.default.isExecutableFile(atPath: $0.path) }
}

private func runPythonMigration(
    mode: MigrationMode,
    sourceFolder: String,
    newFolder: String,
    outputHandler: @escaping (String) -> Void
) throws -> String {
    guard let script = Bundle.main.resourceURL?.appendingPathComponent("migration.py"),
          FileManager.default.fileExists(atPath: script.path)
    else {
        throw MigrationError.scriptMissing
    }
    guard let python = pythonExecutable() else {
        throw MigrationError.pythonMissing
    }

    let process = Process()
    process.executableURL = python
    process.arguments = [
        script.path,
        mode.argument,
        "--source", sourceFolder,
        "--target", newFolder,
    ]
    process.currentDirectoryURL = script.deletingLastPathComponent()
    var environment = ProcessInfo.processInfo.environment
    environment["PYTHONNOUSERSITE"] = "1"
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    process.environment = environment

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe
    let accumulator = TextAccumulator()

    let consume: (FileHandle) -> Void = { handle in
        let data = handle.availableData
        guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
        accumulator.append(text)
        outputHandler(text)
    }
    outputPipe.fileHandleForReading.readabilityHandler = consume
    errorPipe.fileHandleForReading.readabilityHandler = consume

    try process.run()
    process.waitUntilExit()
    outputPipe.fileHandleForReading.readabilityHandler = nil
    errorPipe.fileHandleForReading.readabilityHandler = nil
    consume(outputPipe.fileHandleForReading)
    consume(errorPipe.fileHandleForReading)

    let output = accumulator.value()
    guard process.terminationStatus == 0 else {
        throw MigrationError.processFailed(process.terminationStatus, output)
    }
    return output
}

private struct MigrationButtonStyle: ButtonStyle {
    let accentColor: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.black.opacity(configuration.isPressed ? 0.72 : 0.9))
            .frame(maxWidth: .infinity, minHeight: 30)
            .background(accentColor.opacity(configuration.isPressed ? 0.78 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

private struct FolderRow: View {
    let number: Int
    let title: String
    @Binding var path: String
    let isDisabled: Bool
    let labelWidth: CGFloat
    let buttonWidth: CGFloat
    let accentColor: Color
    let browseAction: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number). \(title)")
                .font(.system(size: 14, weight: .medium))
                .frame(width: labelWidth, alignment: .leading)
            TextField("", text: $path)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, design: .monospaced))
                .disabled(isDisabled)
            Button("Select", action: browseAction)
                .buttonStyle(MigrationButtonStyle(accentColor: accentColor))
                .frame(width: buttonWidth)
                .disabled(isDisabled)
        }
    }
}

private struct ActionRow: View {
    let label: String
    let buttonTitle: String
    let isDisabled: Bool
    let labelWidth: CGFloat
    let buttonWidth: CGFloat
    let accentColor: Color
    let action: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .frame(width: labelWidth, alignment: .leading)
            Spacer()
            Button(buttonTitle, action: action)
                .buttonStyle(MigrationButtonStyle(accentColor: accentColor))
                .frame(width: buttonWidth)
                .disabled(isDisabled)
        }
    }
}

private struct MigrationView: View {
    @State private var oldFolder = ""
    @State private var newFolder = ""
    @State private var status = "Select the old and new library folders."
    @State private var logText = ""
    @State private var isRunning = false
    @State private var progress = 0.0
    @State private var progressLabel = "Ready"
    @State private var startedAt: Date?

    private let labelWidth: CGFloat = 190
    private let buttonWidth: CGFloat = 116
    private let accentColor = Color(
        red: 251.0 / 255.0,
        green: 173.0 / 255.0,
        blue: 46.0 / 255.0
    )

    var body: some View {
        VStack(spacing: 13) {
            Text("Migration")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(accentColor)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 4)

            FolderRow(
                number: 1,
                title: "Old Library Folder",
                path: $oldFolder,
                isDisabled: isRunning,
                labelWidth: labelWidth,
                buttonWidth: buttonWidth,
                accentColor: accentColor
            ) {
                browseFolder(title: "Select Old Library Folder", binding: $oldFolder)
            }

            FolderRow(
                number: 2,
                title: "New Library Folder",
                path: $newFolder,
                isDisabled: isRunning,
                labelWidth: labelWidth,
                buttonWidth: buttonWidth,
                accentColor: accentColor
            ) {
                browseFolder(title: "Select New Library Folder", binding: $newFolder, canCreate: true)
            }

            ActionRow(
                label: "3. Scan",
                buttonTitle: "Scan",
                isDisabled: isRunning || oldFolder.isEmpty || newFolder.isEmpty,
                labelWidth: labelWidth,
                buttonWidth: buttonWidth,
                accentColor: accentColor
            ) {
                runMigration(mode: .scan, sourceFolder: oldFolder)
            }

            ActionRow(
                label: "4. Convert",
                buttonTitle: "Convert",
                isDisabled: isRunning || oldFolder.isEmpty || newFolder.isEmpty,
                labelWidth: labelWidth,
                buttonWidth: buttonWidth,
                accentColor: accentColor
            ) {
                runMigration(mode: .convert, sourceFolder: oldFolder)
            }

            VStack(spacing: 7) {
                HStack {
                    Text(progressLabel)
                        .font(.system(size: 12, weight: .medium))
                    Spacer()
                    Text(progressText(for: progress))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: progress, total: 1)
                    .progressViewStyle(.linear)
                    .tint(accentColor)
            }
            .padding(.vertical, 5)
            .opacity(isRunning || progress > 0 ? 1 : 0.65)

            Text(status)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextEditor(text: $logText)
                .font(.system(size: 11, design: .monospaced))
                .frame(minHeight: 220)
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(Color.secondary.opacity(0.35), lineWidth: 1)
                )

            ActionRow(
                label: "+ Import other media",
                buttonTitle: "Import",
                isDisabled: isRunning,
                labelWidth: labelWidth,
                buttonWidth: buttonWidth,
                accentColor: accentColor
            ) {
                chooseMediaFolderAndImport()
            }
        }
        .padding(22)
        .frame(minWidth: 760, idealWidth: 800, minHeight: 610, idealHeight: 650)
        .preferredColorScheme(.dark)
    }

    private func browseFolder(
        title: String,
        binding: Binding<String>,
        canCreate: Bool = false
    ) {
        if let url = selectFolder(
            title: title,
            prompt: "Select",
            canCreate: canCreate,
            initialPath: binding.wrappedValue
        ) {
            binding.wrappedValue = url.path
        }
    }

    private func selectFolder(
        title: String,
        prompt: String,
        message: String = "",
        canCreate: Bool = false,
        initialPath: String = ""
    ) -> URL? {
        let panel = NSOpenPanel()
        panel.title = title
        panel.prompt = prompt
        panel.message = message
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = canCreate
        if !initialPath.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: initialPath, isDirectory: true)
        }
        panel.center()
        guard panel.runModal() == .OK else { return nil }
        return panel.url
    }

    private func chooseMediaFolderAndImport() {
        let target = newFolder.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            status = "Select New Library Folder."
            return
        }
        guard let mediaURL = selectFolder(
            title: "Import other media",
            prompt: "Import",
            message: "Select a folder containing images or videos.",
            initialPath: ""
        ) else {
            status = "Import cancelled."
            return
        }
        runMigration(mode: .importMedia, sourceFolder: mediaURL.path)
    }

    private func runMigration(mode: MigrationMode, sourceFolder: String) {
        let source = sourceFolder.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = newFolder.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            status = mode == .importMedia ? "Select a media folder." : "Select Old Library Folder."
            return
        }
        guard !target.isEmpty else {
            status = "Select New Library Folder."
            return
        }
        if URL(fileURLWithPath: source).standardizedFileURL == URL(fileURLWithPath: target).standardizedFileURL {
            status = mode == .importMedia
                ? "Media folder and New Library Folder cannot be the same."
                : "Old and New folders cannot be the same."
            return
        }

        isRunning = true
        progress = 0
        progressLabel = "\(mode.displayTitle) in progress"
        status = "\(mode.displayTitle) started."
        logText = ""
        startedAt = Date()

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let output = try runPythonMigration(
                    mode: mode,
                    sourceFolder: source,
                    newFolder: target
                ) { chunk in
                    DispatchQueue.main.async {
                        logText += chunk
                        updateProgress(from: logText)
                    }
                }
                DispatchQueue.main.async {
                    if mode == .scan, let summary = scanSummaryText(from: output) {
                        logText = summary
                    }
                    progress = 1
                    progressLabel = "\(mode.displayTitle) complete"
                    let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
                    status = "\(mode.displayTitle) complete. \(formatDuration(duration))"
                    isRunning = false
                }
            } catch {
                DispatchQueue.main.async {
                    progressLabel = "\(mode.displayTitle) failed"
                    status = error.localizedDescription
                    if logText.isEmpty {
                        logText = error.localizedDescription
                    }
                    isRunning = false
                }
            }
        }
    }

    private func updateProgress(from text: String) {
        guard let expression = try? NSRegularExpression(
            pattern: #"Progress:\s*(\d+)%\s*\((\d+)/(\d+)\)"#
        ) else { return }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.matches(in: text, range: range).last,
              let percentRange = Range(match.range(at: 1), in: text),
              let percent = Double(text[percentRange])
        else { return }
        progress = min(1, max(0, percent / 100))
    }

    private func scanSummaryText(from output: String) -> String? {
        guard let start = output.firstIndex(of: "{"),
              let end = output.lastIndex(of: "}")
        else { return nil }
        let jsonText = String(output[start...end])
        guard let data = jsonText.data(using: .utf8),
              let summary = try? JSONDecoder().decode(ScanSummary.self, from: data)
        else { return nil }
        return """
        3. Scan Result

        Old Library Folder : \(summary.source)
        New Library Folder : \(summary.target)
        Library items      : \(summary.library_items)
        Metadata JSON      : \(summary.metadata_json)
        Created media      : \(summary.root_media)
        Upload media       : \(summary.upload_media)
        Collection folders : \(summary.gallery_folders)
        Collection media   : \(summary.gallery_media)
        Prompts            : \(summary.prompts)
        Build accounts     : \(summary.build_accounts)
        Imagine accounts   : \(summary.imagine_accounts)
        Account auth files : \(summary.account_auth_files)
        Copy size          : \(humanSize(summary.bytes))
        """
    }

    private func humanSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    private func progressText(for value: Double) -> String {
        String(format: "%.0f%%", min(1, max(0, value)) * 100)
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return String(format: "%.1fs", seconds)
        }
        let minutes = Int(seconds) / 60
        let remainder = Int(seconds) % 60
        return "\(minutes)m \(remainder)s"
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var didCenterWindow = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            guard !self.didCenterWindow, let window = NSApp.windows.first else { return }
            self.didCenterWindow = true
            window.center()
            window.makeKeyAndOrderFront(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
private struct MigrationApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            MigrationView()
        }
        .windowResizability(.contentMinSize)
    }
}
