// Formatos de Bolivia para las pantallas nuevas: montos "Bs 1.208,20" y fechas en hora de La Paz.
const ZONA = 'America/La_Paz'

const numeroBs = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function bs(monto) {
  const n = Number(monto)
  return `Bs ${numeroBs.format(Number.isFinite(n) ? n : 0)}`
}

export function numero(valor, decimales = 0) {
  const n = Number(valor)
  return new Intl.NumberFormat('es-BO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(Number.isFinite(n) ? n : 0)
}

export function porcentaje(valor, decimales = 2) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '—'
  return `${numero(valor, decimales)} %`
}

export function fecha(valor) {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('es-BO', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fechaHora(valor) {
  if (!valor) return '—'
  return new Date(valor).toLocaleString('es-BO', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** "hace 3 min", "hace 2 h", "hace 4 d". */
export function hace(valor) {
  if (!valor) return '—'
  const seg = Math.max(0, Math.round((Date.now() - new Date(valor).getTime()) / 1000))
  if (seg < 60) return 'hace un momento'
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`
  return `hace ${Math.round(seg / 86400)} d`
}

/** Hoy en Bolivia como AAAA-MM-DD. */
export function hoyBolivia() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA })
}

/** Mes actual en Bolivia como AAAA-MM. */
export function mesActualBolivia() {
  return hoyBolivia().slice(0, 7)
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** "2026-11" -> "Noviembre 2026" */
export function nombrePeriodo(periodo) {
  const [a, m] = String(periodo).split('-').map(Number)
  return MESES[m - 1] ? `${MESES[m - 1]} ${a}` : periodo
}

/** Copia texto al portapapeles (con respaldo para navegadores sin permiso). */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = texto
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
