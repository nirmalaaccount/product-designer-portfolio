// The 3D world: one long dark corridor the camera dollies through as the page scrolls.
// Hero = a ring of film frames around the title. Each feature = a carousel of real screens.
import * as THREE from 'three'

const BG = 0x080706
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const PROJECT_Z = [-30, -50, -70]
const DOLLY = 6.5 // camera distance from a feature's screens
const RING_R = 5.2
const CAROUSEL_R = 5

const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const screenFrag = /* glsl */ `
  uniform sampler2D map; uniform vec4 uUv; uniform vec2 uSize;
  uniform float uBright; uniform float uAlpha; uniform float uRadius;
  varying vec2 vUv;
  float rbox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    float d = rbox((vUv - 0.5) * uSize, uSize * 0.5, uRadius);
    float a = 1.0 - smoothstep(-0.006, 0.006, d);
    vec3 c = texture2D(map, vUv * uUv.xy + uUv.zw).rgb * uBright;
    c += smoothstep(-0.02, -0.004, d) * 0.12 * uBright;
    float alpha = a * uAlpha;
    if (alpha < 0.004) discard;
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    c = mix(c, vec3(0.031, 0.027, 0.024), 1.0 - exp(-depth * depth * 0.0042));
    gl_FragColor = vec4(c, alpha);
  }
`

function makeScreen(tex, w, h, radius, uv = [1, 1, 0, 0]) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: screenVert, fragmentShader: screenFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      map: { value: tex }, uUv: { value: new THREE.Vector4(...uv) }, uSize: { value: new THREE.Vector2(w, h) },
      uBright: { value: 1 }, uAlpha: { value: 1 }, uRadius: { value: radius },
    },
  })
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export function createWorld(canvas, projectImages, { onProgress, reduced }) {
  const small = Math.min(innerWidth, innerHeight) < 700
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2))
  renderer.setClearColor(BG)
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(BG, 0.05)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 140)
  camera.position.set(0, 0, 6)

  // ---- dust in the projector beam (two layers drifting at different speeds)
  const glow = glowTexture()
  const dust = [0, 1].map((layer) => {
    const n = small ? 700 : 1500
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15
      pos[i * 3 + 2] = 12 - Math.random() * 140
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glow, size: layer ? 0.11 : 0.06, color: layer ? 0xf0a868 : 0xf1e9dc, transparent: true,
      opacity: layer ? 0.5 : 0.75, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    scene.add(pts)
    return pts
  })

  // ---- soft out-of-focus lights along the corridor
  const bokeh = []
  const tints = [0xf0a868, 0xe98fa6, 0xf1e9dc, 0xf0a868]
  for (let i = 0; i < (small ? 16 : 30); i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: tints[i % 4], transparent: true, opacity: 0.05 + Math.random() * 0.1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    const side = i % 2 ? 1 : -1
    s.position.set(side * (4 + Math.random() * 7), (Math.random() - 0.5) * 9, 2 - Math.random() * 118)
    s.scale.setScalar(1.5 + Math.random() * 4.5)
    s.userData = { y: s.position.y, p: Math.random() * 6.28 }
    scene.add(s); bokeh.push(s)
  }

  // ---- the light at the end
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xf0a868, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  sun.position.set(0, -7.5, -128); sun.scale.setScalar(30); scene.add(sun)

  // ---- textures
  const ring = new THREE.Group(); ring.position.set(0, 0, -5); ring.rotation.set(0.36, 0, -0.16); scene.add(ring)
  const projects = PROJECT_Z.map((z) => {
    const group = new THREE.Group(); group.position.set(0, 0, z)
    const pivot = new THREE.Group(); pivot.position.z = -CAROUSEL_R; group.add(pivot)
    scene.add(group)
    return { group, pivot, planes: [], aspect: 1, cur: 0, step: 0.5 }
  })

  const manager = new THREE.LoadingManager()
  const ready = new Promise((res) => { manager.onLoad = res; manager.onError = () => {} })
  manager.onProgress = (_, loaded, total) => onProgress?.(loaded / total)
  const loader = new THREE.TextureLoader(manager)
  const all = []
  projectImages.forEach((urls, pi) => urls.forEach((url, k) => {
    const tex = loader.load(url, (t) => {
      const ia = t.image.width / t.image.height
      const p = projects[pi]
      const mesh = makeScreen(t, ia, 1, 0.022)
      mesh.userData.k = k
      p.aspect = ia; p.planes[k] = mesh; p.pivot.add(mesh)
      layout()
    })
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter
    all.push(tex)
  }))
  ready.then(() => {
    // the hero ring reuses every screen as a frame of film
    const N = 14, fw = 1.55, fh = 0.98, fa = fw / fh
    for (let i = 0; i < N; i++) {
      const t = all[(i * 4) % all.length]; const ia = t.image.width / t.image.height
      const uv = ia > fa ? [fa / ia, 1, (1 - fa / ia) / 2, 0] : [1, ia / fa, 0, 1 - ia / fa]
      const m = makeScreen(t, fw, fh, 0.05, uv)
      const a = (i / N) * Math.PI * 2
      m.position.set(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R); m.rotation.y = a
      m.material.uniforms.uBright.value = 0.62
      ring.add(m)
    }
  })

  // ---- layout: fit each feature's screens to the free half of the frame
  let W = 1, H = 1, portrait = false, camOff = new THREE.Vector2()
  function layout() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight
    portrait = w / h < 1
    camera.aspect = w / h; camera.fov = portrait ? 52 : 40; camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    H = 2 * DOLLY * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); W = H * camera.aspect
    camOff.set(portrait ? 0 : -W * 0.235, portrait ? -H * 0.26 : 0)
    ring.scale.setScalar(portrait ? 0.5 : 1)
    for (const p of projects) {
      const s = portrait ? Math.min((W * 0.8) / p.aspect, H * 0.3) : Math.min((W * 0.45) / p.aspect, H * 0.7)
      p.step = Math.min(0.95, (s * p.aspect * 1.12) / CAROUSEL_R)
      p.planes.forEach((m, k) => {
        if (!m) return
        const a = k * p.step
        m.scale.setScalar(s); m.position.set(Math.sin(a) * CAROUSEL_R, 0, Math.cos(a) * CAROUSEL_R); m.rotation.y = a
      })
    }
  }
  layout()

  const KEY = {
    hero: () => new THREE.Vector3(0, 0, 6),
    about: () => new THREE.Vector3(0, 0.3, -9),
    p0: () => new THREE.Vector3(camOff.x, camOff.y, PROJECT_Z[0] + DOLLY),
    p1: () => new THREE.Vector3(camOff.x, camOff.y, PROJECT_Z[1] + DOLLY),
    p2: () => new THREE.Vector3(camOff.x, camOff.y, PROJECT_Z[2] + DOLLY),
    career: () => new THREE.Vector3(0, 0, -84),
    craft: () => new THREE.Vector3(0, 0, -95),
    end: () => new THREE.Vector3(0, 0, -107),
  }
  const target = new THREE.Vector3(0, 0, 6), a = new THREE.Vector3(), b = new THREE.Vector3()
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 }
  let kick = 0, first = true, last = 0

  // sections: [{ cam, start, end }] in page order, scroll px. beats[i]: 0..2 (fractional) for feature i.
  function update({ y, sections, beats, velocity, time }) {
    let i = sections.findIndex((s) => y <= s.end)
    if (i < 0) i = sections.length - 1
    const s = sections[i]
    if (!s) return
    if (y >= s.start || i === 0) target.copy(KEY[s.cam]())
    else {
      const prev = sections[i - 1]
      const t = ease(clamp01((y - prev.end) / Math.max(1, s.start - prev.end)))
      target.lerpVectors(a.copy(KEY[prev.cam]()), b.copy(KEY[s.cam]()), t)
    }
    const dt = Math.min(1, Math.max(0.001, time - last)); last = time
    const damp = (rate) => 1 - Math.exp(-dt * rate) // frame-rate independent easing
    const km = damp(3.2)
    mouse.sx += (mouse.x - mouse.sx) * km; mouse.sy += (mouse.y - mouse.sy) * km
    const k = first ? 1 : damp(5.5); first = false
    camera.position.x += (target.x + mouse.sx * 0.25 - camera.position.x) * k
    camera.position.y += (target.y - mouse.sy * 0.15 - camera.position.y) * k
    camera.position.z += (target.z - camera.position.z) * k
    camera.rotation.set(mouse.sy * 0.025, -mouse.sx * 0.04, reduced ? 0 : Math.sin(time * 0.2) * 0.004)
    kick += (Math.min(7, Math.abs(velocity) * 0.09) - kick) * damp(5)
    const fov = (portrait ? 52 : 40) + (reduced ? 0 : kick)
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }

    const cz = camera.position.z
    if (!reduced) ring.rotation.y = time * 0.07 + y * 0.0006
    ring.visible = cz > -12
    sun.material.opacity = smooth(-90, -106, cz) * 0.85

    dust[0].position.y = Math.sin(time * 0.07) * 0.5; dust[0].position.x = Math.cos(time * 0.05) * 0.4
    dust[1].position.y = Math.cos(time * 0.05) * 0.8; dust[1].rotation.z = Math.sin(time * 0.03) * 0.02
    for (const s of bokeh) s.position.y = s.userData.y + Math.sin(time * 0.25 + s.userData.p) * 0.5

    projects.forEach((p, pi) => {
      const dist = Math.abs(cz - PROJECT_Z[pi])
      p.group.visible = dist < 24
      if (!p.group.visible) return
      const fade = 1 - smooth(9, 22, dist)
      p.cur += ((beats[pi] ?? 0) - p.cur) * damp(5)
      p.pivot.rotation.y = -p.cur * p.step
      p.group.rotation.y = (portrait ? 0 : -0.2) + mouse.sx * 0.07
      p.group.rotation.x = mouse.sy * 0.04
      p.group.position.y = reduced ? 0 : Math.sin(time * 0.6 + pi) * 0.04
      p.planes.forEach((m, k2) => {
        if (!m) return
        const rel = k2 - p.cur
        const u = m.material.uniforms
        u.uBright.value = 0.28 + 0.72 * (1 - clamp01(Math.abs(rel)))
        u.uAlpha.value = fade * (rel >= 0 ? clamp01(1.6 - rel * 0.6) : clamp01(1 + rel * 1.5))
        m.renderOrder = 10 - Math.round(Math.abs(rel) * 3)
      })
    })
    renderer.render(scene, camera)
  }

  addEventListener('pointermove', (e) => { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1 })
  return { update, layout, ready }
}
