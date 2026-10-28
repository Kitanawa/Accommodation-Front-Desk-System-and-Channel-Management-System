import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
const proxy={'/api/ai':{target:process.env.AI_PROXY_TARGET||'http://127.0.0.1:3002',changeOrigin:true},'/api':{target:process.env.API_PROXY_TARGET||'http://127.0.0.1:3001',changeOrigin:true}}
export default defineConfig({plugins:[react()],server:{proxy},preview:{proxy}})
