// Purpose: Application entry point: mounts React and places the workspace behind AuthGate so the current user and sign-out action reach App.
import AuthGate from './AuthGate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>{(user,onSignOut,onUserUpdate)=><App user={user} onSignOut={onSignOut} onUserUpdate={onUserUpdate}/>}</AuthGate>
  </StrictMode>,
)
