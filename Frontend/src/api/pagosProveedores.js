import { apiFetch } from './client.js'

// Pagos a proveedores (Back/servicios/pagos_proveedores, solo administrador): las ordenes de pago que llegan de Compras y el pago de cada una.
const PROVEEDORES = import.meta.env.VITE_PAGOS_PROVEEDORES_API_BASE_URL ?? ''
const conToken = (token, extra = {}) => ({ ...extra, headers: { Authorization: `Bearer ${token}` } })

/** estado: 'PENDIENTE' | 'LIQUIDADA' | '' (todas). Devuelve { data: [orden], pendientes, metodos, dias_para_vencer }. */
export const listarOrdenesProveedores = (estado, token) => apiFetch(`/api/pagos-proveedores/ordenes${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`, conToken(token), PROVEEDORES)

/** Paga la orden por su monto: { metodo: 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO', descripcion? }. */
export const pagarOrdenProveedor = (numero, cuerpo, token) =>
  apiFetch(`/api/pagos-proveedores/ordenes/${encodeURIComponent(numero)}/pagar`, conToken(token, { method: 'POST', body: JSON.stringify(cuerpo) }), PROVEEDORES)
