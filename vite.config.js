import { defineConfig } from 'vite'

// Two portfolios live side by side:
//   /          the film-reel version (index.html, src/main.js, src/scene.js, src/style.css)
//   /car.html  the car-film version  (car.html, src/car/*)
//
// Deployed to GitHub Pages as a project site, so every asset is served from
// /product-designer-portfolio/... rather than the domain root.
export default defineConfig({
  base: '/product-designer-portfolio/',
  build: { rollupOptions: { input: { main: 'index.html', car: 'car.html' } } },
})
