type MouseTransparentWindow = {
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void
}

export function setFloatingSealMouseTransparency(
  window: MouseTransparentWindow,
  transparent: boolean
) {
  if (transparent) {
    window.setIgnoreMouseEvents(true)
    return
  }

  window.setIgnoreMouseEvents(false)
}
