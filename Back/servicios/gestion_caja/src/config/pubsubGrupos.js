// TDSI-964: mismo catalogo de grupos del proyecto compartido que ya usa gestion_pagos
// en "Verificacion de Pub/Sub" (ver gestion_pagos/src/config/pubsubGrupos.js) -- aca solo
// hace falta el nombre (para armar sistema_origen cuando el Administrador simula un
// origen distinto al nuestro real, GESTION_CAJA, al reenviar un aviso a Contabilidad).
const GRUPOS = [
  { grupo: "A", nombre: "Gestión de Pagos y Facturación" },
  { grupo: "B", nombre: "CRM" },
  { grupo: "C", nombre: "Gestión de Compras y Proveedores" },
  { grupo: "D", nombre: "Contabilidad" },
  { grupo: "E", nombre: "Marketplace y Ventas" },
  { grupo: "F", nombre: "Recursos Humanos" },
  { grupo: "G", nombre: "Producción y Logística" },
  { grupo: "H", nombre: "Gestión de Entregas/Despachos" },
  { grupo: "I", nombre: "Gestión de Inventarios y Almacén" },
];

function buscarPorGrupo(grupo) {
  return GRUPOS.find((g) => g.grupo === String(grupo || "").toUpperCase().trim());
}

// Nombre de grupo -> identificador para sistema_origen (sin tildes/espacios, en mayusculas).
function slugificarOrigen(nombre) {
  return nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

module.exports = { GRUPOS, buscarPorGrupo, slugificarOrigen };
