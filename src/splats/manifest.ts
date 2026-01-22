import type { SplatEntry } from './types'

const fallbackEntries: SplatEntry[] = [
  {
    id: 'isetta',
    name: 'Isetta Car',
    file: 'gs_Isetta_Car.ply',
    poster: null,
    poses: null,
  },
]

export const loadSplatManifest = async (): Promise<SplatEntry[]> => {
  try {
    const response = await fetch('/splats/manifest.json', { cache: 'no-store' })
    if (!response.ok) {
      return fallbackEntries
    }
    const data = (await response.json()) as SplatEntry[]
    return data.length ? data : fallbackEntries
  } catch (error) {
    console.warn('Failed to load splat manifest, using fallback.', error)
    return fallbackEntries
  }
}
