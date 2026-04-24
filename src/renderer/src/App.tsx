import { AssistantOverlay } from './features/assistant/AssistantOverlay'
import { BiliWebview } from './features/browser/BiliWebview'

export default function App() {
  return (
    <div className="app-shell">
      <BiliWebview />
      <AssistantOverlay />
    </div>
  )
}
