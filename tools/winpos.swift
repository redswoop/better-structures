import CoreGraphics
import Foundation
// Prints "id pid x y w h" for the game window (the one titled Minecraft).
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list {
    let name = w[kCGWindowName as String] as? String ?? ""
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    if name == "Minecraft", let x = b["X"] as? Double, let y = b["Y"] as? Double, let wd = b["Width"] as? Double, let ht = b["Height"] as? Double {
        print("\(w[kCGWindowNumber as String] as? Int ?? 0) \(w[kCGWindowOwnerPID as String] as? Int ?? 0) \(Int(x)) \(Int(y)) \(Int(wd)) \(Int(ht))")
    }
}
