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
}: {
  entries: FeedEntry[]
  onTransitionOut: (direction: 'next' | 'prev') => Promise<void>
  onLoad: (entry: FeedEntry) => Promise<void>
  onTransitionIn: () => Promise<void>
  debug?: boolean
}) => {
  let currentIndex = 0
  let state: FeedState = 'IDLE'
  let isLocked = false

  const log = (...args: unknown[]) => {
    if (debug) console.log(...args)
  }

  const runTransition = async (direction: 'next' | 'prev') => {
    if (isLocked || state !== 'IDLE' || entries.length < 2) return
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
    currentIndex = targetIndex

    state = 'TRANSITION_IN'
    log('Feed state', state)
    await onTransitionIn()

    state = 'IDLE'
    log('Feed state', state)
    isLocked = false
  }

  return {
    getState: () => state,
    getIndex: () => currentIndex,
    setIndex: (index: number) => {
      currentIndex = Math.max(0, Math.min(entries.length - 1, index))
    },
    goNext: () => runTransition('next'),
    goPrev: () => runTransition('prev'),
  }
}
