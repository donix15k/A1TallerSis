import { apiFetch } from './client.js'

// Microservicio Back/servicios/devoluciones_reembolsos (puerto 4007).
export const DEVOLUCIONES_API_BASE_URL = import.meta.env.VITE_DEVOLUCIONES_API_BASE_URL ?? 'http://localhost:4007'

const llamar = (path, options) => apiFetch(path, options, DEVOLUCIONES_API_BASE_URL)

// TDSI-12/13: busca una factura por su numero (F-000123) y devuelve sus productos con la cantidad que
// todavia se puede devolver, si esta dentro del plazo de 7 dias y por que no se puede devolver (bloqueo).
export function buscarFacturaParaDevolucion(numero) {
  return llamar(`/api/devoluciones/factura/${encodeURIComponent(numero)}`)
}

// TDSI-20/26: motivos activos (Producto defectuoso, Producto equivocado, Cliente se arrepintio, Otro).
export function listarMotivos() {
  return llamar('/api/devoluciones/motivos')
}

// TDSI-21/22/27: registra la devolucion (PENDIENTE) y devuelve su codigo DEV-XXXX, tipo y monto.
//   { factura_numero, items: [{ descripcion, cantidad, precio_unitario, estado_producto }], motivo_id, observaciones, cajero }
export function registrarDevolucion(datos) {
  return llamar('/api/devoluciones', { method: 'POST', body: JSON.stringify(datos) })
}

// TDSI-33/38: bandeja del supervisor: devoluciones PENDIENTES (de la mas antigua a la mas nueva) y "total" (el contador).
export function listarPendientes({ limite = 200 } = {}) {
  return llamar(`/api/devoluciones?estado=PENDIENTE&limite=${limite}`)
}

// TDSI-35/39: el supervisor aprueba con su usuario y PIN ({ supervisor_id, pin }).
export function aprobarDevolucion(codigo, { supervisor_id, pin }) {
  return llamar(`/api/devoluciones/${encodeURIComponent(codigo)}/aprobar`, { method: 'POST', body: JSON.stringify({ supervisor_id, pin }) })
}

// TDSI-36/40: el supervisor rechaza con el motivo (minimo 10 caracteres), su usuario y PIN.
export function rechazarDevolucion(codigo, { supervisor_id, pin, motivo_rechazo }) {
  return llamar(`/api/devoluciones/${encodeURIComponent(codigo)}/rechazar`, {
    method: 'POST',
    body: JSON.stringify({ supervisor_id, pin, motivo_rechazo }),
  })
}

// TDSI-45/51: como se va a devolver el dinero de una devolucion APROBADA (plan por metodo) y el monto.
// forma: ORIGINAL (segun como pago el cliente) o VALE (vale de compra, TDSI-67).
export function consultarReembolso(codigo, { forma = 'ORIGINAL' } = {}) {
  return llamar(`/api/devoluciones/${encodeURIComponent(codigo)}/reembolso?forma=${forma}`)
}

// TDSI-49/52: reembolsa y deja la devolucion PROCESADA. caja_id hace falta si sale efectivo de la caja.
export function reembolsarDevolucion(codigo, { cajero, caja_id, forma = 'ORIGINAL' }) {
  return llamar(`/api/devoluciones/${encodeURIComponent(codigo)}/reembolsar`, {
    method: 'POST',
    body: JSON.stringify({ cajero, caja_id, forma }),
  })
}

// TDSI-24: estado, items, motivo y monto de una devolucion por su codigo.
export function obtenerDevolucion(codigo) {
  return llamar(`/api/devoluciones/${encodeURIComponent(codigo)}`)
}
