export type OverlayData = {
  user: { handle: string; name: string; avatar?: string }
  caption: string
  counts: { likes: number; comments: number; reposts: number }
}

export const createOverlay = () => {
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.innerHTML = `
    <div class="overlay__top">
      <div class="overlay__avatar">L</div>
      <div class="overlay__user">
        <span class="overlay__name">splatemo</span>
        <span class="overlay__handle">@volumetric</span>
      </div>
    </div>
    <div class="overlay__right">
      <button class="overlay__action" data-action="like" type="button">♥ <span class="overlay__count">0</span></button>
      <button class="overlay__action" data-action="comment" type="button">💬 <span class="overlay__count">0</span></button>
      <button class="overlay__action" data-action="repost" type="button">↻ <span class="overlay__count">0</span></button>
      <button class="overlay__action" data-action="bookmark" type="button">🔖</button>
    </div>
    <div class="overlay__caption">Loading...</div>
    <form class="overlay__comment">
      <input type="text" placeholder="Add a comment" />
      <button type="submit">Send</button>
    </form>
  `

  overlay.querySelectorAll<HTMLButtonElement>('.overlay__action').forEach((button) => {
    button.addEventListener('click', () => {
      console.log('UI action', button.dataset.action)
      button.classList.add('overlay__action--pulse')
      window.setTimeout(() => button.classList.remove('overlay__action--pulse'), 250)
    })
  })

  const form = overlay.querySelector<HTMLFormElement>('.overlay__comment')
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const input = form.querySelector<HTMLInputElement>('input')
      console.log('UI comment submit', input?.value)
      if (input) input.value = ''
    })
  }

  const setData = (data: OverlayData) => {
    const name = overlay.querySelector<HTMLSpanElement>('.overlay__name')
    const handle = overlay.querySelector<HTMLSpanElement>('.overlay__handle')
    const avatar = overlay.querySelector<HTMLDivElement>('.overlay__avatar')
    const caption = overlay.querySelector<HTMLDivElement>('.overlay__caption')
    const counts = overlay.querySelectorAll<HTMLButtonElement>('.overlay__action')
    if (name) name.textContent = data.user.name
    if (handle) handle.textContent = data.user.handle
    if (avatar) avatar.textContent = data.user.avatar ?? data.user.name.slice(0, 1).toUpperCase()
    if (caption) caption.textContent = data.caption
    counts.forEach((button) => {
      const count = button.querySelector<HTMLSpanElement>('.overlay__count')
      if (!count) return
      const action = button.dataset.action
      if (action === 'like') count.textContent = data.counts.likes.toLocaleString()
      if (action === 'comment') count.textContent = data.counts.comments.toLocaleString()
      if (action === 'repost') count.textContent = data.counts.reposts.toLocaleString()
    })
  }

  return { element: overlay, setData }
}
