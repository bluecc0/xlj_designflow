import React from 'react'
import { atom, type TLImageShape } from 'tldraw'
import {
  ZERO_OUTPAINT_MARGINS,
  type OutpaintMargins,
  type OutpaintingConfig,
  type OutpaintingDraft,
  type OutpaintingEligibility,
  type OutpaintingOperationState,
} from './types'

const FALLBACK_CONFIG: OutpaintingConfig = {
  enabled: false,
  providerMarginAlignment: 1,
  maxWidth: 2048,
  maxHeight: 2048,
  maxAreaPixels: 4_194_304,
  recommendedAreaPixels: 2_097_152,
  maxSourceBytes: 20 * 1024 * 1024,
  timeoutSeconds: 600,
  isFallback: true,
}

const EMPTY_ELIGIBILITY: OutpaintingEligibility = {
  shapeId: null,
  eligible: false,
  reason: '',
  processingWidth: 0,
  processingHeight: 0,
}

const IDLE_OPERATION: OutpaintingOperationState = {
  stage: 'idle',
  message: '',
  progress: null,
  processing: false,
  sourceShapeId: null,
}

const composingAtom = atom('designflow.outpainting.composing', false)

export function setOutpaintingComposing(active: boolean) {
  composingAtom.set(active)
}

export function isOutpaintingComposing() {
  return composingAtom.get()
}

let outpaintingConfigPromise: Promise<OutpaintingConfig> | null = null

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function loadOutpaintingConfig() {
  if (!outpaintingConfigPromise) {
    outpaintingConfigPromise = fetch('/ai-image/outpainting/config', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        const maxWidth = Math.min(
          FALLBACK_CONFIG.maxWidth,
          positiveInteger(data?.max_width, FALLBACK_CONFIG.maxWidth)
        )
        const maxHeight = Math.min(
          FALLBACK_CONFIG.maxHeight,
          positiveInteger(data?.max_height, FALLBACK_CONFIG.maxHeight)
        )
        const maxAreaPixels = Math.min(
          FALLBACK_CONFIG.maxAreaPixels,
          positiveInteger(data?.max_area_pixels, FALLBACK_CONFIG.maxAreaPixels),
          maxWidth * maxHeight
        )
        return {
          enabled: data?.enabled === true,
          providerMarginAlignment: positiveInteger(
            data?.snap_pixels,
            FALLBACK_CONFIG.providerMarginAlignment
          ),
          maxWidth,
          maxHeight,
          maxAreaPixels,
          recommendedAreaPixels: positiveInteger(
            data?.recommended_area_pixels,
            Math.min(FALLBACK_CONFIG.recommendedAreaPixels, maxAreaPixels)
          ),
          maxSourceBytes: Math.min(
            FALLBACK_CONFIG.maxSourceBytes,
            positiveInteger(data?.max_source_bytes, FALLBACK_CONFIG.maxSourceBytes)
          ),
          timeoutSeconds: Math.min(
            3600,
            positiveInteger(data?.timeout_seconds, FALLBACK_CONFIG.timeoutSeconds)
          ),
          isFallback: false,
        }
      })
      .catch((error) => {
        console.warn('Failed to load outpainting config, using safe fallback limits', error)
        return FALLBACK_CONFIG
      })
  }
  return outpaintingConfigPromise
}

type OutpaintingContextValue = {
  config: OutpaintingConfig | null
  eligibility: OutpaintingEligibility
  draft: OutpaintingDraft | null
  operation: OutpaintingOperationState
  externalOperationBusy: boolean
  setEligibility: (eligibility: OutpaintingEligibility) => void
  ensureDraft: (shapeId: TLImageShape['id']) => void
  enterCompose: (shapeId: TLImageShape['id']) => void
  setMargins: (shapeId: TLImageShape['id'], margins: OutpaintMargins) => void
  clearDraft: () => void
  setOperation: React.Dispatch<React.SetStateAction<OutpaintingOperationState>>
  setExternalOperationBusy: (busy: boolean) => void
  claimOperation: (operation: 'outpainting' | 'external') => boolean
  releaseOperation: (operation: 'outpainting' | 'external') => void
  registerExecutor: (executor: (() => Promise<void>) | null) => void
  submit: () => Promise<void>
}

const OutpaintingContext = React.createContext<OutpaintingContextValue | null>(null)

export function OutpaintingProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<OutpaintingConfig | null>(null)
  const [eligibility, setEligibility] = React.useState<OutpaintingEligibility>(EMPTY_ELIGIBILITY)
  const [draft, setDraft] = React.useState<OutpaintingDraft | null>(null)
  const [operation, setOperation] = React.useState<OutpaintingOperationState>(IDLE_OPERATION)
  const [externalOperationBusy, setExternalOperationBusy] = React.useState(false)
  const executorRef = React.useRef<(() => Promise<void>) | null>(null)
  const operationLockRef = React.useRef<'outpainting' | 'external' | null>(null)

  React.useEffect(() => {
    let cancelled = false
    loadOutpaintingConfig().then((nextConfig) => {
      if (!cancelled) setConfig(nextConfig)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ensureDraft = React.useCallback((shapeId: TLImageShape['id']) => {
    setDraft((current) => {
      if (current?.sourceShapeId === shapeId) return current
      return { sourceShapeId: shapeId, margins: { ...ZERO_OUTPAINT_MARGINS } }
    })
  }, [])

  const enterCompose = React.useCallback((shapeId: TLImageShape['id']) => {
    if (eligibility.shapeId !== shapeId || !eligibility.eligible) return
    setOutpaintingComposing(true)
    ensureDraft(shapeId)
  }, [eligibility, ensureDraft])

  const setMargins = React.useCallback((shapeId: TLImageShape['id'], margins: OutpaintMargins) => {
    setDraft((current) => {
      if (current?.sourceShapeId !== shapeId) return current
      return { sourceShapeId: shapeId, margins: { ...margins } }
    })
  }, [])

  const clearDraft = React.useCallback(() => {
    setDraft(null)
    setOutpaintingComposing(false)
    setOperation((current) => (current.processing ? current : IDLE_OPERATION))
  }, [])

  const claimOperation = React.useCallback((nextOperation: 'outpainting' | 'external') => {
    if (operationLockRef.current) return false
    operationLockRef.current = nextOperation
    if (nextOperation === 'external') setExternalOperationBusy(true)
    return true
  }, [])

  const releaseOperation = React.useCallback((completedOperation: 'outpainting' | 'external') => {
    if (operationLockRef.current !== completedOperation) return
    operationLockRef.current = null
    if (completedOperation === 'external') setExternalOperationBusy(false)
  }, [])

  const registerExecutor = React.useCallback((executor: (() => Promise<void>) | null) => {
    executorRef.current = executor
  }, [])

  const submit = React.useCallback(async () => {
    await executorRef.current?.()
  }, [])

  const value = React.useMemo<OutpaintingContextValue>(
    () => ({
      config,
      eligibility,
      draft,
      operation,
      externalOperationBusy,
      setEligibility,
      ensureDraft,
      enterCompose,
      setMargins,
      clearDraft,
      setOperation,
      setExternalOperationBusy,
      claimOperation,
      releaseOperation,
      registerExecutor,
      submit,
    }),
    [
      config,
      eligibility,
      draft,
      operation,
      externalOperationBusy,
      ensureDraft,
      enterCompose,
      setMargins,
      clearDraft,
      claimOperation,
      releaseOperation,
      registerExecutor,
      submit,
    ]
  )

  return <OutpaintingContext.Provider value={value}>{children}</OutpaintingContext.Provider>
}

export function useOutpainting() {
  const value = React.useContext(OutpaintingContext)
  if (!value) throw new Error('useOutpainting must be used inside OutpaintingProvider')
  return value
}
