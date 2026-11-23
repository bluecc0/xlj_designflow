import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { IMAGE_LOAD_TIMEOUT, IMAGE_RETRY_DELAYS, retryImageUrl } from '../utils/imageRetry'

interface Props {
  source: string
  name: string
  opacity: number
}

export function RecoverableImage({ source, name, opacity }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const imageRef = useRef<HTMLImageElement>(null)
  const failRef = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    let settled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setStatus('loading')
    const fail = () => {
      if (!active || settled) return
      settled = true
      clearTimeout(timeout)
      if (attempt < IMAGE_RETRY_DELAYS.length) {
        retryTimer = setTimeout(() => {
          if (active) setAttempt(attempt + 1)
        }, IMAGE_RETRY_DELAYS[attempt])
      } else {
        setStatus('failed')
      }
    }
    const timeout = setTimeout(fail, IMAGE_LOAD_TIMEOUT)
    failRef.current = fail
    const image = imageRef.current
    const loaded = () => {
      if (!active || !image?.naturalWidth) return
      // A slow successful response can arrive while a retry is scheduled.
      settled = true
      clearTimeout(timeout)
      clearTimeout(retryTimer)
      setStatus('loaded')
    }
    image?.addEventListener('load', loaded)
    image?.addEventListener('error', fail)
    if (image?.complete) {
      if (image.naturalWidth) loaded()
      else fail()
    }
    return () => {
      active = false
      clearTimeout(timeout)
      clearTimeout(retryTimer)
      image?.removeEventListener('load', loaded)
      image?.removeEventListener('error', fail)
    }
  }, [source, attempt])

  useEffect(() => {
    const online = () => {
      if (status === 'failed') setAttempt(0)
    }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [status])

  return <>
    <img
      key={`${source}:${attempt}`}
      ref={imageRef}
      src={retryImageUrl(source, attempt)}
      alt={name}
      draggable={false}
      onError={() => failRef.current()}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block',
        opacity, pointerEvents: 'none', visibility: status === 'failed' ? 'hidden' : 'visible' }}
    />
    {status === 'failed' && <button
      type="button"
      title="图片加载失败，点击重试"
      aria-label="图片加载失败，点击重试"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setAttempt(0) }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
        border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
    ><RefreshCw size={24} /></button>}
  </>
}
