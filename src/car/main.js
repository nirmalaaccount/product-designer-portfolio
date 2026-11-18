import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { createWorld } from './world.js'

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

// Screens on each showroom bay's display wall, in beat order.
// Runtime-built URLs (not bundler imports), so they need the deploy's base path by hand.
const BASE = import.meta.env.BASE_URL
const PROJECT_IMAGES = [
  [`${BASE}work/wed-1.jpg`, `${BASE}work/wed-2.jpg`, `${BASE}work/wed-3.jpg`],
  [`${BASE}work/pulse-1.jpg`, `${BASE}work/pulse-2.jpg`, `${BASE}work/pulse-3.jpg`],
  [`${BASE}work/snapchat-1.jpg`, `${BASE}work/snapchat-2.jpg`, `${BASE}work/snapchat-3.jpg`],
]

// split headings into words for the rise-in reveal (keeps <em>)
function split(el) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment()
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return frag.append(' ')
          const w = document.createElement('span'); w.className = 'w'
          const i = document.createElement('span'); i.className = 'wi'; i.textContent = part
          w.append(i); frag.append(w)
        })
        child.replaceWith(frag)
      } else if (child.nodeType === 1) walk(child)
    }
  }
  walk(el)
}
$$('[data-split]').forEach(split)
document.body.classList.add('locked')

async function start() {
  // road signs are drawn to canvas, so the display font has to be there first
  await Promise.all([document.fonts.load('800 64px "Big Shoulders Display"'), document.fonts.load('400 30px "Geist Mono"')]).catch(() => {})

  const count = $('#loader-count'), arc = $('.dial-arc'), shown = { v: 0 }
  const world = createWorld($('#world'), PROJECT_IMAGES, {
    reduced,
    onProgress: (p) => gsap.to(shown, {
      v: p * 100, duration: 0.5, overwrite: true,
      onUpdate: () => { count.textContent = Math.round(shown.v); arc.style.strokeDasharray = `${254.5 * (shown.v / 100)} 339.3` },
    }),
  })

  const lenis = reduced ? null : new Lenis({ duration: 1.3, smoothWheel: true })
  if (lenis) {
    lenis.stop()
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add((t) => lenis.raf(t * 1000))
    gsap.ticker.lagSmoothing(0)
  }
  const scrollTo = (target) => (lenis ? lenis.scrollTo(target, { duration: 2.6 }) : $(target).scrollIntoView())
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollTo(a.getAttribute('href')) }))

  // each scene's place on the page is its keyframe range
  let sections = []
  function measure() {
    const vh = innerHeight
    sections = $$('[data-cam]').map((el) => {
      const top = el.getBoundingClientRect().top + scrollY
      return { cam: el.dataset.cam, start: top, end: top + Math.max(0, el.offsetHeight - vh) }
    })
    sections[0].start = sections[0].end = 0
  }
  addEventListener('resize', () => { world.layout(); measure() })

  // showroom bays: three beats each
  const beats = [0, 0, 0]
  $$('.project').forEach((sec) => {
    const i = +sec.dataset.project, cards = $$('.beat', sec), ticks = $$('.ticks li', sec)
    let active = 0
    ScrollTrigger.create({
      trigger: sec, start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => {
        const p = Math.min(0.9999, self.progress) * 3, n = Math.floor(p)
        const t = Math.min(1, Math.max(0, (p - n - 0.72) / 0.28))
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

  // the road: each role lights up as its gantry passes overhead
  const roles = $$('.roles li')
  ScrollTrigger.create({
    trigger: '#career', start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => { const n = Math.min(3, Math.floor(self.progress * 4)); roles.forEach((r, k) => r.classList.toggle('on', k === n)) },
  })

  if (!reduced) {
    $$('main [data-split]:not([data-intro-title])').forEach((el) => {
      gsap.from($$('.wi', el), { yPercent: 115, duration: 1.1, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: el.closest('.pin') || el, start: 'top 45%' } })
    })
    $$('.copy').forEach((el) => {
      gsap.from($$('.slate, .facts > div, .roles, .logline, .meta, .beats, .pfoot, .spec > div, .cta, .credits', el), {
        opacity: 0, y: 26, duration: 1, stagger: 0.07, ease: 'power3.out', scrollTrigger: { trigger: el.closest('.pin'), start: 'top 45%' },
      })
    })
    gsap.to('.title-card > *', { opacity: 0, y: -50, ease: 'none', scrollTrigger: { trigger: '.title-card', start: 'top top', end: '60% top', scrub: true } })
  }

  // dashboard
  const sceneNo = $('#scene-no'), sceneName = $('#scene-name'), gear = $('#gear'), speed = $('#speed'), progress = $('#progress')
  $$('[data-scene]').forEach((el) => ScrollTrigger.create({
    trigger: el, start: 'top 55%', end: 'bottom 55%',
    onToggle: (self) => { if (self.isActive) { sceneNo.textContent = el.dataset.scene; sceneName.textContent = el.dataset.name; gear.textContent = el.dataset.gear } },
  }))
  let kmh = 0

  gsap.ticker.add((time) => {
    const y = lenis ? lenis.scroll : scrollY
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight)
    const v = lenis ? lenis.velocity : 0
    kmh += (Math.min(240, Math.abs(v) * 2.4) - kmh) * 0.12
    speed.textContent = String(Math.round(kmh)).padStart(3, '0')
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, y / max))})`
    world.update({ y, sections, beats, velocity: v, time })
  })

  const minimum = new Promise((r) => setTimeout(r, reduced ? 0 : 1400))
  await Promise.all([world.ready, minimum])
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
}
start()
