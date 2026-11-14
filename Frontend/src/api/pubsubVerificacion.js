import { apiFetch } from './client.js'

// TDSI-958: "Verificación de Pub/Sub" -- mandar un mensaje cualquiera a cualquiera
// de los tópicos de los grupos del proyecto compartido (apunta a gestion_pagos,
// que ya tiene las credenciales de Pub/Sub configuradas).
const GESTION_PAGOS_API_BASE_URL = import.meta.env.VITE_GESTION_PAGOS_API_BASE_URL ?? ''
const BASE = '/api/pagos/pubsub-verificacion'

export function listarGruposPubSub() {
  return apiFetch(`${BASE}/grupos`, {}, GESTION_PAGOS_API_BASE_URL)
}

export function listarVerificacionesPubSub() {
  return apiFetch(BASE, {}, GESTION_PAGOS_API_BASE_URL)
}

export function enviarVerificacionPubSub({ grupo_origen, grupo, topico_personalizado, mensaje, enviado_por }) {
  return apiFetch(
    BASE,
    { method: 'POST', body: JSON.stringify({ grupo_origen, grupo, topico_personalizado, mensaje, enviado_por }) },
    GESTION_PAGOS_API_BASE_URL,
  )
}
