import { feedback } from '../utils/feedback'

export interface SkuFolderImage {
  id: string
  library: string
  sku: string
  path: string
  filename: string
  url: string
  preview_url: string
}

export interface SkuFolder {
  id: string
  sku: string
  name: string
  library_label: string
  images: SkuFolderImage[]
}

export interface SkuFolderSearchResult {
  folders: SkuFolder[]
  missing_skus: string[]
  library_exists: boolean
}

export interface ImportedProductImage {
  url: string
  name: string
  sku: string
  assetType: string
  naturalWidth?: number
  naturalHeight?: number
}

export async function searchSkuFolders(skus: string[], signal: AbortSignal): Promise<SkuFolderSearchResult> {
  const response = await fetch(`/products/sku-folders?sku=${encodeURIComponent(skus.join(','))}`, {
    credentials: 'include', signal,
  })
  if (!response.ok) throw feedback.responseError(response.status, await response.text())
  return response.json()
}

export async function importSkuFolderImages(images: SkuFolderImage[]): Promise<ImportedProductImage[]> {
  const response = await fetch('/products/import-sku-images', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: images.map(({ library, sku, path }) => ({ library, sku, path })) }),
  })
  if (!response.ok) throw feedback.responseError(response.status, await response.text())
  return (await response.json()).items
}
