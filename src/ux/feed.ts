export type FeedState = 'IDLE' | 'TRANSITION_OUT' | 'LOADING' | 'TRANSITION_IN'

export type FeedEntry = {
  id: string
}

export const createFeedController = ({
  entries,
  onTransitionOut,
  onLoad,
  onTransitionIn,
  debug = false,
  minIdleMs = 0,
  waitForReady,
}: {
  entries: FeedEntry[]
  onTransitionOut: (direction: 'next' | 'prev') => Promise<void>
  onLoad: (entry: FeedEntry) => Promise<void>
  onTransitionIn: () => Promise<void>
  debug?: boolean
  minIdleMs?: number
  waitForReady?: () => Promise<void>
}) => {
  let currentIndex = 0
  let state: FeedState = 'IDLE'
  let isLocked = false
  let pendingDirection: 'next' | 'prev' | null = null
  let lastIdleAt = performance.now()
  let pendingTimeout: number | null = null

  const log = (...args: unknown[]) => {
    if (debug) console.log(...args)
  }

  const schedulePending = (direction: 'next' | 'prev', delay: number) => {
    pendingDirection = direction
    if (pendingTimeout) {
      window.clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    pendingTimeout = window.setTimeout(() => {
      pendingTimeout = null
      if (!pendingDirection) return
      const next = pendingDirection
      pendingDirection = null
      requestTransition(next)
    }, delay)
    log('Feed pending', direction, `delay ${Math.round(delay)}ms`)
  }

  const queuePending = (direction: 'next' | 'prev') => {
    pendingDirection = direction
    log('Feed pending', direction)
  }

  const requestTransition = (direction: 'next' | 'prev') => {
    if (entries.length < 2) return
    if (isLocked || state !== 'IDLE') {
      queuePending(direction)
      return
    }
    const now = performance.now()
    const elapsed = now - lastIdleAt
    if (elapsed < minIdleMs) {
      schedulePending(direction, minIdleMs - elapsed)
      return
    }
    void runTransition(direction)
  }

  const runTransition = async (direction: 'next' | 'prev') => {
    if (isLocked || state !== 'IDLE' || entries.length < 2) return
    if (pendingTimeout) {
      window.clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    pendingDirection = null
    isLocked = true
    state = 'TRANSITION_OUT'
    log('Feed state', state, 'direction', direction)

    const targetIndex =
      direction === 'next'
        ? (currentIndex + 1) % entries.length
        : (currentIndex - 1 + entries.length) % entries.length

    await onTransitionOut(direction)
    state = 'LOADING'
    log('Feed state', state)

    const nextEntry = entries[targetIndex]
    await onLoad(nextEntry)
    if (waitForReady) {
      await waitForReady()
    }
    currentIndex = targetIndex

    state = 'TRANSITION_IN'
    log('Feed state', state)
    await onTransitionIn()

    state = 'IDLE'
    log('Feed state', state)
    isLocked = false
    lastIdleAt = performance.now()
    if (pendingDirection) {
      const next = pendingDirection
      pendingDirection = null
      const elapsed = performance.now() - lastIdleAt
      if (elapsed < minIdleMs) {
        schedulePending(next, minIdleMs - elapsed)
      } else {
        requestTransition(next)
      }
    }
  }

  return {
    getState: () => state,
    getIndex: () => currentIndex,
    setIndex: (index: number) => {
      currentIndex = Math.max(0, Math.min(entries.length - 1, index))
    },
    goNext: () => requestTransition('next'),
    goPrev: () => requestTransition('prev'),
  }
}
