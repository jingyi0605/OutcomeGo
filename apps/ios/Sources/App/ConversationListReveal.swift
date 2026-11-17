import Observation
import SwiftUI
import UIKit

/// The hidden list's progress over the chat, kept out of the home view's own
/// state so a drag redraws only the list that follows the finger.
@MainActor @Observable final class ListReveal {
  var width: CGFloat?
  /// Counts drag updates, so a settle that a new drag interrupts leaves it alone.
  @ObservationIgnored private(set) var drags = 0
  func drag(to width: CGFloat) {
    drags += 1
    self.width = width
  }
  func clear() {
    drags += 1
    if width != nil { width = nil }
  }
}

struct ListRevealOverlay<List: View>: View {
  let reveal: ListReveal
  let listWidth: CGFloat
  /// Whether the chat still fills the screen under the list.
  let dims: Bool
  @ViewBuilder var list: List
  var body: some View {
    if let width = reveal.width {
      ZStack(alignment: .leading) {
        Color.black.opacity(dims ? 0.3 * width / max(1, listWidth) : 0).ignoresSafeArea()
        list
          .compositingGroup()
          .shadow(color: .black.opacity(dims ? 0.28 : 0), radius: 16, x: 6)
          .offset(x: width - listWidth)
      }
      .allowsHitTesting(false).accessibilityHidden(true)
    }
  }
}

extension EnvironmentValues {
  /// Off for the copy of the list an edge swipe pulls in, which is not the list
  /// whose visible rows count.
  @Entry var tracksListViewport = true
}

struct ListViewportTracking: ViewModifier {
  let id: String
  @Binding var visible: Set<String>
  @Environment(\.tracksListViewport) private var tracks
  func body(content: Content) -> some View {
    content.onScrollVisibilityChange(threshold: 0.001) { isVisible in
      guard tracks else { return }
      if isVisible { visible.insert(id) } else { visible.remove(id) }
    }
  }
}

/// A drag in from the screen's leading edge, reported as it moves. It stands
/// aside for a pushed page's own back swipe and for anything presented on top.
struct LeadingEdgeSwipe: UIViewRepresentable {
  /// The distance dragged in from the edge.
  let onChange: (CGFloat) -> Void
  /// The final distance and the speed toward the content.
  let onEnd: (CGFloat, CGFloat) -> Void
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> Anchor {
    let view = Anchor()
    view.isUserInteractionEnabled = false
    view.coordinator = context.coordinator
    return view
  }
  func updateUIView(_ view: Anchor, context: Context) {
    context.coordinator.onChange = onChange
    context.coordinator.onEnd = onEnd
  }
  static func dismantleUIView(_ view: Anchor, coordinator: Coordinator) { coordinator.attach(to: nil) }
  final class Anchor: UIView {
    weak var coordinator: Coordinator?
    override func didMoveToWindow() {
      super.didMoveToWindow()
      coordinator?.attach(to: window)
    }
  }
  @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    /// The same strip a pushed page gives its back swipe.
    static let edgeWidth: CGFloat = 32
    var onChange: (CGFloat) -> Void = { _ in }
    var onEnd: (CGFloat, CGFloat) -> Void = { _, _ in }
    private var recognizer: UIPanGestureRecognizer?
    func attach(to window: UIWindow?) {
      guard recognizer?.view !== window else { return }
      if let recognizer {
        // Removed mid-drag, it reports no end of its own.
        if recognizer.state == .began || recognizer.state == .changed { onEnd(0, 0) }
        recognizer.view?.removeGestureRecognizer(recognizer)
      }
      recognizer = nil
      guard let window else { return }
      let pan = UIPanGestureRecognizer(target: self, action: #selector(dragged))
      pan.maximumNumberOfTouches = 1
      pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
      pan.delegate = self
      window.addGestureRecognizer(pan)
      recognizer = pan
    }
    private func inward(_ x: CGFloat, in view: UIView) -> CGFloat {
      view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? -x : x
    }
    @objc private func dragged(_ pan: UIPanGestureRecognizer) {
      guard let window = pan.view else { return }
      let distance = inward(pan.translation(in: window).x, in: window)
      switch pan.state {
      case .began, .changed: onChange(distance)
      case .ended: onEnd(distance, inward(pan.velocity(in: window).x, in: window))
      case .cancelled, .failed: onEnd(0, 0)
      default: break
      }
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
      guard let window = gestureRecognizer.view as? UIWindow,
        let root = window.rootViewController, root.presentedViewController == nil,
        // A pushed page keeps the edge for going back, wherever the touch lands.
        !Self.hasPushedPage(root)
      else { return false }
      // Only where the window's edge is the screen's, not in a floating window.
      let frame = window.convert(window.bounds, to: window.screen.coordinateSpace)
      let rightToLeft = window.effectiveUserInterfaceLayoutDirection == .rightToLeft
      guard abs(rightToLeft ? frame.maxX - window.screen.bounds.maxX : frame.minX) <= 1 else { return false }
      let x = touch.location(in: window).x
      let distance = rightToLeft ? window.bounds.maxX - x : x
      return distance >= 0 && distance <= Self.edgeWidth
    }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      guard let pan = gestureRecognizer as? UIPanGestureRecognizer, let window = pan.view else { return false }
      let velocity = pan.velocity(in: window)
      return inward(velocity.x, in: window) > abs(velocity.y)
    }
    private static func hasPushedPage(_ controller: UIViewController) -> Bool {
      if let navigation = controller as? UINavigationController, navigation.viewControllers.count > 1 { return true }
      return controller.children.contains(where: hasPushedPage)
    }
    /// Replies, timestamps and scrolling in the edge strip wait for this drag to fail.
    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { otherGestureRecognizer is UIPanGestureRecognizer }
  }
}
