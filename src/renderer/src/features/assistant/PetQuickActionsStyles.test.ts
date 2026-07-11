import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const compactStyles = readFileSync(stylesPath, 'utf8').replace(/\s+/g, ' ')

function expectStyleSnippet(snippet: string): void {
  expect(compactStyles).toContain(snippet.replace(/\s+/g, ' '))
}

describe('pet quick action styles', () => {
  it('uses the old close prompt pill style without moving the floating pet', () => {
    expectStyleSnippet(
      '.palace-maid-pet__quick-actions { position: absolute; left: 50%; bottom: calc(var(--floating-pet-size) * 0.1);'
    )
    expectStyleSnippet(
      '.palace-maid-pet__quick-action { border: 1px solid rgba(31, 99, 181, 0.32); border-radius: 999px;'
    )
    expectStyleSnippet(
      'background: rgba(247, 251, 255, 0.96); color: var(--porcelain-text); font: 12px "Noto Serif SC", "Songti SC", "SimSun", serif;'
    )
    expectStyleSnippet('padding: 5px 10px;')
    expectStyleSnippet('.palace-maid-pet-shell { width: 336px; height: 380px;')
    expectStyleSnippet('.palace-maid-pet-shell { width: 336px; height: 380px; position: relative;')
    expectStyleSnippet('--floating-pet-size: 148px;')
    expectStyleSnippet('--floating-pet-host-height: 380px;')
    expect(compactStyles).not.toContain('--floating-pet-size: clamp(')
    expectStyleSnippet('.palace-maid-pet { width: var(--floating-pet-size); height: var(--floating-pet-size);')
  })

  it('keeps the expanded chat bubble inside the viewport and prevents press scaling', () => {
    expectStyleSnippet(
      '.palace-maid-pet__bubble[data-chat-open="true"] { left: 50%; bottom: calc(var(--floating-pet-size) + 10px);'
    )
    expectStyleSnippet('.palace-maid-pet__bubble { position: absolute; left: 50%; bottom: calc(var(--floating-pet-size) + 10px);')
    expectStyleSnippet('width: min(270px, calc(var(--floating-pet-host-width) - 8px));')
    expectStyleSnippet('max-width: min(270px, calc(var(--floating-pet-host-width) - 8px));')
    expectStyleSnippet('.palace-maid-pet__bubble[data-chat-open="true"] { left: 50%; bottom: calc(var(--floating-pet-size) + 10px); width: min(270px, calc(var(--floating-pet-host-width) - 8px));')
    expectStyleSnippet('overflow-y: auto;')
    expectStyleSnippet(
      '.palace-maid-pet__chat-compose, .palace-maid-pet__chat button[type="submit"] { flex-shrink: 0;'
    )
    expectStyleSnippet('.palace-maid-pet__chat-compose { display: flex; gap: 5px; align-items: end;')
    expect(compactStyles).not.toContain('width: min(300px, calc(var(--floating-pet-host-width) - 8px));')
    expect(compactStyles).not.toContain('width: min(255px, calc(var(--floating-pet-host-width) - 8px));')
    expect(compactStyles).not.toContain('max-width: calc(var(--floating-pet-host-width) - 8px);')
    expect(compactStyles).not.toContain('width: min(320px, calc(100vw - 8px));')
    expect(compactStyles).not.toContain('max-width: calc(100vw - 8px);')
    expectStyleSnippet('--pet-bubble-offset-x: -50%;')
    expectStyleSnippet(
      '.palace-maid-pet__resize-controls { position: absolute; right: 34px; bottom: 2px;'
    )
    expectStyleSnippet('transform: none;')
    expectStyleSnippet(
      '.palace-maid-pet__resize-controls[data-visible="true"], .palace-maid-pet__resize-controls:focus-within { opacity: 1; pointer-events: auto; transform: none;'
    )
    expectStyleSnippet('.palace-maid-pet__resize-step:active { transform: none;')
    expectStyleSnippet('.palace-maid-pet:hover, .palace-maid-pet:focus-visible { transform: translateY(-1px);')
    expectStyleSnippet('.palace-maid-pet:active, .palace-maid-pet[data-pressed="true"] { cursor: grabbing;')
    expectStyleSnippet('.palace-maid-pet[data-pressed="true"]:hover, .palace-maid-pet[data-pressed="true"]:focus-visible { transform: none;')
    expectStyleSnippet('.palace-maid-pet[data-pressed="true"] .layered-pet { animation: none; transform: none;')
    expect(compactStyles).not.toContain(
      '.palace-maid-pet:active, .palace-maid-pet[data-pressed="true"] { cursor: grabbing; transform:'
    )
    expect(compactStyles).not.toContain(
      '.palace-maid-pet:hover, .palace-maid-pet:focus-visible { transform: translateY(-1px) scale(1.02);'
    )
    expect(compactStyles).not.toContain(
      '.palace-maid-pet:active, .palace-maid-pet[data-pressed="true"] { cursor: grabbing; transform: translateY(1px) scale(0.98);'
    )
  })
})
