import { Component, type ReactNode } from "react";
import { ErrorPanel } from "./AsyncState";

export class ScreenLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <ErrorPanel
        title="Не удалось открыть раздел"
        detail="Проверьте соединение и обновите приложение."
        onRetry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    );
  }
}
