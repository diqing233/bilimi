import { createNotePosterCopyParts, normalizeNotePosterTextForDisplay } from '@shared/videoNoteArchive'

type SummaryBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

function textBetweenHeadings(value: string, startHeading: string, endHeadings: readonly string[]): string {
  const startMatch = new RegExp(`^##\\s+${startHeading}(?:（\\d+）)?\\s*$`, 'mu').exec(value)
  if (!startMatch) return ''
  const rest = value.slice(startMatch.index + startMatch[0].length)
  if (!endHeadings.length) return rest.trim()
  const endIndex = rest.search(new RegExp(`^##\\s+(?:${endHeadings.join('|')})(?:（\\d+）)?\\s*$`, 'mu'))
  return (endIndex >= 0 ? rest.slice(0, endIndex) : rest).trim()
}

function removeLeadingHeading(value: string, heading: string): string {
  return value.replace(new RegExp(`^##\\s+${heading}(?:（\\d+）)?\\s*`, 'u'), '').trim()
}

function readTitleAndBody(value: string): { title: string; body: string } {
  const titleMatch = /^###\s+(.+)$/mu.exec(value)
  if (!titleMatch) return { title: '', body: value.trim() }
  return {
    title: titleMatch[1]!.trim(),
    body: `${value.slice(0, titleMatch.index)}${value.slice(titleMatch.index + titleMatch[0].length)}`.trim()
  }
}

function splitMarkdownBlocks(value: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  const flushParagraph = () => {
    const text = paragraphLines.join(' ').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    paragraphLines = []
  }
  const flushList = () => {
    if (listItems.length) blocks.push({ type: 'list', items: listItems })
    listItems = []
  }

  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim()
    const listMatch = /^[-*+]\s+(.+)$/u.exec(line)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1]!.trim())
    } else if (line) {
      flushList()
      paragraphLines.push(line)
    } else {
      flushParagraph()
      flushList()
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

function SummaryBlocks({ content, listClassName, listLabel }: { content: string; listClassName: string; listLabel: string }) {
  return <>
    {splitMarkdownBlocks(content).map((block, index) =>
      block.type === 'list' ? (
        <ul key={`${listLabel}:list:${index}`} className={listClassName} aria-label={listLabel}>
          {block.items.map((item, itemIndex) => <li key={`${itemIndex}:${item}`}>{item}</li>)}
        </ul>
      ) : (
        <p key={`${listLabel}:paragraph:${index}`} className="video-notes__summary-paragraph">{block.text}</p>
      )
    )}
  </>
}

export function DeepSeekSummaryDocument({ summaryText }: { summaryText: string }) {
  const displayText = normalizeNotePosterTextForDisplay(summaryText)
  const hasStructuredSummary = /^##\s+(?:精准总结|精修文稿|详细内容提要|待人工确认)/mu.test(displayText)
  if (!hasStructuredSummary) return <section className="video-notes__summary-result" aria-label="DeepSeek 总结">
    <pre className="video-notes__summary-raw-text">{displayText}</pre>
  </section>

  const copyParts = createNotePosterCopyParts(displayText)
  const preciseSummary = copyParts.summaryText.replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '').trim()
  const { title, body } = readTitleAndBody(removeLeadingHeading(preciseSummary, '精准总结'))
  const reviewText = textBetweenHeadings(displayText, '待人工确认', [])

  return <section className="video-notes__summary-result" aria-label="DeepSeek 总结">
    <article className="video-notes__summary-section video-notes__summary-section--precise">
      <h4>精准总结</h4>
      {title ? <p className="video-notes__summary-document-title">{title}</p> : null}
      <SummaryBlocks content={body} listClassName="video-notes__summary-points" listLabel="精准总结要点" />
    </article>
    {copyParts.detailedOutlineText ? <article className="video-notes__summary-section">
      <h4>详细内容提要</h4>
      <SummaryBlocks content={copyParts.detailedOutlineText} listClassName="video-notes__summary-outline" listLabel="详细内容提要" />
    </article> : null}
    {copyParts.polishedTranscriptText ? <article className="video-notes__summary-section">
      <h4>精修文稿</h4>
      <pre className="video-notes__summary-polished-text">{copyParts.polishedTranscriptText}</pre>
    </article> : null}
    {reviewText ? <article className="video-notes__summary-section">
      <h4>待人工确认</h4>
      <SummaryBlocks content={reviewText} listClassName="video-notes__summary-outline" listLabel="待人工确认" />
    </article> : null}
  </section>
}
