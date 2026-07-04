import { Component, type ReactNode } from 'react'

/** WebGL is never load-bearing: if a Canvas throws (no GL context,
 *  driver loss), the court falls back to its static form instead of
 *  unmounting the tree. */
export class CanvasBoundary extends Component<
  { fallback: ReactNode; onError?: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError?.()
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
