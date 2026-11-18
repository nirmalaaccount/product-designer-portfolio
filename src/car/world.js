// The car film: one continuous world laid out along -z.
//   garage (z 0)  ->  night road (z -6..-160)  ->  showroom (z -165..-285)  ->  open road at dawn
// Scroll position picks a keyframe (camera + both cars); everything else follows from that.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

const NIGHT = new THREE.Color(0x05070a), DAWN = new THREE.Color(0x3a2230)
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const mix = (a, b, t) => a + (b - a) * t

const ROAD_END = -150, HALL = [-165, -285], BAY_Z = [-190, -215, -240], BAY_X = 5, STAGE_Z = -272
const BAY_PAINT = [0x9a2a86, 0x1c7a55, 0xc92f52]

// ---------- small builders ----------
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.4)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}
function signTexture(big, small, w = 768, h = 224) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#0a0d11'; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#2b323b'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12)
  g.fillStyle = '#38e1c6'; g.fillRect(34, 40, 8, h - 80)
  g.fillStyle = '#eef2f6'; g.textBaseline = 'middle'
  g.font = `800 ${small ? 128 : 92}px "Big Shoulders Display", sans-serif`; g.fillText(big, 66, small ? h * 0.4 : h * 0.52)
  if (small) { g.fillStyle = '#9aa3ad'; g.font = '400 30px "Geist Mono", monospace'; g.fillText(small, 68, h * 0.78) }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}
const cr = (a, b, c, d, u) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u)
// Loft a smooth shell through cross-sections. ctrl rows: [t (0 rear .. 1 front), half width, bottom y, top y].
// Each section is a superellipse, so n sets how boxy (high) or round (low) the body reads. Front faces -z.
function loft(ctrl, len, n, segs = 48, ring = 36) {
  const at = (t) => {
    let i = 0; while (i < ctrl.length - 2 && t > ctrl[i + 1][0]) i++
    const u = (t - ctrl[i][0]) / (ctrl[i + 1][0] - ctrl[i][0]), r = (k) => ctrl[Math.min(ctrl.length - 1, Math.max(0, k))]
    return [1, 2, 3].map((c) => cr(r(i - 1)[c], r(i)[c], r(i + 1)[c], r(i + 2)[c], u))
  }
  const pos = [], idx = [], pw = (v) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n)
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, [w, yb, yt] = at(t), cy = (yb + yt) / 2, h = (yt - yb) / 2
    for (let j = 0; j < ring; j++) { const a = (j / ring) * Math.PI * 2; pos.push(w * pw(Math.cos(a)), cy + h * pw(Math.sin(a)), len / 2 - t * len) }
  }
  for (let s = 0; s < segs; s++) for (let j = 0; j < ring; j++) {
    const a = s * ring + j, b = s * ring + ((j + 1) % ring), c = a + ring, d = b + ring
    idx.push(a, b, c, b, d, c)
  }
  for (const s of [0, segs]) { // end caps
    const [, yb, yt] = at(s / segs), centre = pos.length / 3; pos.push(0, (yb + yt) / 2, len / 2 - (s / segs) * len)
    for (let j = 0; j < ring; j++) idx.push(centre, s * ring + j, s * ring + ((j + 1) % ring))
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return g
}

const CARS = {
  // the car we arrive in: upright, friendly hatchback
  old: {
    len: 3.9, half: 0.83, wheel: 0.33, axle: 1.2, n: 4.2, lampY: 0.72, tailY: 0.84,
    body: [[0, 0.6, 0.5, 0.88], [0.05, 0.8, 0.36, 0.96], [0.3, 0.83, 0.3, 0.97], [0.7, 0.83, 0.3, 0.92], [0.92, 0.79, 0.36, 0.82], [1, 0.58, 0.46, 0.68]],
    cabin: { len: 2.62, z: 0.44, ctrl: [[0, 0.6, 0.9, 1.08], [0.14, 0.72, 0.9, 1.45], [0.68, 0.72, 0.9, 1.45], [1, 0.62, 0.86, 0.92]] },
  },
  // showroom cars: long, low fastback
  sleek: {
    len: 4.6, half: 0.93, wheel: 0.36, axle: 1.42, n: 3.2, lampY: 0.6, tailY: 0.78,
    body: [[0, 0.56, 0.5, 0.78], [0.05, 0.85, 0.34, 0.9], [0.22, 0.93, 0.28, 0.93], [0.52, 0.94, 0.27, 0.86], [0.8, 0.9, 0.28, 0.75], [0.95, 0.8, 0.34, 0.64], [1, 0.52, 0.44, 0.57]],
    cabin: { len: 2.7, z: 0.34, ctrl: [[0, 0.5, 0.8, 0.86], [0.3, 0.68, 0.8, 1.19], [0.58, 0.7, 0.8, 1.21], [1, 0.56, 0.74, 0.8]] },
  },
}

function makeCar(kind, paint, glow, { strip = false } = {}) {
  const s = CARS[kind], car = new THREE.Group()
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x06090d, metalness: 0.9, roughness: 0.06, clearcoat: 1, side: THREE.DoubleSide })
  s.width = s.half * 2
  const body = new THREE.Mesh(loft(s.body, s.len, s.n), paintMat)
  const cabin = new THREE.Mesh(loft(s.cabin.ctrl, s.cabin.len, 3), glassMat); cabin.position.z = s.cabin.z
  car.add(body, cabin)

  const tyre = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.85 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.9, roughness: 0.25 })
  const tyreGeo = new THREE.CylinderGeometry(s.wheel, s.wheel, 0.24, 30).rotateZ(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(s.wheel * 0.6, s.wheel * 0.6, 0.262, 7).rotateZ(Math.PI / 2)
  const wheels = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Group(); w.add(new THREE.Mesh(tyreGeo, tyre), new THREE.Mesh(rimGeo, rim))
    w.position.set(sx * (s.half - 0.09), s.wheel, sz * s.axle); car.add(w); wheels.push(w)
  }

  // lights: emissive lenses, soft beams and a pool of light on the road
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false })
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false })
  const front = -s.len / 2 + 0.06, rear = s.len / 2 - 0.06, lampY = s.lampY
  if (strip) {
    car.add(new THREE.Mesh(new THREE.BoxGeometry(s.width - 0.62, 0.035, 0.1), headMat).translateY(lampY).translateZ(front))
    car.add(new THREE.Mesh(new THREE.BoxGeometry(s.width - 0.84, 0.04, 0.1), tailMat).translateY(s.tailY).translateZ(rear - 0.03))
  } else {
    for (const sx of [-1, 1]) {
      car.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), headMat).translateX(sx * (s.half - 0.36)).translateY(lampY).translateZ(front + 0.05))
      car.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 0.1), tailMat).translateX(sx * (s.half - 0.42)).translateY(s.tailY).translateZ(rear))
    }
  }
  const flareMat = new THREE.SpriteMaterial({ map: glow, color: 0xffe9c8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const beams = [-1, 1].map((sx) => { const b = new THREE.Sprite(flareMat); b.scale.setScalar(1.5); b.position.set(sx * (s.half - 0.36), lampY, front - 0.08); car.add(b); return b })
  const poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffdcae, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 11).rotateX(-Math.PI / 2), poolMat); pool.position.set(0, 0.03, front - 5); car.add(pool)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(s.width * 1.7, s.len * 1.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }))
  shadow.position.y = 0.02; car.add(shadow)

  let lastZ = null
  return {
    group: car, spec: s,
    setLights(v) {
      headMat.color.setRGB(0.08 + v * 0.92, 0.08 + v * 0.87, 0.08 + v * 0.76); tailMat.color.setRGB(0.25 + v * 0.75, 0.02 + v * 0.14, 0.02 + v * 0.08)
      flareMat.opacity = 0.9 * v; poolMat.opacity = 0.4 * v; beams[0].visible = beams[1].visible = pool.visible = v > 0.01
    },
    roll() { // spin the wheels by distance travelled
      const z = car.position.z
      if (lastZ !== null) for (const w of wheels) w.rotation.x += (z - lastZ) / s.wheel
      lastZ = z
    },
  }
}

// ---------- the real car models (public/cars/*.glb, prepared in Blender) ----------
// Every model is 4.6 m long, sits on the ground and is centred. `flip` turns it round when its nose points the wrong way.
// `paint` repaints models that use flat paint materials; the textured ones keep their own colour.
// These URLs are runtime strings (not bundler imports), so the deploy's base path is added by hand.
const BASE = import.meta.env.BASE_URL
const CAR_MODELS = {
  tesla: { url: `${BASE}cars/tesla.glb`, flip: true, half: 1.0, lampX: 0.62, lampY: 0.6 },
  corvette: { url: `${BASE}cars/corvette.glb`, flip: false, half: 1.07, lampX: 0.7, lampY: 0.62 },
  ferrari: { url: `${BASE}cars/ferrari.glb`, flip: false, half: 1.04, lampX: 0.68, lampY: 0.62 },
  mclaren: { url: `${BASE}cars/mclaren.glb`, flip: true, half: 1.0, lampX: 0.62, lampY: 0.55 },
  alpine: { url: `${BASE}cars/alpine.glb`, flip: false, half: 1.07, lampX: 0.7, lampY: 0.6 },
}

function makeModelCar(key, glow, { models, paint } = {}) {
  const cfg = CAR_MODELS[key], s = { len: 4.6, half: cfg.half, width: cfg.half * 2 }
  const car = new THREE.Group(), body = new THREE.Group()
  if (cfg.flip) body.rotation.y = Math.PI
  car.add(body)
  const wheels = [] // { pivot, radius }, filled once the model has loaded
  const sign = cfg.flip ? -1 : 1

  models[key].then((src) => {
    const m = src.clone(true)
    // the Sketchfab files ship with alpha-blended materials whose alpha is not real transparency, so draw everything solid
    if (cfg.solid) m.traverse((o) => {
      if (!o.isMesh) return
      for (const mt of Array.isArray(o.material) ? o.material : [o.material]) { mt.transparent = false; mt.alphaTest = 0; mt.depthWrite = true; mt.side = THREE.DoubleSide; mt.needsUpdate = true }
    })
    if (paint) {
      m.traverse((o) => {
        if (!o.isMesh) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        const next = mats.map((mt) => {
          if (!paint.match.test(mt.name)) return mt
          const c = mt.clone(); c.color.set(paint.color); c.metalness = 0.6; c.roughness = 0.28; return c
        })
        o.material = Array.isArray(o.material) ? next : next[0]
      })
    }
    const found = []
    m.traverse((o) => { if (/_Wheel_[FR][LR]$/.test(o.name)) found.push(o) })
    for (const w of found) { // pivot each wheel at its own centre so it spins about its axle
      const box = new THREE.Box3().setFromObject(w), c = box.getCenter(new THREE.Vector3())
      const pivot = new THREE.Group(); pivot.position.copy(c)
      w.parent.add(pivot); pivot.add(w); w.position.sub(c)
      wheels.push({ pivot, radius: (box.max.y - box.min.y) / 2 })
    }
    body.add(m)
  })

  // glow, beams and the road pool in front of the car
  const front = -s.len / 2 + 0.06
  const flareMat = new THREE.SpriteMaterial({ map: glow, color: 0xffe9c8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const flares = [-1, 1].map((sx) => { const b = new THREE.Sprite(flareMat); b.scale.setScalar(1.2); b.position.set(sx * cfg.lampX, cfg.lampY, front - 0.08); car.add(b); return b })
  const poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffdcae, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 11).rotateX(-Math.PI / 2), poolMat); pool.position.set(0, 0.03, front - 5); car.add(pool)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(s.width * 1.7, s.len * 1.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }))
  shadow.position.y = 0.02; car.add(shadow)

  let lastZ = null
  return {
    group: car, spec: s,
    setLights(v) { flareMat.opacity = 0.9 * v; poolMat.opacity = 0.4 * v; flares[0].visible = flares[1].visible = pool.visible = v > 0.01 },
    roll() { // spin the wheels about their axles by distance travelled
      const z = car.position.z
      if (lastZ !== null) for (const w of wheels) w.pivot.rotation.x += sign * (z - lastZ) / w.radius
      lastZ = z
    },
  }
}

const screenVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const screenFrag = `uniform sampler2D map; uniform float uAlpha; varying vec2 vUv;
  void main() { if (uAlpha < 0.004) discard; gl_FragColor = vec4(texture2D(map, vUv).rgb, uAlpha); }`

// ---------- the world ----------
export function createWorld(canvas, projectImages, { onProgress, reduced }) {
  const small = Math.min(innerWidth, innerHeight) < 700
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
  const scene = new THREE.Scene()
  scene.background = NIGHT.clone(); scene.fog = new THREE.FogExp2(NIGHT.getHex(), 0.017)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.75
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 420)
  const glow = glowTexture()
  const add = (o) => (scene.add(o), o)
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m) }

  add(new THREE.HemisphereLight(0x8fa6c4, 0x0b0c0f, 0.5))
  const moon = add(new THREE.DirectionalLight(0x9fb6dc, 0.9)); moon.position.set(-6, 9, 4)

  // ---- ground and road
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.55, metalness: 0.25 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x06070a, roughness: 0.95 })
  const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(600, 700).rotateX(-Math.PI / 2), dark)); ground.position.set(0, -0.03, -200)
  for (const [z0, z1] of [[6, HALL[0]], [HALL[1], -520]]) {
    const road = add(new THREE.Mesh(new THREE.PlaneGeometry(9, z0 - z1).rotateX(-Math.PI / 2), asphalt)); road.position.z = (z0 + z1) / 2
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x6f7780 })
    for (const sx of [-1, 1]) box(0.1, 0.012, z0 - z1, lineMat, sx * 4.15, 0.005, (z0 + z1) / 2)
    const n = Math.floor((z0 - z1 - 16) / 6), dash = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.012, 2), new THREE.MeshBasicMaterial({ color: 0xaab2bb }), n)
    const m = new THREE.Matrix4(); for (let i = 0; i < n; i++) dash.setMatrixAt(i, m.makeTranslation(0, 0.006, z0 - 10 - i * 6)); add(dash)
  }

  // ---- garage
  const concrete = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 })
  box(0.3, 3.8, 11, concrete, -4.4, 1.9, 0.5); box(0.3, 3.8, 11, concrete, 4.4, 1.9, 0.5); box(9, 3.8, 0.3, concrete, 0, 1.9, 6); box(9, 0.3, 11, concrete, 0, 3.8, 0.5)
  const garageLight = add(new THREE.PointLight(0xffe2bd, 40, 16, 2)); garageLight.position.set(0, 3.2, -0.5)

  // ---- street lamps, skyline, year gantries
  const lampMat = new THREE.SpriteMaterial({ map: glow, color: 0xffc27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 })
  for (let z = -12, i = 0; z > ROAD_END - 6; z -= 16, i++) {
    const sx = i % 2 ? 1 : -1
    box(0.12, 5.4, 0.12, poleMat, sx * 5.2, 2.7, z); box(1.2, 0.08, 0.12, poleMat, sx * 4.65, 5.36, z)
    const s = add(new THREE.Sprite(lampMat)); s.position.set(sx * 4.1, 5.25, z); s.scale.setScalar(2.4)
    const p = add(new THREE.Mesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, color: 0xffb768, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })))
    p.position.set(sx * 3, 0.02, z)
  }
  {
    const n = 110, towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x0a0e14 }), n)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pts = []
    for (let i = 0; i < n; i++) {
      const sx = i % 2 ? 1 : -1, w = 5 + Math.random() * 7, h = 7 + Math.random() * 26, d = 5 + Math.random() * 8
      const x = sx * (15 + Math.random() * 34), z = 10 - Math.random() * 175
      towers.setMatrixAt(i, m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(w, h, d)))
      for (let k = 0; k < 16; k++) pts.push(x - sx * (w / 2 + 0.1), 1.5 + Math.random() * (h - 2.5), z + (Math.random() - 0.5) * d)
    }
    add(towers)
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    add(new THREE.Points(geo, new THREE.PointsMaterial({ map: glow, size: 0.55, color: 0xffcf96, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })))
  }
  const gantryZ = [0.125, 0.375, 0.625, 0.875].map((p) => mix(-14, ROAD_END, p) - 9)
  ;[['2021', 'UI DEVELOPER · TCS'], ['2022', 'UX DESIGNER · TCS'], ['2024', 'DESIGN CONSULTANT'], ['2025', 'PRODUCT DESIGNER · MATRIMONY.COM']].forEach(([year, role], i) => {
    const z = gantryZ[i]
    box(0.18, 6, 0.18, poleMat, -5, 3, z); box(0.18, 6, 0.18, poleMat, 5, 3, z); box(10.2, 0.16, 0.16, poleMat, 0, 5.9, z)
    const sign = add(new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.63), new THREE.MeshBasicMaterial({ map: signTexture(year, role), toneMapped: false })))
    sign.position.set(1.4, 5.0, z + 0.12)
  })

  // ---- showroom
  const wall = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.85 })
  const hallLen = HALL[0] - HALL[1], hallMid = (HALL[0] + HALL[1]) / 2
  box(0.4, 7, hallLen, wall, -13, 3.5, hallMid); box(0.4, 7, hallLen, wall, 13, 3.5, hallMid); box(26.4, 0.4, hallLen, wall, 0, 7.2, hallMid)
  for (const z of HALL) { box(9, 7, 0.4, wall, -8.5, 3.5, z); box(9, 7, 0.4, wall, 8.5, 3.5, z); box(8, 2.4, 0.4, wall, 0, 5.8, z) }
  const facade = add(new THREE.Mesh(new THREE.PlaneGeometry(7, 0.82), new THREE.MeshBasicMaterial({ map: signTexture('SELECTED WORK', null, 1100, 130), toneMapped: false })))
  facade.position.set(0, 5.6, HALL[0] + 0.25)
  const shutter = box(8, 4.6, 0.2, new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.6 }), 0, 2.3, HALL[1])
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xe6eef6, toneMapped: false })
  for (let z = HALL[0] - 7; z > HALL[1] + 4; z -= 9) box(17, 0.06, 0.4, stripMat, 0, 6.95, z)
  let floor
  if (small) floor = new THREE.Mesh(new THREE.PlaneGeometry(26, hallLen), new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.12, metalness: 0.7 }))
  else floor = new Reflector(new THREE.PlaneGeometry(26, hallLen), { clipBias: 0.003, textureWidth: 768, textureHeight: 768, color: 0x262b31 })
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.012, hallMid); add(floor)

  const turntable = (x, z, r, tint) => {
    const g = add(new THREE.Group()); g.position.set(x, 0, z)
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 64), new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.3, metalness: 0.8 })).translateY(0.05))
    g.add(new THREE.Mesh(new THREE.TorusGeometry(r + 0.06, 0.025, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: tint, toneMapped: false })).translateY(0.11))
    const spot = add(new THREE.SpotLight(0xffffff, 380, 18, 0.55, 0.6, 1.4)); spot.position.set(x - 1, 6.8, z + 2); spot.target = g
    return g
  }
  const manager = new THREE.LoadingManager()
  const ready = new Promise((res) => { manager.onLoad = res })
  manager.onProgress = (_, a, b) => onProgress?.(a / b)
  const loader = new THREE.TextureLoader(manager)
  const gltf = new GLTFLoader(manager)
  const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`); gltf.setDRACOLoader(draco)
  const models = Object.fromEntries(Object.entries(CAR_MODELS).map(([k, c]) => [k, gltf.loadAsync(c.url).then((g) => g.scene)]))
  // showroom: Corvette (WedAssist), Ferrari (ProductPulse AI), Alpine Vision (Snapchat); the garage car is the Tesla
  const BAY_CARS = [{ key: 'corvette' }, { key: 'ferrari' }, { key: 'alpine' }]
  const bays = BAY_Z.map((z, i) => {
    const table = turntable(BAY_X, z, 2.9, BAY_PAINT[i])
    const car = makeModelCar(BAY_CARS[i].key, glow, { models, paint: BAY_CARS[i].paint }); car.setLights(0.5); car.group.position.y = 0.1; table.add(car.group)
    const wallGroup = add(new THREE.Group()); wallGroup.position.set(BAY_X + 3.6, 3.3, z - 2.6); wallGroup.rotation.y = -0.62
    const screens = projectImages[i].map((url, k) => {
      const mat = new THREE.ShaderMaterial({ vertexShader: screenVert, fragmentShader: screenFrag, transparent: true, depthWrite: false, uniforms: { map: { value: null }, uAlpha: { value: k ? 0 : 1 } } })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); mesh.position.z = 0.08 + k * 0.004; mesh.renderOrder = 5 + k; wallGroup.add(mesh)
      const tex = loader.load(url, (t) => {
        const ia = t.image.width / t.image.height, h = ia < 1 ? 4.5 : 3.5
        mesh.scale.set(h * ia, h, 1)
        if (!k) wallGroup.add(new THREE.Mesh(new THREE.BoxGeometry(h * ia + 0.22, h + 0.22, 0.12), new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.4, metalness: 0.7 })))
      })
      tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; mat.uniforms.map.value = tex
      return mat
    })
    return { table, screens, cur: 0 }
  })

  // ---- the two hero cars
  const oldCar = makeModelCar('tesla', glow, { models }); add(oldCar.group)
  const stage = turntable(0, STAGE_Z, 3.5, 0x38e1c6)
  const NEW_CAR = new URLSearchParams(location.search).get('newcar') || 'mclaren'
  const newCar = makeModelCar(NEW_CAR, glow, { models }); add(newCar.group)
  const follow = add(new THREE.PointLight(0xffc27a, 0, 14, 2))

  // ---- dawn
  const sunMat = new THREE.SpriteMaterial({ map: glow, color: 0xffc48a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const sun = add(new THREE.Sprite(sunMat)); sun.position.set(0, 9, -690); sun.scale.set(420, 150, 1)
  const coreMat = sunMat.clone(); coreMat.color.set(0xfff0d0)
  const core = add(new THREE.Sprite(coreMat)); core.position.set(0, 10, -685); core.scale.setScalar(70)

  // ---- keyframes: every scene returns the same flat set of numbers so scenes can blend
  let portrait = false
  const base = { off: 0.2, ox: 0, oz: 0, or: 0, nz: STAGE_Z, lo: 1, ln: 0, sw: 1, door: 0 }
  const KEY = {
    hero: () => ({ ...base, px: 2.5, py: 1.05, pz: -6.6, lx: 0, ly: portrait ? 0.4 : 1.75, lz: 0, off: 0 }),
    about: (p) => {
      const q = ease(clamp01(p / 0.5)), z = -14 * ease(clamp01((p - 0.4) / 0.6))
      return { ...base, oz: z, px: mix(3.9, -2.3, q), py: mix(1.2, 1.5, q), pz: z + mix(-1.4, 6.2, q), lx: 0, ly: 0.9, lz: z - 3 * q }
    },
    career: (p) => {
      const z = mix(-14, ROAD_END, p)
      return { ...base, oz: z, px: -2.3 + Math.sin(p * 7) * 0.7, py: 1.5 + Math.sin(p * 5) * 0.25, pz: z + 6.6, lx: 0, ly: 1.0, lz: z - 4 }
    },
    bay: (i) => (p) => ({ ...base, ox: -2.6, oz: BAY_Z[i] + 2, px: 0.2 - p * 0.5, py: 1.6, pz: BAY_Z[i] + 7 - p, lx: BAY_X + 0.9, ly: 2.0, lz: BAY_Z[i] - 0.8 }),
    craft: (p) => {
      const a = 0.8 - 1.35 * ease(p), R = 6.8
      return { ...base, ox: -4.6, oz: STAGE_Z + 7, or: 0.4, px: Math.sin(a) * R, py: 1.25, pz: STAGE_Z + Math.cos(a) * R, lx: 0, ly: 0.8, lz: STAGE_Z,
        off: 0.22, lo: 1 - smooth(0, 0.3, p), ln: smooth(0.3, 0.65, p), sw: 1 - smooth(0.5, 0.95, p), door: smooth(0.65, 1, p) }
    },
    end: (p) => {
      const z = STAGE_Z - 95 * Math.pow(p, 1.6)
      return { ...base, ox: -4.6, oz: STAGE_Z + 7, or: 0.4, nz: z, px: -1.9, py: 1.1 + p * 1.5, pz: z + 6.6 + p * 2.5, lx: 0, ly: 0.9, lz: z - 3, off: 0.16, lo: 0, ln: 1, sw: 0, door: 1 }
    },
  }
  KEY.p0 = KEY.bay(0); KEY.p1 = KEY.bay(1); KEY.p2 = KEY.bay(2)
  const at = (s, y) => KEY[s.cam](s.end > s.start ? clamp01((y - s.start) / (s.end - s.start)) : 0)

  function layout() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight
    portrait = w / h < 1
    camera.aspect = w / h; camera.fov = portrait ? 58 : 40; camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }
  layout()

  const look = new THREE.Vector3(), mouse = { x: 0, y: 0, sx: 0, sy: 0 }
  let first = true, last = 0, kick = 0, off = 0

  function update({ y, sections, beats, velocity, time }) {
    let i = sections.findIndex((s) => y <= s.end); if (i < 0) i = sections.length - 1
    const s = sections[i]; if (!s) return
    let k
    if (y >= s.start || i === 0) k = at(s, y)
    else {
      const prev = sections[i - 1], A = KEY[prev.cam](1), B = KEY[s.cam](0)
      const t = ease(clamp01((y - prev.end) / Math.max(1, s.start - prev.end)))
      k = {}; for (const key in B) k[key] = mix(A[key], B[key], t)
    }
    const dt = Math.min(1, Math.max(0.001, time - last)); last = time
    const damp = (rate) => (first ? 1 : 1 - Math.exp(-dt * rate))
    const d = damp(5)
    mouse.sx += (mouse.x - mouse.sx) * damp(3); mouse.sy += (mouse.y - mouse.sy) * damp(3)

    // cars
    oldCar.group.position.set(k.ox, 0, k.oz); oldCar.group.rotation.y = k.or; oldCar.roll(); oldCar.setLights(k.lo)
    const idle = reduced ? 0 : Math.sin(time * 22) * 0.004 * k.lo
    oldCar.group.position.y = idle
    stage.rotation.y = (reduced ? 0.5 : 0.5 + Math.sin(time * 0.22) * 0.8) * k.sw
    newCar.group.position.set(0, k.nz > STAGE_Z - 0.01 ? 0.1 : mix(0.1, 0, clamp01((STAGE_Z - k.nz) / 3.6)), k.nz)
    newCar.group.rotation.y = stage.rotation.y; newCar.roll(); newCar.setLights(k.ln)
    shutter.scale.y = Math.max(0.001, 1 - k.door); shutter.position.y = 4.6 - (4.6 * shutter.scale.y) / 2
    for (const [bi, b] of bays.entries()) {
      if (!reduced) b.table.rotation.y = time * 0.16 + bi * 2
      b.cur += ((beats[bi] ?? 0) - b.cur) * d
      b.screens.forEach((m, n) => { m.uniforms.uAlpha.value = clamp01(1 - Math.abs(n - b.cur)) })
    }
    // passing street lamps wash over the car while it is on the road
    const onRoad = smooth(-6, -12, k.oz) * (1 - smooth(ROAD_END, HALL[0], k.oz))
    follow.position.set(k.ox, 3.2, k.oz - 0.5); follow.intensity = onRoad * (8 + 26 * Math.pow(Math.max(0, Math.cos(((k.oz + 12) / 16) * Math.PI * 2)), 3))

    // camera
    const tx = k.px + mouse.sx * 0.3, ty = k.py - mouse.sy * 0.12
    camera.position.x += (tx - camera.position.x) * d; camera.position.y += (ty - camera.position.y) * d; camera.position.z += (k.pz - camera.position.z) * d
    const ly = portrait && k.off ? k.ly - 2.3 : k.ly
    if (first) look.set(k.lx, ly, k.lz); else look.lerp(new THREE.Vector3(k.lx, ly, k.lz), d)
    camera.lookAt(look)
    if (!reduced) camera.rotation.z += Math.sin(time * 0.3) * 0.003
    off += ((portrait ? 0 : k.off) - off) * d
    kick += (Math.min(9, Math.abs(velocity) * 0.11) - kick) * damp(5)
    camera.filmOffset = -off * camera.getFilmWidth()
    camera.fov = (portrait ? 58 : 40) + (reduced ? 0 : kick); camera.updateProjectionMatrix()

    // night turns to dawn once the shutter opens
    const dawn = smooth(0.2, 1, k.door) * smooth(STAGE_Z + 8, STAGE_Z - 20, camera.position.z) * 0.999
    scene.background.lerpColors(NIGHT, DAWN, dawn); scene.fog.color.copy(scene.background)
    sunMat.opacity = k.door * 0.9; coreMat.opacity = k.door
    garageLight.visible = camera.position.z > -40
    floor.visible = camera.position.z < HALL[0] + 40
    first = false
    renderer.render(scene, camera)
  }

  addEventListener('pointermove', (e) => { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1 })
  return { update, layout, ready }
}
