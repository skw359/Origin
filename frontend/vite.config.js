import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.API_URL || 'http://localhost:3007'
const API_PATHS = ['/city', '/place', '/building', '/road', '/lookup', '/cities', '/health', '/console', '/admin']

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      ...Object.fromEntries(API_PATHS.map(p => [p, API])),
      '/ws': { target: API, ws: true },
    },
  },
})
