import { createDefaultFavoriteLedgers } from '../favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { classifyVideoContent } from './videoClassifier'

describe('shared video classifier', () => {
  it('classifies real UTF-8 Chinese titles with the shared rules', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '原神深渊配队攻略' }, ledgers).ledgerId).toBe('game')
  })
})
