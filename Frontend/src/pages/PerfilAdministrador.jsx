import { useEffect, useState } from 'react'
import { obtenerPerfil, actualizarPerfil, cambiarPasswordPropia } from '../api/usuarios.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import CampoPassword from '../components/CampoPassword.jsx'
import Cargando from '../components/Cargando.jsx'
import '../styles/usuarios.css'

const PASSWORD_MINIMA = 8

// Perfil del administrador que inició sesión: datos personales y cambio de contraseña.
function PerfilAdministrador() {
  const { administrador, actualizarAdministrador } = useAdminAuth()
  const token = administrador?.access_token

  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)

  const [datos, setDatos] = useState({ nombre: '', correo: '', telefono: '', documento: '' })
  const [guardando, setGuardando] = useState(false)
  const [msgDatos, setMsgDatos] = useState(null)

  const [pass, setPass] = useState({ actual: '', nueva: '', confirmar: '' })
  const [cambiando, setCambiando] = useState(false)
  const [msgPass, setMsgPass] = useState(null)

  useEffect(() => {
    if (!token) return
    let vigente = true
    obtenerPerfil(token)
      .then((r) => {
        if (!vigente) return
        const p = r.data
        setPerfil(p)
        setDatos({ nombre: p.nombre || '', correo: p.correo || '', telefono: p.telefono || '', documento: p.documento || '' })
      })
      .catch((err) => vigente && setErrorCarga(err.mensaje || err.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [token])

  async function guardarDatos(event) {
    event.preventDefault()
    if (!datos.nombre.trim()) {
      setMsgDatos({ ok: false, texto: 'El nombre no puede quedar vacío.' })
      return
    }
    setGuardando(true)
    setMsgDatos(null)
    try {
      const r = await actualizarPerfil(
        { nombre: datos.nombre.trim(), correo: datos.correo.trim() || null, telefono: datos.telefono.trim() || null, documento: datos.documento.trim() || null },
        token
      )
      setPerfil(r.data)
      actualizarAdministrador({ nombre: r.data.nombre })
      setMsgDatos({ ok: true, texto: 'Datos guardados correctamente.' })
    } catch (err) {
      setMsgDatos({ ok: false, texto: err.mensaje || err.message })
    } finally {
      setGuardando(false)
    }
  }

  async function guardarPassword(event) {
    event.preventDefault()
    if (!pass.actual) {
      setMsgPass({ ok: false, texto: 'Escriba su contraseña actual.' })
      return
    }
    if (pass.nueva.length < PASSWORD_MINIMA) {
      setMsgPass({ ok: false, texto: `La contraseña nueva debe tener al menos ${PASSWORD_MINIMA} caracteres.` })
      return
    }
    if (pass.nueva !== pass.confirmar) {
      setMsgPass({ ok: false, texto: 'La contraseña nueva y su confirmación no coinciden.' })
      return
    }
    setCambiando(true)
    setMsgPass(null)
    try {
      await cambiarPasswordPropia({ password_actual: pass.actual, password_nueva: pass.nueva }, token)
      setPass({ actual: '', nueva: '', confirmar: '' })
      setMsgPass({ ok: true, texto: 'Contraseña actualizada correctamente.' })
    } catch (err) {
      setMsgPass({ ok: false, texto: err.mensaje || err.message })
    } finally {
      setCambiando(false)
    }
  }

  if (cargando) return <Cargando />
  if (errorCarga) return <p className="error">Error: {errorCarga}</p>

  const inicial = (perfil?.nombre || administrador?.nombre || '?').trim().charAt(0).toUpperCase()
  const mensaje = (m) => m && <p className={m.ok ? 'mensaje-exito' : 'error'}>{m.texto}</p>

  return (
    <section className="perfil-admin">
      <div className="perfil-cabecera">
        <span className="perfil-avatar" aria-hidden="true">{inicial}</span>
        <div>
          <h1>Mi perfil</h1>
          <span className="perfil-correo">@{perfil?.usuario || 'administrador'} · Administrador</span>
        </div>
      </div>

      <form className="perfil-tarjeta" onSubmit={guardarDatos}>
        <h2>Datos personales</h2>
        <p className="usuarios-ayuda">Su usuario es con el que inicia sesión y no se cambia desde aquí; el correo es solo informativo.</p>
        <div className="usuarios-rejilla">
          <label className="campo">
            Usuario
            <input type="text" value={perfil?.usuario || ''} readOnly />
          </label>
          <label className="campo">
            Correo (informativo)
            <input type="email" value={datos.correo} onChange={(e) => setDatos((p) => ({ ...p, correo: e.target.value }))} />
          </label>
          <label className="campo">
            Nombre completo
            <input type="text" value={datos.nombre} onChange={(e) => setDatos((p) => ({ ...p, nombre: e.target.value }))} />
          </label>
          <label className="campo">
            Teléfono
            <input type="tel" value={datos.telefono} onChange={(e) => setDatos((p) => ({ ...p, telefono: e.target.value }))} />
          </label>
          <label className="campo">
            Documento de identidad
            <input type="text" value={datos.documento} onChange={(e) => setDatos((p) => ({ ...p, documento: e.target.value }))} />
          </label>
        </div>
        {mensaje(msgDatos)}
        <div className="perfil-pie">
          <button type="submit" className="btn" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar datos'}
          </button>
        </div>
      </form>

      <form className="perfil-tarjeta" onSubmit={guardarPassword}>
        <h2>Cambiar contraseña</h2>
        <p className="usuarios-ayuda">Mínimo {PASSWORD_MINIMA} caracteres. Necesita escribir la contraseña actual.</p>
        <div className="usuarios-rejilla">
          <label className="campo">
            Contraseña actual
            <CampoPassword autoComplete="current-password" value={pass.actual} onChange={(e) => setPass((p) => ({ ...p, actual: e.target.value }))} />
          </label>
          <label className="campo">
            Contraseña nueva
            <CampoPassword autoComplete="new-password" value={pass.nueva} onChange={(e) => setPass((p) => ({ ...p, nueva: e.target.value }))} />
          </label>
          <label className="campo">
            Confirmar contraseña nueva
            <CampoPassword autoComplete="new-password" value={pass.confirmar} onChange={(e) => setPass((p) => ({ ...p, confirmar: e.target.value }))} />
          </label>
        </div>
        {mensaje(msgPass)}
        <div className="perfil-pie">
          <button type="submit" className="btn" disabled={cambiando}>
            {cambiando ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default PerfilAdministrador
