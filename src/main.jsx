import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// The Firebase-provided domains keep serving after the custom-domain switch;
// bounce visitors (and previously sent invite/review links) to the canonical
// domain so candidates see one address and search engines index one site.
const CANONICAL_HOST = 'insightedgehq.com'
const { hostname, pathname, search, hash } = window.location
if (hostname.endsWith('.web.app') || hostname.endsWith('.firebaseapp.com')) {
  window.location.replace(`https://${CANONICAL_HOST}${pathname}${search}${hash}`)
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
