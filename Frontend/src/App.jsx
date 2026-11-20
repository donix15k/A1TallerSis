import { useCallback, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Splash from './components/Splash.jsx'
import AdminNavbar from './components/AdminNavbar.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import Cajeros from './pages/Cajeros.jsx'
import Pagos from './pages/Pagos.jsx'
import Clientes from './pages/Clientes.jsx'
import Facturas from './pages/Facturas.jsx'
import TableroIngresos from './pages/TableroIngresos.jsx'
import CierreCaja from './pages/CierreCaja.jsx'
import VerificarFactura from './pages/VerificarFactura.jsx'
import { useAuth } from './context/AuthContext.jsx'
import { useAdminAuth } from './context/AdminAuthContext.jsx'
import CierreDiario from './pages/CierreDiario.jsx'
import HistorialOperaciones from './pages/HistorialOperaciones.jsx'
import MetasVenta from './pages/MetasVenta.jsx'
import HorasPico from './pages/HorasPico.jsx'
import ComparativoMensual from './pages/ComparativoMensual.jsx'
import Supervisores from './pages/Supervisores.jsx'
import ProductosVendidos from './pages/ProductosVendidos.jsx'
import DiferenciasCaja from './pages/DiferenciasCaja.jsx'
import VentasOnline from './pages/VentasOnline.jsx'
import LibroVentas from './pages/LibroVentas.jsx'
import Usuarios from './pages/Usuarios.jsx'
import PubSubVerificacion from './pages/PubSubVerificacion.jsx'
import Devoluciones from './pages/Devoluciones.jsx'
import './App.css'

// Pantallas de lista: solo se desplaza la tabla (menu, titulo, filtros y buscador quedan fijos).
const RUTAS_DE_LISTA = [
  '/facturas',
  '/admin/ventas-online',
  '/admin/libro-ventas',
  '/admin/diferencias',
  '/admin/productos-vendidos',
  '/admin/cajeros',
  '/admin/supervisores',
  '/admin/usuarios',
]

function RutaProtegida({ children }) {
  const { cajero } = useAuth()
  return cajero ? children : <Navigate to="/login" replace />
}

function RutaProtegidaAdmin({ children }) {
  const { administrador } = useAdminAuth()
  return administrador ? children : <Navigate to="/login" replace />
}

function App() {
  const { pathname } = useLocation()
  const esPantallaLogin = pathname === '/login'
  const esSeccionAdmin = pathname.startsWith('/admin')
  // TDSI-38: pagina publica (sin login) a la que lleva el QR de la factura.
  const esPaginaPublica = pathname.startsWith('/facturas/verificar/')
  // Pantallas donde solo la tabla se desplaza (menu y filtros quedan fijos): ver .vx-app--fija.
  const esPantallaFija = RUTAS_DE_LISTA.includes(pathname)

  // Pantalla de bienvenida de Vortrix: una vez al abrir la pagina, salvo en la pagina
  // publica del QR (un cliente que escanea una factura no debe esperar una animacion).
  const [mostrarSplash, setMostrarSplash] = useState(() => !pathname.startsWith('/facturas/verificar/'))
  const terminarSplash = useCallback(() => setMostrarSplash(false), [])

  return (
    <div className={`vx-app${esPantallaFija ? ' vx-app--fija' : ''}`}>
      {mostrarSplash && <Splash onTerminada={terminarSplash} />}
      {!esPantallaLogin && !esPaginaPublica && (esSeccionAdmin ? <AdminNavbar /> : <Navbar />)}
      <div className="vx-scroll">
      <main className={esPantallaLogin || esPaginaPublica ? undefined : esSeccionAdmin || esPantallaFija ? 'container container-ancho' : 'container'}>
        {/* key por ruta: cada pantalla entra con un fundido corto al navegar */}
        <div className="vx-pagina" key={pathname}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/facturas/verificar/:token" element={<VerificarFactura />} />

          {/* Rutas del cajero */}
          <Route path="/" element={<RutaProtegida><Home /></RutaProtegida>} />
          <Route path="/pagos" element={<RutaProtegida><Pagos /></RutaProtegida>} />
          <Route path="/facturas" element={<RutaProtegida><Facturas /></RutaProtegida>} />
          <Route path="/cierre-caja" element={<RutaProtegida><CierreCaja /></RutaProtegida>} />
          <Route path="/devoluciones" element={<RutaProtegida><Devoluciones /></RutaProtegida>} />

          {/* Panel de Administración */}
          <Route path="/admin/cajeros" element={<RutaProtegidaAdmin><Cajeros /></RutaProtegidaAdmin>} />
          <Route path="/admin/clientes" element={<RutaProtegidaAdmin><Clientes /></RutaProtegidaAdmin>} />
          <Route path="/admin/tablero" element={<RutaProtegidaAdmin><TableroIngresos /></RutaProtegidaAdmin>} />
          <Route path="/admin/cierre-diario" element={<RutaProtegidaAdmin><CierreDiario /></RutaProtegidaAdmin>} />
          <Route path="/admin/historial-operaciones" element={<RutaProtegidaAdmin><HistorialOperaciones /></RutaProtegidaAdmin>} />
          <Route path="/admin/metas-venta" element={<RutaProtegidaAdmin><MetasVenta /></RutaProtegidaAdmin>} />
          <Route path="/admin/horas-pico" element={<RutaProtegidaAdmin><HorasPico /></RutaProtegidaAdmin>} />
          <Route path="/admin/comparativo-mensual" element={<RutaProtegidaAdmin><ComparativoMensual /></RutaProtegidaAdmin>} />
          <Route path="/admin/supervisores" element={<RutaProtegidaAdmin><Supervisores /></RutaProtegidaAdmin>} />
          <Route path="/admin/productos-vendidos" element={<RutaProtegidaAdmin><ProductosVendidos /></RutaProtegidaAdmin>} />
          <Route path="/admin/diferencias" element={<RutaProtegidaAdmin><DiferenciasCaja /></RutaProtegidaAdmin>} />
          <Route path="/admin/ventas-online" element={<RutaProtegidaAdmin><VentasOnline /></RutaProtegidaAdmin>} />
          <Route path="/admin/libro-ventas" element={<RutaProtegidaAdmin><LibroVentas /></RutaProtegidaAdmin>} />
          <Route path="/admin/usuarios" element={<RutaProtegidaAdmin><Usuarios /></RutaProtegidaAdmin>} />
          <Route path="/admin/pubsub-verificacion" element={<RutaProtegidaAdmin><PubSubVerificacion /></RutaProtegidaAdmin>} />
        </Routes>
        </div>
      </main>
      </div>
    </div>
  )
}

export default App
