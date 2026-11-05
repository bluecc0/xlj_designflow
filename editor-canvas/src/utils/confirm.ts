export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

// 与提示条一致：嵌在主站里时用主站统一的确认弹窗（frontend/src/Overlays.jsx 的 dfConfirm）
function hostConfirm(): ConfirmFn | null {
  try {
    const parent = window.parent as Window & { dfConfirm?: ConfirmFn }
    if (parent !== window && parent.location.origin === window.location.origin && parent.dfConfirm) {
      return parent.dfConfirm
    }
  } catch {}
  return null
}

// 画布单独打开时的同款弹窗，配色取自主站的 --ink / --line / --danger
function localConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,0.24);display:grid;place-items:center;'
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'alertdialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.style.cssText = 'width:360px;max-width:calc(100vw - 32px);border-radius:14px;padding:18px;background:#ffffff;'
      + 'border:1px solid oklch(0.95 0.005 260);box-shadow:0 18px 50px rgba(15,23,42,0.18);display:flex;flex-direction:column;gap:10px;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    const title = document.createElement('div')
    title.style.cssText = 'font-size:13px;font-weight:600;color:oklch(0.18 0.01 260);'
    title.textContent = opts.title
    dialog.appendChild(title)
    if (opts.message) {
      const message = document.createElement('div')
      message.style.cssText = 'font-size:12px;color:oklch(0.38 0.01 260);line-height:1.6;white-space:pre-line;'
      message.textContent = opts.message
      dialog.appendChild(message)
    }
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:6px;'
    const button = (label: string, primary: boolean) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = label
      const accent = opts.danger ? 'oklch(0.58 0.19 25)' : 'oklch(0.18 0.01 260)'
      el.style.cssText = `height:32px;padding:0 14px;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;`
        + `font-weight:${primary ? 600 : 400};border:1px solid ${primary ? accent : 'oklch(0.92 0.005 260)'};`
        + `background:${primary ? accent : '#ffffff'};color:${primary ? 'white' : 'oklch(0.38 0.01 260)'};`
      return el
    }
    const cancel = button(opts.cancelText || '取消', false)
    const ok = button(opts.confirmText || '确定', true)
    actions.append(cancel, ok)
    dialog.appendChild(actions)
    overlay.appendChild(dialog)

    const close = (result: boolean) => {
      window.removeEventListener('keydown', onKey, true)
      overlay.remove()
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close(false)
      }
    }
    cancel.onclick = () => close(false)
    ok.onclick = () => close(true)
    overlay.onmousedown = (e) => {
      if (e.target === overlay) close(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
    ok.focus()
  })
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  const host = hostConfirm()
  return host ? host(opts) : localConfirm(opts)
}
