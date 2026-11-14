// TDSI-958: topicos de cada grupo del proyecto compartido (project-a96e5fe1-5ba6-4698-a85),
// para la pantalla "Verificacion de Pub/Sub" del Administrador -- probar a mano si hay
// conexion real con cada grupo, sin depender de que una integracion de negocio ya
// estuviera armada para ese grupo en particular.
const PROYECTO = "project-a96e5fe1-5ba6-4698-a85";

const GRUPOS = [
  { grupo: "A", nombre: "Gestión de Pagos y Facturación", sufijo: "sub-a" },
  { grupo: "B", nombre: "CRM", sufijo: "sub-b" },
  { grupo: "C", nombre: "Gestión de Compras y Proveedores", sufijo: "sub-c" },
  { grupo: "D", nombre: "Contabilidad", sufijo: "sub-d" },
  { grupo: "E", nombre: "Marketplace y Ventas", sufijo: "sub-e" },
  { grupo: "F", nombre: "Recursos Humanos", sufijo: "sub-f" },
  { grupo: "G", nombre: "Producción y Logística", sufijo: "sub-g" },
  { grupo: "H", nombre: "Gestión de Entregas/Despachos", sufijo: "sub-h" },
  { grupo: "I", nombre: "Gestión de Inventarios y Almacén", sufijo: "sub-i" },
].map((g) => ({ ...g, topico: `projects/${PROYECTO}/topics/ucb-sis323-${g.sufijo}` }));

function buscarPorGrupo(grupo) {
  return GRUPOS.find((g) => g.grupo === String(grupo || "").toUpperCase().trim());
}

// Nombre de grupo -> identificador para sistema_origen (sin tildes/espacios, en mayusculas).
// TDSI-964: compartido por "Verificación de Pub/Sub" y por las integraciones reales
// (Ventas Online/Marketplace, Productos Vendidos/Compras) que dejan elegir el origen.
function slugificarOrigen(nombre) {
  return nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Hora de Bolivia, YYYY-MM-DD -- mismo formato de fecha_documento que ya usan
// facturacion y gestion_caja al mandarle documentos a Contabilidad.
const fechaDocumentoHoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

module.exports = { GRUPOS, buscarPorGrupo, slugificarOrigen, fechaDocumentoHoy };
