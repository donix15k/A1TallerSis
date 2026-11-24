// Catalogo de la tienda: los mismos 12 productos que vende el Marketplace en la simulacion (Back/servicios/gestion_pagos/src/services/simulacionService.js).
// Las fotos viven en Frontend/public/productos/<SKU>.jpg.
export const CATALOGO_PRODUCTOS = [
  { sku: 'ARR-001', descripcion: 'Arroz Grano de Oro 10 kg', precio: 95, categoria: 'Abarrotes' },
  { sku: 'ACE-002', descripcion: 'Aceite Fino vegetal 900 ml', precio: 15, categoria: 'Abarrotes' },
  { sku: 'AZU-003', descripcion: 'Azúcar Aguaí 1 kg', precio: 7.5, categoria: 'Abarrotes' },
  { sku: 'FID-004', descripcion: 'Fideo Don Vittorio spaghetti 400 g', precio: 6.5, categoria: 'Abarrotes' },
  { sku: 'LEC-005', descripcion: 'Leche PIL ultrapasteurizada 1 L', precio: 7, categoria: 'Lácteos' },
  { sku: 'QUE-006', descripcion: 'Queso criollo Esthercita', precio: 25, categoria: 'Lácteos' },
  { sku: 'HUE-007', descripcion: 'Huevos La Granja (maple de 30)', precio: 32, categoria: 'Frescos' },
  { sku: 'PAN-008', descripcion: 'Pan de molde San Gabriel', precio: 14.5, categoria: 'Panadería' },
  { sku: 'ATU-009', descripcion: 'Atún El Pescador 170 g', precio: 12, categoria: 'Conservas' },
  { sku: 'CAF-010', descripcion: 'Café Copacabana premium molido', precio: 28, categoria: 'Bebidas' },
  { sku: 'JUG-011', descripcion: 'Bebida de naranja De la Granja 3 L', precio: 24, categoria: 'Bebidas' },
  { sku: 'DET-012', descripcion: 'Detergente Bolivar 1 kg', precio: 22.5, categoria: 'Limpieza' },
]

export const MAX_UNIDADES = 50

/** Total del carrito ({ sku: unidades }) en Bs, calculado en centavos para no arrastrar decimales. */
export function totalCarrito(carrito) {
  const centavos = CATALOGO_PRODUCTOS.reduce((acc, p) => acc + Math.round((carrito[p.sku] ?? 0) * p.precio * 100), 0)
  return centavos / 100
}
