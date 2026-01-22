export const createOverlay = () => {
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.innerHTML = `
    <div class="overlay__top">
      <div class="overlay__avatar"></div>
      <div class="overlay__user">
        <span class="overlay__name">splatemo</span>
        <span class="overlay__handle">@volumetric</span>
      </div>
    </div>
    <div class="overlay__right">
      <button class="overlay__action" data-action="like" type="button">♥</button>
      <button class="overlay__action" data-action="comment" type="button">💬</button>
      <button class="overlay__action" data-action="repost" type="button">↻</button>
      <button class="overlay__action" data-action="bookmark" type="button">🔖</button>
    </div>
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

  return overlay
}
