import { createDefaultFavoriteLedgers } from '../favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { classifyVideoContent } from './videoClassifier'

describe('shared video classifier', () => {
  it('classifies real UTF-8 Chinese titles with the shared rules', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '原神深渊配队攻略' }, ledgers).ledgerId).toBe('game')
  })
  it('treats an exact adopted UP-author rule as high confidence', () => {
    const classification = classifyVideoContent({ author: 'UP Alpha', title: '无关标题' }, [
      { id: 'inbox', displayName: '暂存', keywords: [], enabled: true, priority: 0, isDefault: false },
      { id: 'recommended-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true, priority: 1, isDefault: false }
    ])

    expect(classification.ledgerId).toBe('recommended-up-alpha')
    expect(classification.diagnostic?.confidence).toBe('high')
  })

  it('keeps an exact UP-author match high confidence when another rule is also plausible', () => {
    const classification = classifyVideoContent({
      author: 'UP Alpha', title: 'UP Alpha music', description: 'UP Alpha music', pageText: 'UP Alpha music', category: 'UP Alpha', tags: ['UP Alpha', 'music']
    }, [
      { id: 'inbox', displayName: '暂存', keywords: [], enabled: true, priority: 0, isDefault: false },
      { id: 'recommended-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true, priority: 1, isDefault: false },
      { id: 'music', displayName: '音乐', keywords: ['music'], ruleType: 'keyword', enabled: true, priority: 2, isDefault: false }
    ])

    expect(classification.ledgerId).toBe('recommended-up-alpha')
    expect(classification.diagnostic?.confidence).toBe('high')
  })

  it('treats an exact adopted recommendation tag as high confidence', () => {
    const classification = classifyVideoContent({ title: '普通标题', tags: ['原神'] }, [
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 0, isDefault: false },
      { id: 'recommended-tag-genshin', displayName: 'bilimi·原神', keywords: ['原神'], ruleType: 'tag', enabled: true, priority: 1, isDefault: false },
      { id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword', enabled: true, priority: 2, isDefault: false }
    ])

    expect(classification.ledgerId).toBe('recommended-tag-genshin')
    expect(classification.diagnostic?.confidence).toBe('high')
  })

  it('does not promote recommendation tag text found only in the title', () => {
    const classification = classifyVideoContent({ title: '原神杂谈', tags: [] }, [
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 0, isDefault: false },
      { id: 'recommended-tag-genshin', displayName: 'bilimi·原神', keywords: ['原神'], ruleType: 'tag', enabled: true, priority: 1, isDefault: false }
    ])

    expect(classification.ledgerId).toBe('inbox')
  })
})
