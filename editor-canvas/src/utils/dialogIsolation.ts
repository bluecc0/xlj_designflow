const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** 模态弹窗打开期间隔离底下的画布：按键和粘贴不再传到全局监听，焦点留在弹窗内。返回值用于解除并还原焦点。 */
export function isolateDialogInput(dialog: HTMLElement, onEscape: () => void): () => void {
  const previousFocus = document.activeElement as HTMLElement | null

  const onKeyDown = (e: KeyboardEvent) => {
    // 只拦传播不拦默认行为：搜索框输入、按钮回车和空格照常生效
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onEscape()
      return
    }
    const active = document.activeElement as HTMLElement | null
    if (e.key === 'Tab') {
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      const index = active ? items.indexOf(active) : -1
      const next = e.shiftKey
        ? (index <= 0 ? items[items.length - 1] : null)
        : (index === -1 || index === items.length - 1 ? items[0] : null)
      if (next) {
        e.preventDefault()
        next.focus()
      }
    } else if (!active || !dialog.contains(active)) {
      dialog.focus()
    }
  }
  const onPaste = (e: ClipboardEvent) => e.stopPropagation()

  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('paste', onPaste, true)
  dialog.focus()
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('paste', onPaste, true)
    previousFocus?.focus?.()
  }
}
