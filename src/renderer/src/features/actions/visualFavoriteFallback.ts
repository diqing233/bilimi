import type {
  AssistantAutomationResult,
  VisualAutomationContext
} from '@shared/types'

type TextBox = {
  height?: number
  text?: string
  visible?: boolean
  width?: number
  x?: number
  y?: number
}

type VisualWebview = Electron.WebviewTag & {
  capturePage?: () => Promise<{ toDataURL?: () => string }>
}

type VisualFavoriteFallbackOptions = {
  openWithShortcut?: boolean
}

const OCR_SCRIPT = `
  (async () => {
    const injectedBoxes = window.__bilimiVisualTextBoxes || window.visualTextBoxes || [];
    if (injectedBoxes.length > 0) {
      return { boxes: injectedBoxes };
    }

    const boxes = [];
    const pushBox = (element, text) => {
      const rect = element.getBoundingClientRect?.();
      const normalizedText = (text || '').replace(/\\s+/g, ' ').trim();

      if (!rect || !normalizedText || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const style = window.getComputedStyle?.(element);
      if (style?.display === 'none' || style?.visibility === 'hidden' || Number(style?.opacity || 1) === 0) {
        return;
      }

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= viewportHeight ||
        rect.left >= viewportWidth ||
        centerX < 0 ||
        centerY < 0 ||
        centerX > viewportWidth ||
        centerY > viewportHeight
      ) {
        return;
      }

      const hitElement = document.elementFromPoint?.(centerX, centerY);
      if (hitElement && element !== hitElement && !element.contains(hitElement) && !hitElement.contains(element)) {
        return;
      }

      boxes.push({
        height: rect.height,
        text: normalizedText,
        visible: true,
        width: rect.width,
        x: rect.left,
        y: rect.top
      });
    };

    const directText = (element) =>
      Array.from(element.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join(' ');
    const elementText = (element) => {
      const taggedText = [
        element.getAttribute?.('aria-label'),
        element.getAttribute?.('placeholder'),
        element.getAttribute?.('title')
      ].filter(Boolean).join(' ');
      const tagName = element.tagName?.toLowerCase?.() || '';
      const role = element.getAttribute?.('role') || '';

      if (taggedText) {
        return taggedText;
      }

      if (
        tagName === 'button' ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'label' ||
        role === 'button' ||
        element.isContentEditable
      ) {
        return element.textContent || '';
      }

      return directText(element);
    };

    document.querySelectorAll('button,[role="button"],input,textarea,[contenteditable="true"],div,span,li,label').forEach((element) => {
      pushBox(element, elementText(element));
    });

    return { boxes };
  })()
`

const SCROLL_FAVORITE_PANEL_SCRIPT = `
  (() => {
    const focusPoint = window.__bilimiFavoriteFocusPoint || null;
    const normalize = (value) => (value || '').replace(/\\s+/g, '').trim();
    const nodeText = (node) =>
      [
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title'),
        node.getAttribute?.('class'),
        node.textContent
      ].filter(Boolean).join(' ');
    const isVisible = (node) => {
      const style = window.getComputedStyle?.(node);
      const rect = node.getBoundingClientRect?.();

      return style?.display !== 'none' && style?.visibility !== 'hidden' && (!rect || rect.width > 0 || rect.height > 0);
    };
    const modalCandidates = Array.from(
      document.querySelectorAll('.bili-dialog-bomb,.fav-dialog,.favorite-dialog,[role="dialog"],[class*="dialog"],[class*="modal"]')
    ).filter(isVisible);
    const favoriteModal =
      modalCandidates.find((node) =>
        normalize(nodeText(node)).includes(normalize('添加到收藏夹')) ||
        normalize(nodeText(node)).includes(normalize('收藏夹')) ||
        normalize(nodeText(node)).includes(normalize('新建收藏夹'))
      ) || document.body;
    const preferred = Array.from(
      favoriteModal.querySelectorAll?.(
        '.fav-list,.favorite-list,.fav-container,.favorite-container,[class*="fav"][class*="list"],[class*="favorite"][class*="list"],[class*="scroll"]'
      ) || []
    );
    const scrollables = Array.from(favoriteModal.querySelectorAll?.('*') || []).filter((node) => {
      if (!('scrollTop' in node)) {
        return false;
      }

      return (node.scrollHeight || 0) > (node.clientHeight || 0);
    });
    const pointContainers = [];
    let pointNode = null;

    if (focusPoint) {
      pointNode = document.elementFromPoint(focusPoint.x, focusPoint.y);
      let cursor = pointNode;

      while (cursor) {
        if ('scrollTop' in cursor) {
          pointContainers.push(cursor);
        }

        cursor = cursor.parentElement;
      }
    }

    const containers = [...new Set([...pointContainers, ...preferred, ...scrollables, favoriteModal])];
    let moved = false;
    const diagnostics = [];

    containers.forEach((container) => {
      if (!('scrollTop' in container)) {
        return;
      }

      const before = container.scrollTop || 0;
      const distance = Math.max(container.clientHeight || 0, 420);
      container.scrollTop = Math.min((container.scrollHeight || before + distance) - (container.clientHeight || 0), before + distance);
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: distance }));
      const after = container.scrollTop || 0;
      const rect = container.getBoundingClientRect?.();
      const changed = after !== before;
      moved = moved || changed;
      diagnostics.push({
        after,
        before,
        changed,
        className: String(container.className || ''),
        clientHeight: container.clientHeight || 0,
        pointNodeClassName: String(pointNode?.className || ''),
        pointNodeTagName: pointNode?.tagName || '',
        scrollHeight: container.scrollHeight || 0,
        tagName: container.tagName || '',
        x: Math.round(rect?.left || 0),
        y: Math.round(rect?.top || 0)
      });
    });

    return {
      containers: diagnostics.slice(0, 8),
      modalClassName: String(favoriteModal.className || ''),
      moved
    };
  })()
`

const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay))

function normalize(value = '') {
  return value.replace(/\s+/g, '').trim()
}

function isVisibleBox(box: TextBox) {
  return box.visible !== false && (box.width ?? 0) > 0 && (box.height ?? 0) > 0
}

function findTextBox(boxes: TextBox[], candidates: string[]) {
  return boxes.find(
    (box) =>
      isVisibleBox(box) &&
      candidates.some((candidate) => normalize(box.text).includes(normalize(candidate)))
  )
}

function hasFavoritePanel(boxes: TextBox[]) {
  return Boolean(
    findTextBox(boxes, ['添加到收藏夹', '加入收藏夹', '收藏夹', '新建收藏夹', '创建收藏夹', '默认收藏夹'])
  )
}

function findFavoriteButton(boxes: TextBox[]) {
  return findTextBox(boxes, ['收藏', '加入收藏', '添加收藏', 'favorite', 'fav', 'collect'])
}

function findFavoriteConfirmButton(boxes: TextBox[]) {
  return findTextBox(boxes, ['确定', '确认', '完成', '保存'])
}

function isCompactActionBox(box: TextBox) {
  const textLength = normalize(box.text).length

  return (
    isVisibleBox(box) &&
    textLength > 0 &&
    textLength <= 16 &&
    (box.width ?? 0) <= 240 &&
    (box.height ?? 0) <= 72
  )
}

function findCreateFolderEntry(boxes: TextBox[]) {
  return boxes.find((box) => {
    const text = normalize(box.text)

    return (
      isCompactActionBox(box) &&
      (text === normalize('新建收藏夹') ||
        text === normalize('+新建收藏夹') ||
        text.includes(normalize('+新建收藏夹')) ||
        text === normalize('创建收藏夹'))
    )
  })
}

function findCreateFolderNameBox(boxes: TextBox[]) {
  return findTextBox(boxes, [
    '收藏夹名称',
    '名称',
    '请输入',
    '最多可输入20个字',
    '最多可输入20字'
  ])
}

function isSameRow(left: TextBox, right: TextBox) {
  const leftCenterY = (left.y ?? 0) + (left.height ?? 0) / 2
  const rightCenterY = (right.y ?? 0) + (right.height ?? 0) / 2

  return Math.abs(leftCenterY - rightCenterY) <= Math.max(left.height ?? 0, right.height ?? 0, 24)
}

function findCreateFolderSubmitButton(boxes: TextBox[], nameBox?: TextBox) {
  const candidates = boxes.filter((box) =>
    ['创建', '新建'].some((candidate) => normalize(box.text).includes(normalize(candidate)))
  )

  if (!nameBox) {
    return candidates[0]
  }

  return (
    candidates.find(
      (box) =>
        isSameRow(nameBox, box) &&
        (box.x ?? 0) >= (nameBox.x ?? 0) &&
        !normalize(box.text).includes(normalize('新建收藏夹'))
    ) ?? candidates[0]
  )
}

function isInlineCreateForm(nameBox: TextBox, submitBox: TextBox) {
  return (
    isSameRow(nameBox, submitBox) ||
    normalize(nameBox.text).includes(normalize('最多可输入20个字')) ||
    normalize(nameBox.text).includes(normalize('最多可输入20字'))
  )
}

function findTargetFolder(boxes: TextBox[], targetFolder: string) {
  return findTextBox(boxes, [targetFolder])
}

function findFirstFavoriteFolderRow(boxes: TextBox[]) {
  return boxes.find((box) => {
    if (!isVisibleBox(box)) {
      return false
    }

    const text = normalize(box.text)

    if (!text || text.includes(normalize('添加到收藏夹')) || text.includes(normalize('新建收藏夹'))) {
      return false
    }

    return text.includes(normalize('收藏夹')) || text.includes(normalize('[私密]')) || /\/1000$/.test(text)
  })
}

function centerOf(box: TextBox) {
  return {
    x: Math.round((box.x ?? 0) + (box.width ?? 0) / 2),
    y: Math.round((box.y ?? 0) + (box.height ?? 0) / 2)
  }
}

function clickAt(webview: VisualWebview, box: TextBox) {
  const point = centerOf(box)
  const sendInputEvent = webview.sendInputEvent as unknown as
    | ((event: Record<string, unknown>) => void)
    | undefined
  sendInputEvent?.({ type: 'mouseMove', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 1, type: 'mouseDown', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 1, type: 'mouseUp', x: point.x, y: point.y })
}

function doubleClickAt(webview: VisualWebview, box: TextBox) {
  const point = centerOf(box)
  const sendInputEvent = webview.sendInputEvent as unknown as
    | ((event: Record<string, unknown>) => void)
    | undefined
  sendInputEvent?.({ type: 'mouseMove', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 1, type: 'mouseDown', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 1, type: 'mouseUp', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 2, type: 'mouseDown', x: point.x, y: point.y })
  sendInputEvent?.({ button: 'left', clickCount: 2, type: 'mouseUp', x: point.x, y: point.y })
}

function pressKey(webview: VisualWebview, keyCode: string) {
  const sendInputEvent = webview.sendInputEvent as unknown as
    | ((event: Record<string, unknown>) => void)
    | undefined
  sendInputEvent?.({ keyCode, type: 'keyDown' })
  sendInputEvent?.({ keyCode, type: 'keyUp' })
}

function typeText(webview: VisualWebview, value: string) {
  const sendInputEvent = webview.sendInputEvent as unknown as
    | ((event: Record<string, unknown>) => void)
    | undefined
  for (const char of value) {
    sendInputEvent?.({ keyCode: char, type: 'char' })
  }
}

async function readTextBoxes(webview: VisualWebview): Promise<TextBox[]> {
  const image = await webview.capturePage?.()
  image?.toDataURL?.()

  if (!webview.executeJavaScript) {
    return []
  }

  const result = (await webview.executeJavaScript(OCR_SCRIPT, true)) as { boxes?: TextBox[] }
  return result.boxes ?? []
}

type ScrollFavoritePanelResult = {
  containers?: Array<{
    after?: number
    before?: number
    changed?: boolean
    className?: string
    clientHeight?: number
    pointNodeClassName?: string
    pointNodeTagName?: string
    scrollHeight?: number
    tagName?: string
    x?: number
    y?: number
  }>
  modalClassName?: string
  moved?: boolean
}

function summarizeScrollDiagnostic(result: ScrollFavoritePanelResult) {
  const changed = result.containers?.find((container) => container.changed)
  const first = changed ?? result.containers?.[0]

  if (!first) {
    return `moved=${Boolean(result.moved)} containers=0 modal=${result.modalClassName || 'unknown'}`
  }

  return [
    `moved=${Boolean(result.moved)}`,
    `tag=${first.tagName || 'unknown'}`,
    `class=${(first.className || 'none').slice(0, 40)}`,
    `top=${first.before ?? 0}->${first.after ?? 0}`,
    `size=${first.clientHeight ?? 0}/${first.scrollHeight ?? 0}`
  ].join(' ')
}

async function rememberFavoriteFocusPoint(webview: VisualWebview, box: TextBox) {
  if (!webview.executeJavaScript) {
    return
  }

  const point = centerOf(box)

  try {
    await webview.executeJavaScript(
      `window.__bilimiFavoriteFocusPoint = ${JSON.stringify(point)}; true;`,
      true
    )
  } catch {
    // Best-effort diagnostic state only.
  }
}

async function scrollFavoritePanel(webview: VisualWebview): Promise<ScrollFavoritePanelResult> {
  if (!webview.executeJavaScript) {
    return { moved: false }
  }

  try {
    return (await webview.executeJavaScript(
      SCROLL_FAVORITE_PANEL_SCRIPT,
      true
    )) as ScrollFavoritePanelResult
  } catch {
    return { moved: false }
  }
}

async function openFavoritePanel(
  webview: VisualWebview,
  steps: string[],
  options: VisualFavoriteFallbackOptions = {}
) {
  if (options.openWithShortcut) {
    pressKey(webview, 'e')
    steps.push('visual:favorite:shortcut:e')
    await wait(160)
  }

  const boxes = await readTextBoxes(webview)
  if (hasFavoritePanel(boxes)) {
    return true
  }

  const favoriteButton = findFavoriteButton(boxes)
  if (!favoriteButton) {
    return false
  }

  clickAt(webview, favoriteButton)
  steps.push('visual:favorite:open')
  await wait(120)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (hasFavoritePanel(await readTextBoxes(webview))) {
      return true
    }

    await wait(80)
  }

  return false
}

async function focusAndScrollFavoriteList(
  webview: VisualWebview,
  boxes: TextBox[],
  steps: string[],
  stepPrefix: string,
  alreadyFocused: boolean
) {
  let focused = alreadyFocused

  if (!focused) {
    const firstFolderRow = findFirstFavoriteFolderRow(boxes)

    if (firstFolderRow) {
      doubleClickAt(webview, firstFolderRow)
      await rememberFavoriteFocusPoint(webview, firstFolderRow)
      steps.push(`${stepPrefix}:focus-first-folder`)
      focused = true
      await wait(80)
    }
  }

  const scrollResult = await scrollFavoritePanel(webview)
  steps.push(`${stepPrefix}:diagnostic:` + summarizeScrollDiagnostic(scrollResult))
  pressKey(webview, 'PageDown')
  steps.push(`${stepPrefix}:scroll`)
  await wait(120)

  return focused
}

async function waitForCreateFolderNameBox(webview: VisualWebview) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const boxes = await readTextBoxes(webview)
    const nameBox = findCreateFolderNameBox(boxes)

    if (nameBox) {
      return nameBox
    }

    await wait(80)
  }

  return undefined
}

async function waitForCreateFolderSubmitButton(webview: VisualWebview, nameBox?: TextBox) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const boxes = await readTextBoxes(webview)
    const submitBox = findCreateFolderSubmitButton(boxes, nameBox)

    if (submitBox) {
      return submitBox
    }

    await wait(80)
  }

  return undefined
}

async function waitForFavoriteConfirmButton(webview: VisualWebview) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const boxes = await readTextBoxes(webview)
    const confirmBox = findFavoriteConfirmButton(boxes)

    if (confirmBox) {
      return confirmBox
    }

    await wait(120)
  }

  return undefined
}

export async function runVisualFavoriteFallback(
  webview: VisualWebview,
  context: VisualAutomationContext,
  options: VisualFavoriteFallbackOptions = {}
): Promise<AssistantAutomationResult> {
  if (!webview.sendInputEvent) {
    return {
      ok: false,
      steps: [],
      missingTargets: ['visual-input'],
      message: '屏幕兜底无法发送键鼠事件。'
    }
  }

  const steps: string[] = []
  const targetFolder = context.favoriteFolders[context.targetLedgerId]

  if (!targetFolder) {
    return {
      ok: false,
      steps,
      missingTargets: ['target-ledger'],
      message: '未找到目标 Bilimi 收藏册目，已停止屏幕兜底。'
    }
  }

  const panelOpened = await openFavoritePanel(webview, steps, options)
  if (!panelOpened) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-favorite-panel'],
      message: '屏幕兜底未确认收藏面板已打开，已停止滚动。'
    }
  }

  let createBox: TextBox | undefined
  let focusedFavoriteList = false
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const boxes = await readTextBoxes(webview)
    createBox = findCreateFolderEntry(boxes)

    if (createBox) {
      break
    }

    focusedFavoriteList = await focusAndScrollFavoriteList(
      webview,
      boxes,
      steps,
      'visual:favorite',
      focusedFavoriteList
    )
  }

  if (!createBox) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-create-folder'],
      message: '屏幕兜底未识别到新建收藏夹。'
    }
  }

  clickAt(webview, createBox)
  steps.push('visual:favorite:create-open')
  await wait(80)

  const nameBox = await waitForCreateFolderNameBox(webview)
  if (!nameBox) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-create-name'],
      message: '屏幕兜底未识别到新建收藏夹名称输入框。'
    }
  }

  clickAt(webview, nameBox)
  steps.push('visual:favorite:create-name-input')
  typeText(webview, targetFolder)
  steps.push('visual:favorite:create-name:' + targetFolder)

  const confirmBox = await waitForCreateFolderSubmitButton(webview, nameBox)
  if (!confirmBox) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-create-confirm'],
      message: '屏幕兜底未识别到创建确认按钮。'
    }
  }

  clickAt(webview, confirmBox)
  steps.push('visual:favorite:create')
  const createdFromInlineForm = isInlineCreateForm(nameBox, confirmBox)
  await wait(160)

  if (createdFromInlineForm) {
    const favoriteConfirmBox = await waitForFavoriteConfirmButton(webview)

    if (!favoriteConfirmBox) {
      return {
        ok: false,
        steps,
        missingTargets: ['visual-favorite-confirm'],
        message: '屏幕兜底新建收藏夹后未识别到底部确定按钮。'
      }
    }

    clickAt(webview, favoriteConfirmBox)
    steps.push('visual:favorite:confirm')

    return {
      ok: true,
      steps,
      missingTargets: [],
      message: '已用屏幕识别和键鼠操作处理收藏夹。'
    }
  }

  let targetFolderBox: TextBox | undefined
  let favoriteConfirmBox: TextBox | undefined
  let focusedPostCreateFavoriteList = false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const boxes = await readTextBoxes(webview)
    targetFolderBox = findTargetFolder(boxes, targetFolder)
    favoriteConfirmBox = findFavoriteConfirmButton(boxes)

    if (targetFolderBox && favoriteConfirmBox) {
      break
    }

    focusedPostCreateFavoriteList = await focusAndScrollFavoriteList(
      webview,
      boxes,
      steps,
      'visual:favorite:post-create',
      focusedPostCreateFavoriteList
    )
  }

  if (!targetFolderBox) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-target-folder'],
      message: '屏幕兜底创建收藏夹后未识别到目标 Bilimi 收藏夹。'
    }
  }

  clickAt(webview, targetFolderBox)
  steps.push('visual:favorite:select-folder')

  if (!favoriteConfirmBox) {
    return {
      ok: false,
      steps,
      missingTargets: ['visual-favorite-confirm'],
      message: '屏幕兜底创建收藏夹后未识别到收藏确认按钮。'
    }
  }

  clickAt(webview, favoriteConfirmBox)
  steps.push('visual:favorite:confirm')

  return {
    ok: true,
    steps,
    missingTargets: [],
    message: '已用屏幕识别和键鼠操作处理收藏夹。'
  }
}
