import { apiFetch } from './client.js'

// Simulación de los otros grupos (Contabilidad, Marketplace, Compras): Back/servicios/gestion_pagos, solo administrador.
// Cada acción publica UN mensaje real por Pub/Sub al tópico de entrada de A1, con la identidad del grupo de la vista.
const GESTION_PAGOS_API_BASE_URL = import.meta.env.VITE_GESTION_PAGOS_API_BASE_URL ?? ''
const BASE = '/api/simulacion'

const conToken = (token, extra = {}) => ({ ...extra, headers: { Authorization: `Bearer ${token}` } })
const post = (token, cuerpo) => conToken(token, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) })
const llamar = (ruta, opciones) => apiFetch(`${BASE}${ruta}`, opciones, GESTION_PAGOS_API_BASE_URL)

// Qué grupo es la vista y por qué tópicos viaja lo que se envía (simulado: grupo -> A1; normal: A1 -> grupo)
export const obtenerContextoVista = (vista, token) => llamar(`/vistas/${vista}`, conToken(token))

// ---- Contabilidad
export const listarDocumentosContabilidad = (token) => llamar('/contabilidad/documentos', conToken(token))
export const detalleDocumentoContabilidad = (referencia, token) => llamar(`/contabilidad/detalle?referencia=${encodeURIComponent(referencia)}`, conToken(token))
export const responderContabilidad = (cuerpo, token) => llamar('/contabilidad/responder', post(token, cuerpo))

// ---- Marketplace
export const listarProductosMarketplace = (token) => llamar('/marketplace/productos', conToken(token))
export const listarVentasMarketplace = (token) => llamar('/marketplace/ventas', conToken(token))
export const enviarVentaMarketplace = (cuerpo, token) => llamar('/marketplace/ventas', post(token, cuerpo))

// ---- Compras
export const listarReportesCompras = (token) => llamar('/compras/reportes', conToken(token))
export const acusarCompras = (reporte_id, token) => llamar('/compras/acuse', post(token, { reporte_id }))
export const listarProveedoresCompras = (token) => llamar('/compras/proveedores', conToken(token))
export const listarOrdenesCompras = (token) => llamar('/compras/ordenes', conToken(token))
export const enviarOrdenCompras = (cuerpo, token) => llamar('/compras/ordenes', post(token, cuerpo))
