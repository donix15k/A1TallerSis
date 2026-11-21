import { useEffect, useMemo, useState } from 'react'
import {
  listarUsuarios,
  crearCajero,
  crearSupervisor,
  crearAdministrador,
  editarUsuario,
  restablecerCredencial,
  cambiarEstadoUsuario,
} from '../api/usuarios.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import CampoPassword from '../components/CampoPassword.jsx'
import Cargando from '../components/Cargando.jsx'
import TablaPaginada from '../components/TablaPaginada.jsx'
import '../styles/usuarios.css'

const CLASE_ESTADO = { Activo: 'badge-estado--emitida', Inactivo: '', Bloqueado: 'badge-comparacion--faltante' }
const PIN_REGEX = /^\d{4,6}$/

// Roles que se pueden crear desde esta pantalla, con lo que pide cada uno.
const ROLES = {
  Cajero: {
    plural: 'Cajeros',
    descripcion: 'Atienden la caja: cobran, facturan y cierran su turno.',
    credencial: 'Contraseña',
    minimo: 6,
    ayuda: 'Mínimo 6 caracteres.',
  },
  Supervisor: {
    plural: 'Supervisores',
    descripcion: 'Autorizan cierres, anulaciones y modificaciones con su PIN.',
    credencial: 'PIN',
    ayuda: 'De 4 a 6 dígitos.',
  },
  Administrador: {
    plural: 'Administradores',
    descripcion: 'Gestionan usuarios, reportes e integraciones del sistema.',
    credencial: 'Contraseña',
    minimo: 8,
    ayuda: 'Mínimo 8 caracteres.',
  },
}
const FILTROS = [{ valor: '', etiqueta: 'Todos' }, ...Object.entries(ROLES).map(([valor, r]) => ({ valor, etiqueta: r.plural }))]

const FORM_INICIAL = { usuario: '', nombre: '', telefono: '', documento: '', secreto: '', confirmar: '' }

// Valida la credencial de un rol; devuelve el texto del problema o null.
function validarCredencial(rol, valor, confirmar) {
  const def = ROLES[rol]
  if (rol === 'Supervisor') {
    if (!PIN_REGEX.test(valor)) return 'El PIN debe tener entre 4 y 6 dígitos.'
  } else if (valor.length < def.minimo) {
    return `La contraseña debe tener al menos ${def.minimo} caracteres.`
  }
  if (valor !== confirmar) return `${def.credencial === 'PIN' ? 'El PIN' : 'La contraseña'} y su confirmación no coinciden.`
  return null
}

// "Usuarios y accesos": un solo lugar para crear cajeros, supervisores y administradores
// y, debajo, gestionarlos (editar, restablecer contraseña/PIN, activar o dar de baja).
function Usuarios() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token

  const [usuarios, setUsuarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [recargar, setRecargar] = useState(0)
  const [filtroRol, setFiltroRol] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [mensaje, setMensaje] = useState(null)

  const [rolNuevo, setRolNuevo] = useState('Cajero')
  const [nuevo, setNuevo] = useState(FORM_INICIAL)
  const [creando, setCreando] = useState(false)
  const [errorNuevo, setErrorNuevo] = useState(null)

  const [editando, setEditando] = useState(null)
  const [formEditar, setFormEditar] = useState({ usuario: '', nombre: '', telefono: '', documento: '' })
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)
  const [errorEditar, setErrorEditar] = useState(null)

  const [restableciendoA, setRestableciendoA] = useState(null)
  const [formSecreto, setFormSecreto] = useState({ secreto: '', confirmar: '' })
  const [guardandoSecreto, setGuardandoSecreto] = useState(false)
  const [errorSecreto, setErrorSecreto] = useState(null)

  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState(null)
  const [guardandoEstado, setGuardandoEstado] = useState(false)
  const [errorEstado, setErrorEstado] = useState(null)

  useEffect(() => {
    if (!token) return
    let vigente = true
    setCargando(true)
    setError(null)
    listarUsuarios(token)
      .then((r) => vigente && setUsuarios(r.data))
      .catch((err) => vigente && setError(err.mensaje || err.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [token, recargar])

  const conteo = useMemo(() => {
    const c = { Cajero: 0, Supervisor: 0, Administrador: 0 }
    for (const u of usuarios) if (u.estado === 'Activo' && c[u.rol] !== undefined) c[u.rol] += 1
    return c
  }, [usuarios])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return usuarios.filter(
      (u) =>
        (!filtroRol || u.rol === filtroRol) &&
        (!q || `${u.usuario} ${u.nombre}`.toLowerCase().includes(q))
    )
  }, [usuarios, filtroRol, busqueda])

  function cambiarRolNuevo(rol) {
    setRolNuevo(rol)
    setNuevo(FORM_INICIAL)
    setErrorNuevo(null)
  }

  const campo = (clave) => (e) => setNuevo((prev) => ({ ...prev, [clave]: e.target.value }))

  async function confirmarNuevo(event) {
    event.preventDefault()
    const usuario = nuevo.usuario.trim()
    const nombre = nuevo.nombre.trim()
    if (!usuario || !nombre) {
      setErrorNuevo(rolNuevo === 'Supervisor' ? 'Complete el usuario y el nombre.' : 'Complete el correo y el nombre.')
      return
    }
    const problema = validarCredencial(rolNuevo, nuevo.secreto, nuevo.confirmar)
    if (problema) {
      setErrorNuevo(problema)
      return
    }
    setCreando(true)
    setErrorNuevo(null)
    try {
      if (rolNuevo === 'Cajero') await crearCajero({ usuario, nombre, password: nuevo.secreto }, token)
      else if (rolNuevo === 'Supervisor') await crearSupervisor({ usuario, nombre, pin: nuevo.secreto }, token)
      else
        await crearAdministrador(
          { usuario, nombre, password: nuevo.secreto, telefono: nuevo.telefono.trim() || null, documento: nuevo.documento.trim() || null },
          token
        )
      setNuevo(FORM_INICIAL)
      setMensaje({ ok: true, texto: `${rolNuevo} "${usuario}" creado correctamente.` })
      setRecargar((n) => n + 1)
    } catch (err) {
      setErrorNuevo(err.mensaje || err.message)
    } finally {
      setCreando(false)
    }
  }

  function abrirEditar(u) {
    setEditando(u)
    setFormEditar({ usuario: u.usuario, nombre: u.nombre, telefono: u.telefono || '', documento: u.documento || '' })
    setErrorEditar(null)
    setMensaje(null)
  }

  async function confirmarEditar(event) {
    event.preventDefault()
    if (!formEditar.usuario.trim() || !formEditar.nombre.trim()) {
      setErrorEditar('Complete el usuario y el nombre.')
      return
    }
    setGuardandoEdicion(true)
    setErrorEditar(null)
    try {
      await editarUsuario(
        editando.id,
        {
          usuario: formEditar.usuario.trim(),
          nombre: formEditar.nombre.trim(),
          telefono: formEditar.telefono.trim() || null,
          documento: formEditar.documento.trim() || null,
        },
        token
      )
      setMensaje({ ok: true, texto: `"${formEditar.usuario.trim()}" actualizado correctamente.` })
      setEditando(null)
      setRecargar((n) => n + 1)
    } catch (err) {
      setErrorEditar(err.mensaje || err.message)
    } finally {
      setGuardandoEdicion(false)
    }
  }

  function abrirRestablecer(u) {
    setRestableciendoA(u)
    setFormSecreto({ secreto: '', confirmar: '' })
    setErrorSecreto(null)
    setMensaje(null)
  }

  async function confirmarRestablecer(event) {
    event.preventDefault()
    const problema = validarCredencial(restableciendoA.rol, formSecreto.secreto, formSecreto.confirmar)
    if (problema) {
      setErrorSecreto(problema)
      return
    }
    setGuardandoSecreto(true)
    setErrorSecreto(null)
    try {
      const cuerpo = restableciendoA.rol === 'Supervisor' ? { pin: formSecreto.secreto } : { password: formSecreto.secreto }
      await restablecerCredencial(restableciendoA.id, cuerpo, token)
      setMensaje({
        ok: true,
        texto: `${restableciendoA.rol === 'Supervisor' ? 'PIN' : 'Contraseña'} de "${restableciendoA.usuario}" restablecido correctamente.`,
      })
      setRestableciendoA(null)
    } catch (err) {
      setErrorSecreto(err.mensaje || err.message)
    } finally {
      setGuardandoSecreto(false)
    }
  }

  function pedirCambioEstado(u) {
    setCambiandoEstadoDe(u)
    setErrorEstado(null)
    setMensaje(null)
  }

  async function confirmarCambioEstado() {
    setGuardandoEstado(true)
    setErrorEstado(null)
    const activar = cambiandoEstadoDe.estado !== 'Activo'
    try {
      await cambiarEstadoUsuario(cambiandoEstadoDe.id, activar, token)
      setMensaje({ ok: true, texto: `"${cambiandoEstadoDe.usuario}" ${activar ? 'activado' : 'dado de baja'} correctamente.` })
      setCambiandoEstadoDe(null)
      setRecargar((n) => n + 1)
    } catch (err) {
      setErrorEstado(err.mensaje || err.message)
    } finally {
      setGuardandoEstado(false)
    }
  }

  const defNuevo = ROLES[rolNuevo]
  const usaCorreo = rolNuevo !== 'Supervisor'
  const esMio = (u) => u.rol === 'Administrador' && String(u.id) === String(administrador?.administrador_id)

  return (
    <section className="usuarios-pagina">
      <header className="usuarios-encabezado">
        <h1>Usuarios y accesos</h1>
        <p className="resumen-turno-actual">Cree cuentas de cajeros, supervisores y administradores y adminístrelas desde un solo lugar.</p>
        <ul className="usuarios-resumen">
          {Object.entries(ROLES).map(([rol, r]) => (
            <li key={rol}>
              <strong>{conteo[rol]}</strong>
              <span>{r.plural.toLowerCase()} activos</span>
            </li>
          ))}
        </ul>
      </header>

      <form className="usuarios-crear" onSubmit={confirmarNuevo}>
        <div className="usuarios-crear-cabecera">
          <h2>Crear cuenta</h2>
          <div className="usuarios-segmentos" role="tablist" aria-label="Tipo de cuenta">
            {Object.keys(ROLES).map((rol) => (
              <button
                key={rol}
                type="button"
                role="tab"
                aria-selected={rolNuevo === rol}
                className={`usuarios-segmento${rolNuevo === rol ? ' usuarios-segmento--activo' : ''}`}
                onClick={() => cambiarRolNuevo(rol)}
              >
                {rol}
              </button>
            ))}
          </div>
        </div>
        <p className="usuarios-ayuda">{defNuevo.descripcion}</p>

        <div className="usuarios-rejilla">
          <label className="campo">
            {usaCorreo ? 'Correo (para iniciar sesión)' : 'Usuario'}
            <input
              type={usaCorreo ? 'email' : 'text'}
              autoComplete="off"
              value={nuevo.usuario}
              onChange={campo('usuario')}
            />
          </label>
          <label className="campo">
            Nombre completo
            <input type="text" autoComplete="off" value={nuevo.nombre} onChange={campo('nombre')} />
          </label>
          {rolNuevo === 'Administrador' && (
            <>
              <label className="campo">
                Teléfono (opcional)
                <input type="tel" autoComplete="off" value={nuevo.telefono} onChange={campo('telefono')} />
              </label>
              <label className="campo">
                Documento de identidad (opcional)
                <input type="text" autoComplete="off" value={nuevo.documento} onChange={campo('documento')} />
              </label>
            </>
          )}
          <label className="campo">
            {defNuevo.credencial} <span className="usuarios-sugerencia">{defNuevo.ayuda}</span>
            <CampoPassword
              autoComplete="new-password"
              inputMode={rolNuevo === 'Supervisor' ? 'numeric' : undefined}
              maxLength={rolNuevo === 'Supervisor' ? 6 : undefined}
              value={nuevo.secreto}
              onChange={campo('secreto')}
            />
          </label>
          <label className="campo">
            Confirmar {defNuevo.credencial.toLowerCase()}
            <CampoPassword
              autoComplete="new-password"
              inputMode={rolNuevo === 'Supervisor' ? 'numeric' : undefined}
              maxLength={rolNuevo === 'Supervisor' ? 6 : undefined}
              value={nuevo.confirmar}
              onChange={campo('confirmar')}
            />
          </label>
        </div>

        {errorNuevo && <p className="error">{errorNuevo}</p>}

        <div className="usuarios-crear-pie">
          <button type="submit" className="btn" disabled={creando}>
            {creando ? 'Creando...' : `Crear ${rolNuevo.toLowerCase()}`}
          </button>
        </div>
      </form>

      <div className="usuarios-lista-cabecera">
        <h2>Cuentas existentes</h2>
        <div className="usuarios-filtros">
          <input
            type="search"
            className="usuarios-buscar"
            placeholder="Buscar por nombre o usuario"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar usuarios"
          />
          <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} aria-label="Filtrar por rol">
            {FILTROS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mensaje && <p className={mensaje.ok ? 'mensaje-exito' : 'error'}>{mensaje.texto}</p>}
      {cargando && <Cargando />}
      {!cargando && error && <p className="error">Error: {error}</p>}
      {!cargando && !error && visibles.length === 0 && (
        <p className="orden-mensaje orden-mensaje-pendiente cajas-mensaje">No hay cuentas que coincidan con el filtro.</p>
      )}

      {!cargando && !error && visibles.length > 0 && (
        <TablaPaginada items={visibles} nombre="usuarios">
          {(filas) => (
            <table className="tabla-facturas">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((u) => (
                  <tr key={`${u.rol}-${u.id}`} className={u.estado === 'Activo' ? '' : 'usuarios-fila-inactiva'}>
                    <td>{u.usuario}</td>
                    <td>
                      {u.nombre}
                      {esMio(u) && <span className="usuarios-yo">tú</span>}
                    </td>
                    <td>
                      <span className={`usuarios-rol usuarios-rol--${u.rol.toLowerCase()}`}>{u.rol}</span>
                    </td>
                    <td>
                      <span className={`badge-estado ${CLASE_ESTADO[u.estado] ?? ''}`}>{u.estado}</span>
                    </td>
                    <td className="usuarios-acciones">
                      <button type="button" className="btn btn-secundario" onClick={() => abrirEditar(u)}>
                        Editar
                      </button>
                      <button type="button" className="btn btn-secundario" onClick={() => abrirRestablecer(u)}>
                        {u.rol === 'Supervisor' ? 'Restablecer PIN' : 'Restablecer contraseña'}
                      </button>
                      {!esMio(u) && (
                        <button
                          type="button"
                          className={`btn ${u.estado === 'Activo' ? 'btn-secundario usuarios-baja' : ''}`}
                          onClick={() => pedirCambioEstado(u)}
                        >
                          {u.estado === 'Activo' ? 'Dar de baja' : 'Activar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TablaPaginada>
      )}

      {editando && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Editar usuario">
          <form className="modal-caja" onSubmit={confirmarEditar}>
            <h2>Editar {editando.rol.toLowerCase()}</h2>
            <label className="campo">
              Usuario
              <input
                type="text"
                autoComplete="off"
                value={formEditar.usuario}
                onChange={(e) => setFormEditar((p) => ({ ...p, usuario: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="campo">
              Nombre
              <input type="text" value={formEditar.nombre} onChange={(e) => setFormEditar((p) => ({ ...p, nombre: e.target.value }))} />
            </label>
            {editando.rol === 'Administrador' && (
              <>
                <label className="campo">
                  Teléfono
                  <input type="tel" value={formEditar.telefono} onChange={(e) => setFormEditar((p) => ({ ...p, telefono: e.target.value }))} />
                </label>
                <label className="campo">
                  Documento de identidad
                  <input type="text" value={formEditar.documento} onChange={(e) => setFormEditar((p) => ({ ...p, documento: e.target.value }))} />
                </label>
              </>
            )}
            {errorEditar && <p className="error">{errorEditar}</p>}
            <div className="pago-exito-acciones">
              <button type="button" className="btn btn-secundario" onClick={() => setEditando(null)} disabled={guardandoEdicion}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={guardandoEdicion}>
                {guardandoEdicion ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {restableciendoA && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Restablecer acceso">
          <form className="modal-caja" onSubmit={confirmarRestablecer}>
            <h2>{restableciendoA.rol === 'Supervisor' ? 'Restablecer PIN' : 'Restablecer contraseña'}</h2>
            <p>
              Cuenta: <strong>{restableciendoA.usuario}</strong> ({restableciendoA.nombre})
            </p>
            <label className="campo">
              {restableciendoA.rol === 'Supervisor' ? 'PIN nuevo (4 a 6 dígitos)' : `Contraseña nueva (mínimo ${ROLES[restableciendoA.rol].minimo} caracteres)`}
              <CampoPassword
                autoComplete="new-password"
                inputMode={restableciendoA.rol === 'Supervisor' ? 'numeric' : undefined}
                maxLength={restableciendoA.rol === 'Supervisor' ? 6 : undefined}
                value={formSecreto.secreto}
                onChange={(e) => setFormSecreto((p) => ({ ...p, secreto: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="campo">
              Confirmar
              <CampoPassword
                autoComplete="new-password"
                inputMode={restableciendoA.rol === 'Supervisor' ? 'numeric' : undefined}
                maxLength={restableciendoA.rol === 'Supervisor' ? 6 : undefined}
                value={formSecreto.confirmar}
                onChange={(e) => setFormSecreto((p) => ({ ...p, confirmar: e.target.value }))}
              />
            </label>
            {errorSecreto && <p className="error">{errorSecreto}</p>}
            <div className="pago-exito-acciones">
              <button type="button" className="btn btn-secundario" onClick={() => setRestableciendoA(null)} disabled={guardandoSecreto}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={guardandoSecreto}>
                {guardandoSecreto ? 'Guardando...' : 'Restablecer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {cambiandoEstadoDe && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirmar cambio de estado">
          <div className="modal-caja">
            <h2>{cambiandoEstadoDe.estado === 'Activo' ? 'Dar de baja' : 'Activar'} cuenta</h2>
            <p>
              ¿Desea {cambiandoEstadoDe.estado === 'Activo' ? 'dar de baja' : 'activar'} a <strong>{cambiandoEstadoDe.usuario}</strong> ({cambiandoEstadoDe.nombre})?
              {cambiandoEstadoDe.estado === 'Activo' && ' Mientras esté de baja no podrá iniciar sesión ni autorizar nada; puede activarla de nuevo cuando quiera.'}
            </p>
            {errorEstado && <p className="error">{errorEstado}</p>}
            <div className="pago-exito-acciones">
              <button type="button" className="btn btn-secundario" onClick={() => setCambiandoEstadoDe(null)} disabled={guardandoEstado}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={confirmarCambioEstado} disabled={guardandoEstado}>
                {guardandoEstado ? 'Guardando...' : 'Sí, confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default Usuarios
