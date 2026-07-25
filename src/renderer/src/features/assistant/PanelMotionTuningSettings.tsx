import { useEffect, useState } from 'react'
import {
  panelMotionTuning,
  resetPanelMotionTuning,
  subscribePanelMotionTuning,
  updatePanelMotionTuning,
  type PanelMotionTuning
} from './panelMotionTuning'

const CONTROLS: Array<{ key: keyof PanelMotionTuning; label: string }> = [
  { key: 'sidebarExpandMs', label: '右侧助手栏展开' },
  { key: 'sidebarCollapseMs', label: '右侧助手栏折叠时长' },
  { key: 'sidebarCollapseOffsetPx', label: '右侧助手栏收起位移' },
  { key: 'drawerExpandMs', label: '小咪收藏库展开' },
  { key: 'drawerCollapseMs', label: '小咪收藏库收起时长' },
  { key: 'drawerCloseMs', label: '小咪收藏库关闭' },
  { key: 'drawerCollapseOffsetPx', label: '小咪收藏库收起位移' }
]

export function PanelMotionTuningSettings() {
  const [tuning, setTuning] = useState(panelMotionTuning)

  useEffect(() => subscribePanelMotionTuning(setTuning), [])

  return (
    <fieldset className="assistant-settings__group assistant-settings__group--motion-tuning" data-settings-section="motion-tuning">
      <legend>面板动效</legend>
      <p>拖动后立即作用于当前窗口，并保存在本机设备设置中。</p>
      <div className="panel-motion-tuning" aria-label="面板动效微调">
        {CONTROLS.map(({ key, label }) => {
          const isOffset = key.endsWith('OffsetPx')
          return <label key={key}>
            <span>{label} <output>{tuning[key]} {isOffset ? 'px' : 'ms'}</output></span>
            <input
              type="range"
              min={isOffset ? '4' : '100'}
              max={isOffset ? '28' : '300'}
              step={isOffset ? '1' : '5'}
              value={tuning[key]}
              aria-label={label}
              onChange={(event) => updatePanelMotionTuning({ [key]: Number(event.currentTarget.value) })}
            />
          </label>
          })}
        <button type="button" className="panel-motion-tuning__reset" onClick={resetPanelMotionTuning}>恢复默认</button>
      </div>
    </fieldset>
  )
}
