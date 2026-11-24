/**
 * TDSI-61/944: linea "Atendido por" que se muestra igual en el PDF y en el correo
 * (logica pura, sin BD, para poder probarla sin generar un PDF ni mandar un correo).
 */
function lineaAtendidoPor(comprobante) {
  // Con el nombre completo del cajero: "Luis Perez (dmntrixc)"; sin el (venta antigua o no se pudo leer), solo lo que se guardo.
  const completo = comprobante.cajero_nombre_completo;
  const quien = completo && completo !== comprobante.cajero_nombre ? `${completo} (${comprobante.cajero_nombre})` : comprobante.cajero_nombre;
  return comprobante.caja_id ? `Atendido por: ${quien} · Caja N° ${comprobante.caja_id}` : `Atendido por: ${quien}`;
}

module.exports = { lineaAtendidoPor };
