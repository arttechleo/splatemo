export const createHUD = () => {
  const hud = document.createElement('div')
  hud.id = 'hud'

  // State
  let likeCount = 42
  let isLiked = false
  let isBookmarked = false
  let isCommentOpen = false

  hud.innerHTML = `
    <div class="hud__header">
      <div class="hud__avatar">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='45' fill='%23fff'/%3E%3Ctext x='50' y='65' font-size='40' text-anchor='middle' fill='%23000'%3E👤%3C/text%3E%3C/svg%3E" alt="Avatar" />
      </div>
      <div class="hud__user">
        <span class="hud__handle">@volumetric</span>
      </div>
    </div>
    
    <div class="hud__actions">
      <button class="hud__button hud__button--like" type="button" aria-label="Like">
        <span class="hud__icon">♥</span>
        <span class="hud__count">${likeCount}</span>
      </button>
      <button class="hud__button hud__button--comment" type="button" aria-label="Comment">
        <span class="hud__icon">💬</span>
        <span class="hud__count">12</span>
      </button>
      <button class="hud__button hud__button--repost" type="button" aria-label="Repost">
        <span class="hud__icon">↻</span>
        <span class="hud__count">8</span>
      </button>
      <button class="hud__button hud__button--bookmark" type="button" aria-label="Bookmark">
        <span class="hud__icon">🔖</span>
      </button>
      <button class="hud__button hud__button--sound" type="button" aria-label="Sound">
        <span class="hud__icon">🔊</span>
      </button>
      <button class="hud__button hud__button--sound-mode" type="button" aria-label="Sound Mode">
        <span class="hud__icon">🌊</span>
      </button>
      <button class="hud__button hud__button--off-axis" type="button" aria-label="Off-Axis">
        <span class="hud__icon">👁</span>
        <span class="hud__status-indicator" id="off-axis-status"></span>
      </button>
    </div>
    
    <div class="hud__reset-container">
      <button class="hud__button hud__button--reset hud__button--primary" type="button" aria-label="Reset View">
        <span class="hud__icon">⌂</span>
        <span class="hud__label">Recenter</span>
      </button>
    </div>

    <div class="hud__caption">
      <p class="hud__text">Amazing 3D Gaussian Splatting scene</p>
      <p class="hud__hint">Swipe to rotate • Scroll to next</p>
    </div>

    <div class="hud__comment-panel">
      <div class="hud__comment-header">
        <h3>Comments</h3>
        <button class="hud__close" type="button" aria-label="Close">×</button>
      </div>
      <div class="hud__comment-list">
        <div class="hud__comment-item">
          <div class="hud__comment-avatar">👤</div>
          <div class="hud__comment-content">
            <div class="hud__comment-author">@user1</div>
            <div class="hud__comment-text">This looks incredible!</div>
          </div>
        </div>
        <div class="hud__comment-item">
          <div class="hud__comment-avatar">👤</div>
          <div class="hud__comment-content">
            <div class="hud__comment-author">@user2</div>
            <div class="hud__comment-text">The detail is amazing</div>
          </div>
        </div>
      </div>
      <form class="hud__comment-form">
        <input type="text" placeholder="Add a comment..." class="hud__comment-input" />
        <button type="submit" class="hud__comment-submit">Send</button>
      </form>
    </div>

    <div class="hud__toast">Reposted!</div>
    
    <div class="hud__loading">
      <div class="hud__loading-bar"></div>
    </div>
  `

  // Get elements
  const likeButton = hud.querySelector<HTMLButtonElement>('.hud__button--like')
  const likeCountEl = likeButton?.querySelector<HTMLSpanElement>('.hud__count')
  const commentButton = hud.querySelector<HTMLButtonElement>('.hud__button--comment')
  const repostButton = hud.querySelector<HTMLButtonElement>('.hud__button--repost')
  const bookmarkButton = hud.querySelector<HTMLButtonElement>('.hud__button--bookmark')
  const commentPanel = hud.querySelector<HTMLDivElement>('.hud__comment-panel')
  const closeButton = hud.querySelector<HTMLButtonElement>('.hud__close')
  const commentForm = hud.querySelector<HTMLFormElement>('.hud__comment-form')
  const toast = hud.querySelector<HTMLDivElement>('.hud__toast')

  // Like handler
  if (likeButton && likeCountEl) {
    likeButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isLiked = !isLiked
      likeCount += isLiked ? 1 : -1
      likeCountEl.textContent = String(likeCount)
      likeButton.classList.toggle('hud__button--active', isLiked)
    })
    likeButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Comment handler
  if (commentButton && commentPanel) {
    commentButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isCommentOpen = !isCommentOpen
      commentPanel.classList.toggle('hud__comment-panel--open', isCommentOpen)
    })
    commentButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Close comment panel
  if (closeButton && commentPanel) {
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isCommentOpen = false
      commentPanel.classList.remove('hud__comment-panel--open')
    })
    closeButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Repost handler
  if (repostButton && toast) {
    repostButton.addEventListener('click', (e) => {
      e.stopPropagation()
      toast.classList.add('hud__toast--show')
      setTimeout(() => {
        toast.classList.remove('hud__toast--show')
      }, 2000)
    })
    repostButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Bookmark handler
  if (bookmarkButton) {
    bookmarkButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isBookmarked = !isBookmarked
      bookmarkButton.classList.toggle('hud__button--active', isBookmarked)
    })
    bookmarkButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Comment form handler
  if (commentForm) {
    commentForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const input = commentForm.querySelector<HTMLInputElement>('.hud__comment-input')
      if (input && input.value.trim()) {
        console.log('Comment submitted:', input.value)
        input.value = ''
      }
    })
    commentForm.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  // Prevent orbit on all interactive elements
  const interactiveElements = hud.querySelectorAll('button, input, form')
  interactiveElements.forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
    el.addEventListener('click', (e) => {
      e.stopPropagation()
    })
  })

  // Export function to show error toast
  const showErrorToast = (message: string, onRetry?: () => void) => {
    if (toast) {
      toast.textContent = message
      toast.classList.add('hud__toast--show', 'hud__toast--error')
      
      // Make toast clickable if retry is available
      if (onRetry) {
        const clickHandler = () => {
          onRetry()
          toast?.removeEventListener('click', clickHandler)
        }
        toast.style.cursor = 'pointer'
        toast.addEventListener('click', clickHandler)
      } else {
        toast.style.cursor = 'default'
      }

      setTimeout(() => {
        toast?.classList.remove('hud__toast--show')
        setTimeout(() => {
          if (toast) {
            toast.classList.remove('hud__toast--error')
            toast.textContent = 'Reposted!'
          }
        }, 300)
      }, 4000)
    }
  }

  // Loading indicator
  const loadingEl = hud.querySelector<HTMLDivElement>('.hud__loading')
  
  const showLoading = () => {
    if (loadingEl) {
      loadingEl.classList.add('hud__loading--active')
    }
  }

  const hideLoading = () => {
    if (loadingEl) {
      loadingEl.classList.remove('hud__loading--active')
    }
  }

  // Reset view button
  const resetButton = hud.querySelector<HTMLButtonElement>('.hud__button--reset')
  let onReset: (() => void) | null = null

  if (resetButton) {
    resetButton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (onReset) {
        onReset()
      }
    })
    resetButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  const setResetHandler = (handler: () => void) => {
    onReset = handler
  }

  // Sound button
  const soundButton = hud.querySelector<HTMLButtonElement>('.hud__button--sound')
  let onSoundToggle: ((enabled: boolean) => void) | null = null
  let isSoundEnabled = false

  if (soundButton) {
    soundButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isSoundEnabled = !isSoundEnabled
      soundButton.classList.toggle('hud__button--active', isSoundEnabled)
      if (onSoundToggle) {
        onSoundToggle(isSoundEnabled)
      }
    })
    soundButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  const setSoundToggleHandler = (handler: (enabled: boolean) => void) => {
    onSoundToggle = handler
  }

  // Sound Mode button
  const soundModeButton = hud.querySelector<HTMLButtonElement>('.hud__button--sound-mode')
  let onSoundModeToggle: ((enabled: boolean) => void) | null = null
  let isSoundModeEnabled = false

  if (soundModeButton) {
    soundModeButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isSoundModeEnabled = !isSoundModeEnabled
      soundModeButton.classList.toggle('hud__button--active', isSoundModeEnabled)
      if (onSoundModeToggle) {
        onSoundModeToggle(isSoundModeEnabled)
      }
    })
    soundModeButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  const setSoundModeToggleHandler = (handler: (enabled: boolean) => void) => {
    onSoundModeToggle = handler
  }

  // Off-Axis button
  const offAxisButton = hud.querySelector<HTMLButtonElement>('.hud__button--off-axis')
  let onOffAxisToggle: ((enabled: boolean) => void) | null = null
  let isOffAxisEnabled = false

  if (offAxisButton) {
    offAxisButton.addEventListener('click', (e) => {
      e.stopPropagation()
      isOffAxisEnabled = !isOffAxisEnabled
      offAxisButton.classList.toggle('hud__button--active', isOffAxisEnabled)
      if (onOffAxisToggle) {
        onOffAxisToggle(isOffAxisEnabled)
      }
    })
    offAxisButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  const setOffAxisToggleHandler = (handler: (enabled: boolean) => void) => {
    onOffAxisToggle = handler
  }

  // Off-Axis status indicator update function
  const updateOffAxisStatus = (status: 'idle' | 'tracking' | 'error') => {
    const statusEl = hud.querySelector<HTMLSpanElement>('#off-axis-status')
    if (!statusEl) return
    
    statusEl.className = 'hud__status-indicator'
    statusEl.setAttribute('data-status', status)
    
    // Add visual indicator
    if (status === 'tracking') {
      statusEl.style.background = 'rgba(34, 197, 94, 0.8)'
      statusEl.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.6)'
    } else if (status === 'error') {
      statusEl.style.background = 'rgba(239, 68, 68, 0.8)'
      statusEl.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)'
    } else {
      statusEl.style.background = 'transparent'
      statusEl.style.boxShadow = 'none'
    }
  }

  return {
    element: hud,
    showErrorToast,
    showLoading,
    hideLoading,
    setResetHandler,
    setSoundToggleHandler,
    setSoundModeToggleHandler,
    setOffAxisToggleHandler,
    updateOffAxisStatus,
  }
}
