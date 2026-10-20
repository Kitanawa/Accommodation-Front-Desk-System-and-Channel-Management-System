import { spawn } from 'node:child_process'
console.log('Starting React frontend. Copy .env.example to .env.local for demo login.')
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code || 0 })
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
