import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import JiraAgent from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <JiraAgent />
  </StrictMode>,
)
