import Profile from './Profile'
import { deleteGuestProfile } from './adminRules'
import StaffManagement from './StaffManagement'
import { api, roleLabels, demoMode } from './authApi'
import { useEffect, useRef, useState, useTransition } from 'react'
import './App.css'
import Operations from './Operations'
import Billing from './Billing'
import Guests from './Guests'
import Reports from './Reports'
import Settings from './Settings'
import { normalizeRooms } from './roomManagementRules'
import AssistantPopup from './ai/AssistantPopup'
import { clearChat } from './ai/chatStorage'
import { detectDatabase } from './dbData'
import { loadState, commitBookings, commitCleaning, commitRooms, commitGuests, deleteGuest, settingsBody } from './serverStore'

const initialRooms = [
  { id: 'def', name: 'President DEF', rate: 250, stock: 4, guests: 2, note: 'Breakfast included' },
  { id: 'abc', name: 'President ABC', rate: 50, stock: 4, guests: 3, note: 'Breakfast ×2' },
  { id: 'twin', name: 'Superior Twin Single', rate: 148, stock: 6, guests: 3, note: 'Room only' },
  { id: 'queen', name: 'Deluxe Queen', rate: 148, stock: 3, guests: 2, note: 'Breakfast' },
  { id: 'deluxe', name: 'Deluxe ABC', rate: 2198, stock: 2, guests: 2, note: 'No deposit' },
  { id: 'king', name: 'Deluxe King Room 2', rate: 0, stock: 0, guests: 4, note: 'Breakfast ×2' },
  { id: 'triple', name: 'Deluxe Triple Single', rate: 188, stock: 5, guests: 3, note: 'Room only' },
]
const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const parse = value => { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d,12) }
const add = (date,n) => new Date(date.getFullYear(),date.getMonth(),date.getDate()+n,12)
const pretty = date => date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
const money = amount => new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(amount)
function loadBookings() { try { return JSON.parse(localStorage.getItem('miri-bookings') || '[]') } catch { return [] } }

const defaultSettings={propertyName:'Demo Hotel Miri',city:'Miri',staffName:'Front Desk Staff',arrivalTime:'14:00',contactEmail:'',contactPhone:'',logoDataUrl:''}
function loadLocal(name,fallback){try{const value=JSON.parse(localStorage.getItem(name));return value ?? fallback}catch{return fallback}}
export default function App({user,onSignOut,onUserUpdate}) {
 const [mobileNav,setMobileNav]=useState(()=>window.matchMedia('(max-width: 800px)').matches)
 const [sidebarOpen,setSidebarOpen]=useState(false)
 const menuToggle=useRef(null),sidebarRef=useRef(null)
 useEffect(()=>{const media=window.matchMedia('(max-width: 800px)');const change=()=>{setMobileNav(media.matches);setSidebarOpen(false)};media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 useEffect(()=>{if(!sidebarOpen)return;const previous=document.activeElement;const oldOverflow=document.body.style.overflow;if(mobileNav){document.body.style.overflow='hidden';sidebarRef.current?.querySelector('button')?.focus()}const key=e=>{if(e.key==='Escape'){setSidebarOpen(false);menuToggle.current?.focus()}if(mobileNav&&e.key==='Tab'){const buttons=sidebarRef.current?.querySelectorAll('button');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(mobileNav){document.body.style.overflow=oldOverflow;previous?.focus()}}},[sidebarOpen,mobileNav])
 const canManageStaff=['admin','manager'].includes(user.role)
 const [rooms,setRooms]=useState(()=>normalizeRooms(loadLocal('miri-rooms',initialRooms)))
 const [cleaning,setCleaning]=useState(()=>loadLocal('miri-cleaning',{}))

 const [settings,setSettings]=useState(()=>({...defaultSettings,...loadLocal('miri-settings',{})}))
 const [profiles,setProfiles]=useState(()=>loadLocal('miri-guests',[]))
 function deleteProfile(id){try{const next=deleteGuestProfile(user.role,id,profiles,bookings);if(dbMode){setProfiles(next);deleteGuest(api,id).then(refreshServer).catch(async error=>{setNotice(error.message);try{await refreshServer()}catch{setProfiles(profiles)}})}else if(!saveLocal('miri-guests',next,setProfiles))return false;return true}catch(error){setNotice(error.message);return false}}
 function saveLocal(name,value,setValue){try{localStorage.setItem(name,JSON.stringify(value));setValue(value);return true}catch{return false}}

  const [today] = useState(() => parse(key(new Date())))
  const [bookings,setBookings] = useState(loadBookings)
  const [activePage,setPageState] = useState('Dashboard')
  const page=activePage==='Inventory'?'Settings':activePage
  const [pagePending,startPageTransition]=useTransition()
  function setPage(next){setSidebarOpen(false);startPageTransition(()=>setPageState(next))}
  const [notice,setNotice] = useState('')
  const [dbMode,setDbMode] = useState(false)
  // a request to open the new-booking panel on the Stay View dashboard: {from, to, roomType, guest, id}
  const [stayRequest,setStayRequest] = useState(null)
  function newBooking(request={}){setStayRequest({...request,id:Date.now()});setPage('Dashboard')}
  useEffect(()=>{let off=false;detectDatabase(demoMode).then(found=>{if(!off)setDbMode(found)});return()=>{off=true}},[])
  // Server mode: rooms, reservations, folios, housekeeping and settings come from the API (GET /api/frontdesk/state)
  const refreshServer=async()=>{const s=await loadState(api);setRooms(normalizeRooms(s.rooms));setBookings(s.bookings);setCleaning(s.cleaning||{});setProfiles(s.profiles||[]);setSettings(cur=>({...cur,...s.settings}))}
  useEffect(()=>{if(!dbMode)return;let off=false;loadState(api).then(s=>{if(off)return;setRooms(normalizeRooms(s.rooms));setBookings(s.bookings);setCleaning(s.cleaning||{});setProfiles(s.profiles||[]);setSettings(cur=>({...cur,...s.settings}))}).catch(error=>{if(!off)setNotice(error.message)});return()=>{off=true}},[dbMode])
  // every screen saves reservations through this one function; in server mode each change becomes the matching API call
  function updateBookingsAny(next){
    if(!dbMode){try{localStorage.setItem('miri-bookings',JSON.stringify(next));setBookings(next);return true}catch{setNotice('Unable to save changes in this browser.');return false}}
    const prev=bookings;setBookings(next)
    commitBookings(api,prev,next,rooms).then(refreshServer).catch(async error=>{setNotice(error.message);try{await refreshServer()}catch{setBookings(prev)}})
    return true
  }
  // housekeeping edits: compare old and new, call the API, then reload what the server now says
  function saveCleaningAny(next){const prev=cleaning;setCleaning(next);return commitCleaning(api,prev,next,rooms).then(refreshServer).catch(async error=>{try{await refreshServer()}catch{setCleaning(prev)}throw error})}
  // room types, physical rooms, prices and approvals: shown at once, saved through the API, then reloaded so the screens show what the server holds
  function saveRoomsAny(next){if(!dbMode)return saveLocal('miri-rooms',next,setRooms);const prev=rooms;setRooms(next);commitRooms(api,prev,next).then(()=>{setNotice('');return refreshServer()}).catch(async error=>{setNotice(error.message);try{await refreshServer()}catch{setRooms(prev)}});return true}
  function saveGuestsAny(next){if(!dbMode)return saveLocal('miri-guests',next,setProfiles);const prev=profiles;setProfiles(next);commitGuests(api,prev,next).then(refreshServer).catch(async error=>{setNotice(error.message);try{await refreshServer()}catch{setProfiles(prev)}});return true}
  function saveSettingsAny(next){if(!dbMode)return saveLocal('miri-settings',next,setSettings);const prev=settings;setSettings(next);try{localStorage.setItem('miri-settings',JSON.stringify({staffName:next.staffName}))}catch{/* the demo staff name only */}api('/api/settings',{method:'PATCH',body:JSON.stringify(settingsBody(next))}).then(refreshServer).catch(async error=>{setNotice(error.message);try{await refreshServer()}catch{setSettings(prev)}});return true}
  function handleAssistantAction(action){
    if(action?.type!=='select_stay'||!action.from||!action.to)return
    const type=action.room_type?rooms.find(r=>r.name===action.room_type):null
    newBooking({from:action.from,to:action.to,roomType:type?.id})
  }
  return <div className={`app ${sidebarOpen?'nav-open':'nav-closed'}`}>
    {mobileNav&&sidebarOpen&&<button className="nav-backdrop" tabIndex={-1} aria-hidden="true" onClick={()=>setSidebarOpen(false)}/>}<aside id="fds-navigation" ref={sidebarRef} className="sidebar" role={mobileNav&&sidebarOpen?'dialog':undefined} aria-modal={mobileNav&&sidebarOpen?true:undefined} aria-label="Main menu">{mobileNav&&<button className="nav-close" aria-label="Close menu" onClick={()=>setSidebarOpen(false)}>×</button>}<div className="brand">{settings.logoDataUrl?<img className="sidebar-logo" src={settings.logoDataUrl} alt={`${settings.propertyName} logo`}/>:<span className="brand-icon">M</span>}<div>MIRI<span>PROPERTY OPERATIONS</span></div></div><nav>{['Dashboard','Reservations','Room Planner','Housekeeping','Folio & Billing','Guests','Reports','Settings','Staff','Profile'].filter(item=>item!=='Staff'||canManageStaff).map((item,i)=><button key={item} className={page===item?'active':''} onClick={()=>setPage(item)}><span>{['◫','▤','▦','◇','¤','◎','▥','⚙','▤','◎'][i]}</span>{item}</button>)}</nav><div className="hotel"><strong>{settings.propertyName}</strong><span>Front desk workspace</span><div className="online">● Staff online</div></div></aside>
    <div className="workspace" inert={mobileNav&&sidebarOpen?true:undefined}>{pagePending&&<div className="navigation-progress" role="status"><span className="sr-only">Opening page…</span></div>}<header><div className="header-leading"><button ref={menuToggle} className="menu-toggle" aria-label={sidebarOpen?'Collapse menu':'Expand menu'} aria-expanded={sidebarOpen} aria-controls="fds-navigation" onClick={()=>setSidebarOpen(open=>!open)}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div><span className="eyebrow">FRONT DESK / RESERVATIONS</span><h1>{page}</h1></div></div><div className="staff"><span className="avatar">FD</span><div><strong>{user.name}</strong><small>{roleLabels[user.role]}{demoMode?' (Demo)':''} · {settings.propertyName}</small><button className="sign-out"    onClick={()=>{clearChat(localStorage);onSignOut().catch(error=>setNotice(error.message))}}>Sign Out</button></div></div></header>
    <main key={page} className="page-content" aria-busy={pagePending}>{notice && <div className="notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notification">×</button></div>}
    {page==='Staff'? <StaffManagement user={user} onUserUpdate={onUserUpdate}/> : page==='Guests'? <Guests user={user} onDelete={deleteProfile} bookings={bookings} rooms={rooms} profiles={profiles} onSave={saveGuestsAny} onNewBooking={profile=>{const {stays:_stays,id:_id,...details}=profile;newBooking({guest:details})}} /> : page==='Reports'? <Reports bookings={bookings} rooms={rooms} today={key(today)} money={money}/> : page==='Settings'? <Settings user={user} onRoomsSave={saveRoomsAny} today={key(today)} settings={settings} onSave={next=>{if(!['admin','manager'].includes(user.role)&&(next.logoDataUrl||'')!==(settings.logoDataUrl||''))return false;return saveSettingsAny(next)}} rooms={rooms} bookings={bookings} onNavigate={setPage}/> : page==='Folio & Billing'? <Billing rooms={rooms} property={settings} bookings={bookings} money={money} updateBookings={updateBookingsAny} /> : ['Dashboard','Reservations','Room Planner','Housekeeping'].includes(page) ? <Operations user={user} serverCleaning={dbMode?cleaning:undefined} onCleaning={dbMode?saveCleaningAny:undefined} onRoomsSave={saveRoomsAny} property={settings} key={page} page={page} bookings={bookings} rooms={rooms} today={today} dateKey={key} add={add} parse={parse} pretty={pretty} money={money} updateBookings={updateBookingsAny} newBooking={newBooking} stayRequest={stayRequest} />:
    <Profile user={user} property={settings} onNavigate={setPage}/>}
    <footer>{dbMode?'Reservations are saved to the database':'Demo workspace · Sample room rates · Reservations saved in this browser only'}</footer></main></div>
    <AssistantPopup user={user} roomTypes={rooms.filter(r=>!r.publication||r.publication==='Published').map(r=>r.name)} onAction={handleAssistantAction}/>
  </div>
}






