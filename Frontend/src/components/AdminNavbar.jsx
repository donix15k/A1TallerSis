import { NavLink, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import AdminNavDropdown from './AdminNavDropdown.jsx'
import Marca from './Marca.jsx'

// TDSI-62 y otras pantallas fueron sumando enlaces sueltos hasta 14: se agrupan aqui
// en 6 botones (3 directos + 3 desplegables) sin sacar ninguna pantalla del menu.
const GESTION_ROLES_Y_CLIENTES = [
  { to: '/admin/cajeros', etiqueta: 'Cajeros' },
  { to: '/admin/usuarios', etiqueta: 'Usuarios y accesos' }, // cajeros, supervisores y administradores
  { to: '/admin/clientes', etiqueta: 'Clientes' },
]

const REPORTES = [
  { to: '/admin/comparativo-mensual', etiqueta: 'Comparativo mensual' },
  { to: '/admin/horas-pico', etiqueta: 'Horas pico' },
  { to: '/admin/metas-venta', etiqueta: 'Metas de venta' },
  { to: '/admin/libro-ventas', etiqueta: 'Libro de Ventas' },
]

// Las 3 integraciones por Pub/Sub con los otros grupos del proyecto (Marketplace,
// Compras, Contabilidad), cada una identificada por el sistema externo al que llama.
const INTEGRACIONES = [
  { to: '/admin/monitor-integraciones', etiqueta: 'Monitor de integraciones' }, // TDSI-130
  { to: '/admin/ventas-online', etiqueta: 'Ventas online (Marketplace)' },
  { to: '/admin/productos-vendidos', etiqueta: 'Productos vendidos (Compras)' },
  { to: '/admin/diferencias', etiqueta: 'Diferencias de caja (Contabilidad)' },
  { to: '/admin/pubsub-verificacion', etiqueta: 'Verificación de Pub/Sub' },
  { to: '/admin/simulacion', etiqueta: 'Simulación de grupos' }, // vistas "como si fuéramos" Contabilidad, Marketplace y Compras
]

function AdminNavbar() {
  const { administrador, cerrarSesion } = useAdminAuth()
  const navigate = useNavigate()

  function handleCerrarSesion() {
    cerrarSesion()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <span className="navbar-brand">
        <Marca sufijo="Administración" />
      </span>
      {/* TDSI-141: el Panel de KPIs es el primer enlace de la barra del administrador */}
      <NavLink to="/admin/panel-kpis">Panel de KPIs</NavLink>
      <NavLink to="/admin/tablero">Tablero</NavLink>
      <NavLink to="/admin/cierre-diario">Cierre diario</NavLink>
      <NavLink to="/admin/historial-operaciones">Historial de operaciones</NavLink>
      <NavLink to="/admin/devoluciones">Devoluciones</NavLink>
      <NavLink to="/admin/pagos-proveedores">Pagos a proveedores</NavLink>
      <AdminNavDropdown etiqueta="Gestión de roles y clientes" items={GESTION_ROLES_Y_CLIENTES} />
      <AdminNavDropdown etiqueta="Reportes" items={REPORTES} />
      <AdminNavDropdown etiqueta="Integraciones" items={INTEGRACIONES} />

      <div className="navbar-sesion">
        <NavLink to="/admin/perfil" className="navbar-cajero" title="Ver y editar mi perfil">
          {administrador?.nombre || 'Administrador'}
        </NavLink>
        <button type="button" className="btn btn-logout" onClick={handleCerrarSesion}>
          Cerrar sesión
        </button>
      </div>
    </nav>
  )
}

export default AdminNavbar
