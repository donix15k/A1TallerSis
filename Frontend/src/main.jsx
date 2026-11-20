import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { AdminAuthProvider } from './context/AdminAuthContext.jsx'
import { BloqueoProvider } from './context/BloqueoContext.jsx'
import { ToastProvider } from './components/ui/Toasts.jsx'
import './index.css'
import './styles/vortrix.css'
import './styles/premium.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AdminAuthProvider>
          <BloqueoProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BloqueoProvider>
        </AdminAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
