import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// StrictMode disabled to prevent double-rendering of Three.js canvas
createRoot(document.getElementById('root')).render(<App />)
