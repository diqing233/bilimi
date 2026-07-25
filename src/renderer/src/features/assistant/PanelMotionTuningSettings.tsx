import { useEffect, useState } from 'react'
import {
  panelMotionTuning,
  resetPanelMotionTuning,
  subscribePanelMotionTuning,
  updatePanelMotionTuning,
  type PanelMotionTuning
} from './panelMotionTuning'

const EASING_OPTIONS = [
  ['cubic-bezier(0.2, 0.72, 0.24, 1)', '平滑展开'],
  ['cubic-bezier(0.16, 1, 0.3, 1)', '快速展开'],
  ['cubic-bezier(0.4, 0, 1, 1)', '平稳收起'],
  ['cubic-bezier(0.7, 0, 1, 0.5)', '利落收起']
] as const

const CONTROLS: Array<{ key: keyof PanelMotionTuning; label: string }> = [
  { key: 'sidebarExpandMs', label: '右侧助手栏展开' },
  { key: 'sidebarCollapseMs', label: '右侧助手栏折叠时长' },
  { key: 'sidebarCollapseOffsetPx', label: '右侧助手栏收起位移' },
  { key: 'drawerExpandMs', label: '小咪收藏库展开' },
  { key: 'drawerCollapseMs', label: '小咪收藏库收起时长' },
  { key: 'drawerCloseMs', label: '小咪收藏库关闭' },
  { key: 'drawerCollapseOffsetPx', label: '小咪收藏库收起位移' }
]

const EASING_CONTROLS: Array<{ key: keyof PanelMotionTuning; label: string }> = [
  { key: 'sidebarExpandEasing', label: '右侧助手栏展开缓动' },
  { key: 'sidebarCollapseEasing', label: '右侧助手栏折叠缓动' },
  { key: 'drawerExpandEasing', label: '小咪收藏库展开缓动' },
  { key: 'drawerCollapseEasing', label: '小咪收藏库收起缓动' },
  { key: 'drawerCloseEasing', label: '小咪收藏库关闭缓动' }
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
        {EASING_CONTROLS.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <select value={tuning[key]} aria-label={label} onChange={(event) => updatePanelMotionTuning({ [key]: event.currentTarget.value as PanelMotionTuning[typeof key] })}>
              {EASING_OPTIONS.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className="panel-motion-tuning__reset" onClick={resetPanelMotionTuning}>恢复默认</button>
      </div>
    </fieldset>
  )
}
