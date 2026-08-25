/** Settings shell hardcodes unknown section ids to a gear. Swap the 消息 row. */
const BUBBLE =
  'M3.15 1.7h9.7c1.13 0 2.05.92 2.05 2.05v5.9c0 1.13-.92 2.05-2.05 2.05H7.58L4.55 14.35c-.48.32-1.12-.03-1.12-.6v-1.95h-.28c-1.13 0-2.05-.92-2.05-2.05v-5.9c0-1.13.92-2.05 2.05-2.05zm0 1.4c-.36 0-.65.29-.65.65v5.9c0 .36.29.65.65.65h1.55v1.72l2.12-1.72h6.03c.36 0 .65-.29.65-.65v-5.9c0-.36-.29-.65-.65-.65H3.15z'

export function paintMessagingNavIcon(root: ParentNode): number {
  let painted = 0
  for (const dialog of root.querySelectorAll('[role="dialog"]')) {
    for (const button of dialog.querySelectorAll('nav button')) {
      const label = button.querySelector('span')
      if (label?.textContent?.trim() !== '消息') continue
      const svg = button.querySelector('svg')
      if (!svg || svg.querySelector('path[data-mgw="nav-icon"]')) continue
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      while (svg.firstChild) svg.removeChild(svg.firstChild)
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('fill', 'currentColor')
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('clip-rule', 'evenodd')
      path.setAttribute('d', BUBBLE)
      path.setAttribute('data-mgw', 'nav-icon')
      svg.appendChild(path)
      painted += 1
    }
  }
  return painted
}

export function watchMessagingNavIcon(): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  let frame = 0
  const paint = () => { paintMessagingNavIcon(document) }
  const schedule = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  paint()
  return () => {
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
  }
}
