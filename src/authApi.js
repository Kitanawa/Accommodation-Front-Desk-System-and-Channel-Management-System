// Purpose: Authentication API adapter: selects browser-only demo handling or real HTTP requests. Frontend permissions still require independent server enforcement.
import { createDemoApi } from './demoAuth'
export const demoMode=import.meta.env.VITE_DEMO_AUTH==='true'
const demoApi=createDemoApi({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)})
export const roleLabels={admin:'Admin',manager:'Manager',front_desk:'Front Desk Staff'}
// Dispatch demo requests locally or fetch JSON with cookies, a 15-second timeout and readable failure messages.
export async function api(path,options={}){
 options.signal?.throwIfAborted()
 if(demoMode)return demoApi(path,options)
 let response
 try{response=await fetch(path,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),credentials:'same-origin',headers:{'Content-Type':'application/json','X-App-Request':'1',...options.headers}})}catch(error){if(error.name==='AbortError')throw error;if(error.name==='TimeoutError')throw new Error('The request timed out. Please try again.');throw new Error('Unable to reach the server. Check the connection and try again.')}
 const body=await response.json().catch(()=>({error:'Authentication server is unavailable. Restart npm run dev.'}))
 if(!response.ok){const error=new Error(body.error||'Request failed.');error.status=response.status;throw error}
 return body
}
