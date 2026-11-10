// Live connection to the FDS API. Used only when EXPO_PUBLIC_API_URL is set; otherwise the app keeps its local demo data.
import * as SecureStore from 'expo-secure-store'
import {Platform} from 'react-native'
import {mapApproval} from './liveMap'
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '')
export const LIVE = !!API_URL
const KEY = 'demo-manager-api-token'
let token = null
async function call(method, path, body) {
  let r
  try { r = await fetch(API_URL + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: body == null ? undefined : JSON.stringify(body)}) }
  catch { throw new Error('Cannot reach the server. Check that it is running and the address is right.') }
  let j = null; try { j = await r.json() } catch {}
  if (!r.ok) { const e = new Error(j?.error?.message || 'Request failed (' + r.status + ').'); e.status = r.status; e.code = j?.error?.code; throw e }
  return j
}
export async function loadToken() {
  try { token = Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY) } catch { token = null }
  return !!token
}
export async function apiLogin(email, password) {
  const j = await call('POST', '/api/login', {email: email.trim(), password})
  token = j.token
  try { if (Platform.OS === 'web') globalThis.sessionStorage.setItem(KEY, token); else await SecureStore.setItemAsync(KEY, token) } catch {}
}
export async function apiLogout() {
  try { await call('POST', '/api/logout') } catch {}
  token = null
  try { if (Platform.OS === 'web') globalThis.sessionStorage.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY) } catch {}
}
export async function fetchRequests() {
  const out = []
  for (const st of ['PENDING', 'APPROVED', 'REJECTED']) out.push(...await call('GET', '/api/approvals?status=' + st + '&limit=100'))
  return out.map(mapApproval)
}
export async function apiDecide(request, action, remark) {
  const body = action === 'approve' ? {revision: request.revision} : {revision: request.revision, reason: remark.trim()}
  return call('POST', `/api/approvals/${request.apiKind}/${request.apiId}/${action}`, body)
}
