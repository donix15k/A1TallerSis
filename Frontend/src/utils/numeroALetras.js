// "DOSCIENTOS BOLIVIANOS CON 00/100": el monto en letras para el cupon (mismo criterio que la factura impresa).
const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
const DIEZ_A_DIECINUEVE = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve']
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function tresDigitos(n) {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const resto = n % 100
  let texto = c > 0 ? CENTENAS[c] : ''
  if (resto > 0) {
    if (texto) texto += ' '
    if (resto < 10) texto += UNIDADES[resto]
    else if (resto < 20) texto += DIEZ_A_DIECINUEVE[resto - 10]
    else {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      texto += DECENAS[d]
      if (u > 0) texto += (d === 2 ? 'i' : ' y ') + UNIDADES[u]
    }
  }
  return texto
}

function enteroALetras(n) {
  if (n === 0) return 'cero'
  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes = []
  if (millones > 0) partes.push(millones === 1 ? 'un millón' : `${tresDigitos(millones)} millones`)
  if (miles > 0) partes.push(miles === 1 ? 'mil' : `${tresDigitos(miles)} mil`)
  if (resto > 0) partes.push(tresDigitos(resto))
  return partes.join(' ').trim()
}

export function montoEnLetras(monto) {
  const num = Number(monto) || 0
  const entero = Math.floor(num)
  const centavos = Math.round((num - entero) * 100)
  return `${enteroALetras(entero).toUpperCase()} ${entero === 1 ? 'BOLIVIANO' : 'BOLIVIANOS'} CON ${String(centavos).padStart(2, '0')}/100`
}
