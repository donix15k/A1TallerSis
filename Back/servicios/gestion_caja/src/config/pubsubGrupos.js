// TDSI-964: mismo catalogo de grupos del proyecto compartido que ya usa gestion_pagos
// en "Verificacion de Pub/Sub" (ver gestion_pagos/src/config/pubsubGrupos.js) -- aca solo
// hace falta el nombre (para armar sistema_origen cuando el Administrador simula un
// origen distinto al nuestro real, GESTION_CAJA, al reenviar un aviso a Contabilidad).
const GRUPOS = [
  { grupo: "A", nombre: "Gestión de Pagos y Facturación" },
  // El grupo A se dividio: nosotros somos A1 (mismo nombre funcional) y A2 es la otra mitad.
  { grupo: "A1", nombre: "Gestión de Pagos y Facturación" },
  { grupo: "A2", nombre: "Grupo A2" },
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

// Desde que grupo se manda todo aviso por defecto: el nuestro (A1). Se puede elegir otro al reenviar;
// cambia el valor inicial con PUBSUB_GRUPO_ORIGEN.
const GRUPO_ORIGEN_DEFECTO = (process.env.PUBSUB_GRUPO_ORIGEN || "A1").trim().toUpperCase();

module.exports = { GRUPOS, GRUPO_ORIGEN_DEFECTO, buscarPorGrupo, slugificarOrigen };
