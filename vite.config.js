import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
const proxy={'/api':{target:`http://127.0.0.1:${process.env.AUTH_PORT||3001}`,changeOrigin:true}}
export default defineConfig({plugins:[react()],server:{proxy},preview:{proxy}})
