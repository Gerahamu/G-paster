import Foundation
import CoreGraphics
import Vision

// Window geometry only. Keep the order returned by the Window Server.
if CommandLine.arguments.dropFirst().first == "--list-windows" {
    let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let windows = entries.compactMap { entry -> [String: CGFloat]? in
        guard entry[kCGWindowLayer as String] as? Int == 0,
              (entry[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let bounds = entry[kCGWindowBounds as String] as? [String: CGFloat],
              let x = bounds["X"], let y = bounds["Y"],
              let width = bounds["Width"], let height = bounds["Height"],
              width >= 8, height >= 8 else { return nil }
        return ["x": x, "y": y, "width": width, "height": height]
    }
    let data = try JSONSerialization.data(withJSONObject: windows)
    print(String(decoding: data, as: UTF8.self))
    exit(0)
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let input = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let path = input["path"] else { continue }
    autoreleasepool {
        do {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.automaticallyDetectsLanguage = true
            let supported = try request.supportedRecognitionLanguages()
            request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"].filter { supported.contains($0) }
            try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
            let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            let result = try JSONSerialization.data(withJSONObject: ["text": text])
            print(String(decoding: result, as: UTF8.self))
        } catch {
            print("{\"error\":true}")
        }
        fflush(stdout)
    }
}
