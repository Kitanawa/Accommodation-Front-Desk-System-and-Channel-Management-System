import { createDemoApi } from './demoAuth'
// Data mode: 'local' keeps accounts and data in this browser, 'database' signs in through the API (PostgreSQL).
// The login page switch saves the choice here; without a saved choice the VITE_DEMO_AUTH setting decides.
const MODE_KEY='miri-data-mode'
function savedMode(){try{const value=localStorage.getItem(MODE_KEY);return value==='local'||value==='database'?value:null}catch{return null}}
export const dataMode=savedMode()||(import.meta.env.VITE_DEMO_AUTH==='true'?'local':'database')
export const demoMode=dataMode==='local'
export function switchDataMode(next){if(next===dataMode)return;try{localStorage.setItem(MODE_KEY,next)}catch{/* Storage unavailable. */}window.location.reload()}
const demoApi=createDemoApi({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)})
export const roleLabels={admin:'Admin',manager:'Manager',front_desk:'Front Desk Staff'}
export async function api(path,options={}){
 options.signal?.throwIfAborted()
 if(demoMode)return demoApi(path,options)
 let response
 try{response=await fetch(path,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),credentials:'same-origin',headers:{'Content-Type':'application/json','X-App-Request':'1',...options.headers}})}catch(error){if(error.name==='AbortError')throw error;if(error.name==='TimeoutError')throw new Error('The request timed out. Please try again.');throw new Error('Unable to reach the server. Check the connection and try again.')}
 const body=await response.json().catch(()=>({error:'Authentication API is unavailable. Start the backend separately, or enable VITE_DEMO_AUTH=true in apps/fds-web/.env.local and restart the frontend.'}))
 if(!response.ok){const error=new Error((typeof body.error==='string'?body.error:(body.error?.fields?.[0]?.message||body.error?.message))||'Request failed.');error.status=response.status;throw error}
 return body
}
