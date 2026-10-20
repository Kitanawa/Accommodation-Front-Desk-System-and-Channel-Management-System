import { spawn } from 'node:child_process'
import { loadEnv } from 'vite'
const demo=loadEnv('development',process.cwd(),'VITE_').VITE_DEMO_AUTH==='true'
const commands=[...(demo?[]:[['server/start.js']]),['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']]
if(demo)console.log('Frontend demo authentication enabled. No authentication backend is required.')
const children=commands.map(args=>spawn(process.execPath,args,{stdio:'inherit'}))
let stopping=false
function stop(code=0){if(stopping)return;stopping=true;children.forEach(child=>child.kill());process.exitCode=code}
children.forEach(child=>{child.on('error',()=>stop(1));child.on('exit',code=>stop(code||0))})
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop())
