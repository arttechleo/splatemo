export const createOverlay = () => {
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.innerHTML = `
    <div class="overlay__top">
      <div class="overlay__avatar"></div>
      <div class="overlay__user">
        <span class="overlay__name">splatemō</span>
        <span class="overlay__handle">@volumetric</span>
      </div>
    </div>
    <div class="overlay__right">
      <button class="overlay__action" type="button">♥</button>
      <button class="overlay__action" type="button">💬</button>
      <button class="overlay__action" type="button">↻</button>
      <button class="overlay__action" type="button">🔖</button>
    </div>
    <div class="overlay__bottom">
      <p class="overlay__caption">A cinematic volumetric scan reveal.</p>
    </div>
  `

  overlay.querySelectorAll('.overlay__action').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.add('overlay__action--pulse')
      window.setTimeout(() => button.classList.remove('overlay__action--pulse'), 300)
    })
  })

  return overlay
}
