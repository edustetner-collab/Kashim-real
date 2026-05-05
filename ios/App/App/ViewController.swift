import UIKit
import Capacitor
import WebKit

class ViewController: CAPBridgeViewController {

    /// Grants microphone and camera access when the web page calls getUserMedia().
    /// Without this, WKWebView silently denies the request and never shows the iOS permission dialog.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}
