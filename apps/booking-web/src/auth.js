import {API_URL,LIVE} from './liveApi.js'
const ACCOUNTS='demo-hotel-accounts',SESSION='demo-hotel-session'
export function readAccounts(){try{const value=JSON.parse(localStorage.getItem(ACCOUNTS)||'[]');return Array.isArray(value)?value:[]}catch{return []}}
const encode=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('')
const decode=hex=>new Uint8Array(hex.match(/.{2}/g).map(n=>parseInt(n,16)))
async function digest(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return encode(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode(salt),iterations:100000,hash:'SHA-256'},key,256)))}
const publicUser=account=>({id:account.id,name:account.name,email:account.email,phone:account.phone})
function session(account){sessionStorage.setItem(SESSION,JSON.stringify({id:account.id,expires:Date.now()+8*3600000}));return publicUser(account)}
export function currentUser(){if(LIVE)return readLive()?.user||null;try{const token=JSON.parse(sessionStorage.getItem(SESSION)||'null');if(!token||token.expires<Date.now()){sessionStorage.removeItem(SESSION);return null}const account=readAccounts().find(a=>a.id===token.id);return account?publicUser(account):null}catch{return null}}
export function signOut(){if(LIVE){const s=readLive();sessionStorage.removeItem(LIVE_SESSION);if(s)accountCall('POST','/api/public/account/logout',{},s.token).catch(()=>{});return}sessionStorage.removeItem(SESSION)}
export async function register(input){if(LIVE)return registerLive(input);const name=input.name.trim(),email=input.email.trim().toLowerCase();if(!name||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Enter your name and a valid email address.');if(input.password.length<10)throw new Error('Use at least 10 characters for your password.');if(input.password!==input.confirmPassword)throw new Error('The passwords do not match.');const accounts=readAccounts();if(accounts.some(a=>a.email===email))throw new Error('An account already exists for this email. Please sign in.');const salt=encode(crypto.getRandomValues(new Uint8Array(16)));const account={id:crypto.randomUUID(),name,email,phone:input.phone.trim(),salt,passwordHash:await digest(input.password,salt)};const latest=readAccounts();if(latest.some(a=>a.email===email))throw new Error('An account already exists for this email.');localStorage.setItem(ACCOUNTS,JSON.stringify([...latest,account]));return session(account)}
export async function signIn(email,password){if(LIVE)return signInLive(email,password);const account=readAccounts().find(a=>a.email===email.trim().toLowerCase());if(!account||await digest(password,account.salt)!==account.passwordHash)throw new Error('Email or password is incorrect.');return session(account)}

// ---- Live mode (VITE_API_URL set): accounts are kept in the hotel database through /api/public/account. ----
// The session token is kept in sessionStorage for this tab only; the server stores just its hash and can end it.
const LIVE_SESSION='demo-hotel-live-session'
const liveUser=a=>({id:a.account_id,name:a.full_name,email:a.email,phone:a.phone||''})
function readLive(){try{const s=JSON.parse(sessionStorage.getItem(LIVE_SESSION)||'null');if(!s||Date.parse(s.expires_at)<Date.now()){sessionStorage.removeItem(LIVE_SESSION);return null}return s}catch{return null}}
function keepLive(out){const user=liveUser(out.account);sessionStorage.setItem(LIVE_SESSION,JSON.stringify({token:out.token,expires_at:out.expires_at,user}));return user}
async function accountCall(method,path,body,token){
  let r;try{r=await fetch(API_URL+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body==null?undefined:JSON.stringify(body)})}catch{throw new Error('Cannot reach the hotel system. Please try again in a moment.')}
  let j=null;try{j=await r.json()}catch{}
  if(!r.ok){const fields=(j?.error?.fields||[]).map(f=>f.message);const e=new Error(fields.length?[...new Set(fields)].join(' '):(j?.error?.message||'Request failed ('+r.status+').'));e.status=r.status;throw e}
  return j
}
export const authToken=()=>LIVE?readLive()?.token||null:null
async function registerLive(input){const name=input.name.trim(),email=input.email.trim().toLowerCase();if(!name||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Enter your name and a valid email address.');if(input.password!==input.confirmPassword)throw new Error('The passwords do not match.');return keepLive(await accountCall('POST','/api/public/account/register',{full_name:name,email,phone:input.phone.trim()||undefined,password:input.password}))}
async function signInLive(email,password){try{return keepLive(await accountCall('POST','/api/public/account/login',{email:email.trim(),password}))}catch(e){if(e.status===401)throw new Error('Email or password is incorrect.');throw e}}
// Check the saved session with the server (it may have ended). Returns the user, or null after signing out.
export async function verifySession(){const s=readLive();if(!s)return null;try{return keepLive({...s,account:await accountCall('GET','/api/public/account',null,s.token)})}catch(e){if(e.status===401){sessionStorage.removeItem(LIVE_SESSION);return null}return s.user}}
// Bookings started while signed in, from the hotel database, in the shape the account page shows.
export async function myLiveBookings(){const s=readLive();if(!s)return [];const rows=await accountCall('GET','/api/public/account/bookings',null,s.token);
  return rows.map(b=>{const nights=Math.max(1,Math.round((Date.parse(b.check_out)-Date.parse(b.check_in))/86400000));const cancelled=b.reservation_status==='CANCELLED';
    return {id:b.reservation_ref||'PENDING-'+b.attempt_id.slice(0,8).toUpperCase(),roomName:b.room_type,start:b.check_in,end:b.check_out,guests:b.total_guests,nights,total:b.total,guest:{name:s.user.name,email:s.user.email,phone:s.user.phone},
      paymentStatus:cancelled?'Cancelled':b.status==='CONFIRMED'?'Paid online':b.status==='PAID_UNFULFILLED'?'Paid, the hotel will contact you':'Payment pending',source:'Direct website'}})}
