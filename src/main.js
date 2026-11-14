import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { createWorld } from './scene.js'

gsap.registerPlugin(ScrollTrigger)

// Always open at the very first scene with the loading screen, wherever the visitor left off.
try { history.scrollRestoration = 'manual' } catch {}
if (location.hash) history.replaceState(null, '', location.pathname + location.search)
window.scrollTo(0, 0)
addEventListener('pageshow', (e) => { if (e.persisted) location.reload() }) // back/forward cache
addEventListener('pagehide', () => window.scrollTo(0, 0))

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

// Screens shown in 3D for each feature, in beat order.
// Runtime-built URLs (not bundler imports), so they need the deploy's base path by hand.
const BASE = import.meta.env.BASE_URL
const PROJECT_IMAGES = [
  [`${BASE}work/meesho-1.jpg`, `${BASE}work/meesho-2.jpg`, `${BASE}work/meesho-3.jpg`],
  [`${BASE}work/pulse-1.jpg`, `${BASE}work/pulse-2.jpg`, `${BASE}work/pulse-3.jpg`],
  [`${BASE}work/wed-1.jpg`, `${BASE}work/wed-2.jpg`, `${BASE}work/wed-3.jpg`],
]

// ---------- split text into words (keeps <em> etc.) ----------
function split(el, cls) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment()
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return frag.append(' ')
          const w = document.createElement('span'); w.className = cls === 'sw' ? 'sw' : 'w'
          if (cls === 'sw') w.textContent = part
          else { const i = document.createElement('span'); i.className = 'wi'; i.textContent = part; w.append(i) }
          frag.append(w)
        })
        child.replaceWith(frag)
      } else if (child.nodeType === 1) walk(child)
    }
  }
  walk(el)
}
$$('[data-split]').forEach((el) => split(el))
$$('[data-scrub]').forEach((el) => split(el, 'sw'))

// ---------- world + loader ----------
document.body.classList.add('locked')
const count = $('#loader-count'), arc = $('.leader-arc')
const shown = { v: 0 }
const world = createWorld($('#world'), PROJECT_IMAGES, {
  reduced,
  onProgress: (p) => gsap.to(shown, {
    v: p * 100, duration: 0.5, overwrite: true,
    onUpdate: () => { count.textContent = Math.round(shown.v); arc.style.strokeDashoffset = 339.3 * (1 - shown.v / 100) },
  }),
})

// ---------- smooth scroll ----------
const lenis = reduced ? null : new Lenis({ duration: 1.25, smoothWheel: true })
if (lenis) {
  lenis.stop()
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}
const scrollTo = (target) => (lenis ? lenis.scrollTo(target, { duration: 2.2 }) : $(target).scrollIntoView())
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollTo(a.getAttribute('href')) }))

// ---------- camera keyframes come from where the sections sit on the page ----------
let sections = []
function measure() {
  const vh = innerHeight
  sections = $$('[data-cam]').map((el) => {
    const start = el.getBoundingClientRect().top + scrollY
    return { cam: el.dataset.cam, start, end: start + Math.max(0, el.offsetHeight - vh) }
  })
  sections[0].start = sections[0].end = 0
}
addEventListener('resize', () => { world.layout(); measure() })

// ---------- features: three beats each, driven by scroll through the pinned stage ----------
const beats = [0, 0, 0]
$$('.project').forEach((sec) => {
  const i = +sec.dataset.project
  const cards = $$('.beat', sec), ticks = $$('.ticks li', sec)
  let active = 0
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => {
      const p = Math.min(0.9999, self.progress) * 3
      const n = Math.floor(p), f = p - n
      const t = Math.min(1, Math.max(0, (f - 0.72) / 0.28))
      beats[i] = Math.min(2, n + t * t * (3 - 2 * t))
      const now = Math.round(beats[i])
      if (now !== active) {
        active = now
        cards.forEach((c, k) => c.classList.toggle('on', k === now))
        ticks.forEach((c, k) => c.classList.toggle('on', k <= now))
      }
    },
  })
})

// ---------- scroll reveals ----------
if (!reduced) {
  $$('main [data-split]:not([data-intro-title])').forEach((el) => {
    gsap.from($$('.wi', el), { yPercent: 115, duration: 1.2, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: el, start: 'top 88%' } })
  })
  $$('.slate').forEach((el) => gsap.from(el, { opacity: 0, x: -24, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } }))
  $$('[data-rise]').forEach((el) => gsap.from(el, { opacity: 0, y: 40, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%' } }))
  $$('.pcopy').forEach((el) => gsap.from($$('.logline, .meta, .beats, .pfoot', el), { opacity: 0, y: 26, duration: 1, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 70%' } }))
  $$('[data-scrub]').forEach((el) => gsap.to($$('.sw', el), { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 45%', scrub: true } }))
  gsap.to('.title-card > *', { opacity: 0, y: -60, ease: 'none', scrollTrigger: { trigger: '.title-card', start: 'top top', end: '70% top', scrub: true } })
}

// ---------- HUD: scene label, timecode, progress ----------
const sceneNo = $('#scene-no'), sceneName = $('#scene-name'), timecode = $('#timecode'), progress = $('#progress')
$$('[data-scene]').forEach((el) => ScrollTrigger.create({
  trigger: el, start: 'top 55%', end: 'bottom 55%',
  onToggle: (self) => { if (self.isActive) { sceneNo.textContent = el.dataset.scene; sceneName.textContent = el.dataset.name } },
}))
const two = (n) => String(Math.floor(n)).padStart(2, '0')
const RUNTIME = 144 // seconds of "film" across the whole page

// ---------- cursor ----------
const cursor = $('.cursor')
addEventListener('pointermove', (e) => {
  cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
  cursor.classList.toggle('hot', !!e.target.closest('a, button, .roles li'))
})

// ---------- render loop ----------
gsap.ticker.add((time) => {
  const y = lenis ? lenis.scroll : scrollY
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight)
  const p = Math.min(1, Math.max(0, y / max))
  const s = p * RUNTIME
  timecode.textContent = `00:${two(s / 60)}:${two(s % 60)}:${two((s % 1) * 24)}`
  progress.style.transform = `scaleX(${p})`
  world.update({ y, sections, beats, velocity: lenis ? lenis.velocity : 0, time })
})

// ---------- opening ----------
const minimum = new Promise((r) => setTimeout(r, reduced ? 0 : 1400))
Promise.all([world.ready, document.fonts.ready, minimum]).then(() => {
  measure(); ScrollTrigger.refresh()
  const open = () => { document.body.classList.remove('locked'); lenis?.start(); $('#loader').remove(); measure(); ScrollTrigger.refresh() }
  if (reduced) return open()
  gsap.timeline({ defaults: { ease: 'expo.inOut' } })
    .to('.loader-card', { opacity: 0, scale: 0.96, duration: 0.6, ease: 'power2.in' }, 0.2)
    .to('.loader-half.top', { yPercent: -100, duration: 1.5 }, 0.7)
    .to('.loader-half.bottom', { yPercent: 100, duration: 1.5 }, 0.7)
    .from('[data-intro-title] .wi', { yPercent: 115, duration: 1.5, stagger: 0.12, ease: 'expo.out' }, 1.1)
    .from('[data-intro]', { opacity: 0, y: 24, duration: 1.1, stagger: 0.12, ease: 'power3.out' }, 1.6)
    .from('.bar > *:not(.progress)', { opacity: 0, duration: 1, ease: 'power2.out' }, 1.8)
    .add(open, 1.9)
})
