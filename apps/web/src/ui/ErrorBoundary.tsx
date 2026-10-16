import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps one broken screen from blanking the whole register; the sidebar stays usable. */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen failed to draw", error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel">
        <h2>This screen hit a problem</h2>
        <p className="muted">Your data is safe. Reload the page, or pick another section from the menu.</p>
        <div>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </section>
    );
  }
}
