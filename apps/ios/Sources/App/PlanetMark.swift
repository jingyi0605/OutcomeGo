import SwiftUI

/// The launch glyph: a monochrome planet with a ring passing behind and in front of
/// the disc, and two pill eyes cut out in the canvas colour. The geometry matches
/// Android's `PlanetMark` (a 108-unit box), and `scripts/export-launch-glyph.swift`
/// renders this same view into the static launch image, so keep them in step.
struct PlanetMark: View {
  var ink: Color
  var canvas: Color

  var body: some View {
    Canvas { context, size in
      let u = min(size.width, size.height) / 108
      func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * u, y: y * u) }
      /// Half of the tilted ring: `from`...`to` in degrees on the ellipse (0-180 is the
      /// lower, front half; 180-360 the upper, back half).
      func ring(from: Double, to: Double) -> Path {
        let tilt = -14.0 * .pi / 180
        var path = Path()
        for step in 0...96 {
          let angle = (from + (to - from) * Double(step) / 96) * .pi / 180
          let ex = 38 * cos(angle)
          let ey = 10 * sin(angle)
          let p = point(
            54 + ex * cos(tilt) - ey * sin(tilt), 58 + ex * sin(tilt) + ey * cos(tilt))
          step == 0 ? path.move(to: p) : path.addLine(to: p)
        }
        return path
      }
      func stroke(_ path: Path, _ color: Color, _ width: CGFloat, _ cap: CGLineCap) {
        context.stroke(
          path, with: .color(color),
          style: StrokeStyle(lineWidth: width * u, lineCap: cap, lineJoin: .round))
      }
      stroke(ring(from: 180, to: 360), ink, 3.2, .round)
      context.fill(
        Path(ellipseIn: CGRect(x: 30 * u, y: 28 * u, width: 48 * u, height: 48 * u)),
        with: .color(ink))
      let front = ring(from: 0, to: 180)
      stroke(front, canvas, 7.6, .butt)
      stroke(front, ink, 3.2, .round)
      for x in [46.0, 58.0] {
        context.fill(
          Path(
            roundedRect: CGRect(x: x * u, y: 45 * u, width: 5 * u, height: 12 * u),
            cornerRadius: 2.5 * u),
          with: .color(canvas))
      }
    }
    .accessibilityHidden(true)
  }
}
