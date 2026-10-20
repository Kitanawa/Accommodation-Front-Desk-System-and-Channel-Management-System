// Compatibility launcher; npm run dev delegates directly to the FDS workspace.
import {spawn} from 'node:child_process'
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5176','--strictPort'],{stdio:'inherit'})
child.on('error',error=>{console.error(error.message);process.exitCode=1})
child.on('exit',code=>{process.exitCode=code||0})
process.on('SIGINT',()=>child.kill())
process.on('SIGTERM',()=>child.kill())
