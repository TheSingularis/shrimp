import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PluginProvider } from './plugins/context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PluginProvider>
      <App />
    </PluginProvider>
  </StrictMode>,
)
