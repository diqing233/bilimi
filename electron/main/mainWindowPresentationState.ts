export type MainWindowPresentationState = { visible: boolean; minimized: boolean }

type MainWindowPresentationTarget = { isVisible: () => boolean; isMinimized: () => boolean }

export function getMainWindowPresentationState(window: MainWindowPresentationTarget | null): MainWindowPresentationState {
  return window ? { visible: window.isVisible(), minimized: window.isMinimized() } : { visible: false, minimized: false }
}
