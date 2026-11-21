// Ilustraciones propias (SVG) de los productos bolivianos del catálogo del Marketplace: nítidas a cualquier tamaño y sin imágenes externas.
// Cada una dibuja el producto sobre un fondo con su color; si llega un producto nuevo sin ilustración se muestra una caja genérica.

const FONDOS = {
  'QUI-001': ['#fdf1d6', '#f4d9a0'], 'CHU-002': ['#eef1f4', '#cfd6df'], 'ARR-003': ['#eaf6ee', '#bfe3cb'], 'MAI-004': ['#fff6cf', '#f6df7a'],
  'CAF-005': ['#f4e7dc', '#d9b79c'], 'API-008': ['#f1e6fb', '#d3b6f0'], 'QUE-006': ['#fff3cf', '#f8d77c'], 'CHA-007': ['#f7e4dc', '#e1b3a0'],
  'SAL-009': ['#fdeedd', '#f5c88f'], 'PAN-010': ['#f8ecd9', '#e8c48b'], 'MIE-011': ['#fff0c9', '#f6c453'], 'CHO-012': ['#f1e4dd', '#c9a08c'],
}

const ARTE = {
  // bolsa de papel con la quinua
  'QUI-001': (
    <>
      <path d="M38 28h44l6 50H32z" fill="#d9a85f" /><path d="M38 28h44l2 14H36z" fill="#c4914a" />
      <rect x="42" y="46" width="36" height="22" rx="3" fill="#fff8e8" />
      <text x="60" y="60" textAnchor="middle" fontSize="8" fontWeight="800" fill="#7a4a12" fontFamily="sans-serif">QUINUA</text>
      {[[28, 76], [34, 82], [90, 78], [84, 83], [96, 84], [24, 83]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="3" ry="2" fill={['#f1d9a1', '#e8a0a0', '#8b5fbf'][i % 3]} />)}
    </>
  ),
  // canasto con chuños
  'CHU-002': (
    <>
      <path d="M26 52h68l-6 28H32z" fill="#a8743a" /><path d="M28 60h64M30 68h60M32 76h56" stroke="#8a5a28" strokeWidth="2" />
      {[[40, 46, 9], [56, 42, 10], [72, 46, 9], [86, 50, 7], [48, 52, 8], [64, 52, 9]].map(([x, y, r], i) => <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.8} fill={i % 2 ? '#f4f1ea' : '#dcd7cc'} stroke="#b9b3a5" strokeWidth="1" />)}
    </>
  ),
  // costal de arroz
  'ARR-003': (
    <>
      <path d="M36 24c8-4 40-4 48 0l5 56c-18 6-40 6-58 0z" fill="#f7f4ec" stroke="#cfc9b8" strokeWidth="1.5" />
      <path d="M33 54h54v14H33z" fill="#2f8f57" />
      <text x="60" y="64" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#fff" fontFamily="sans-serif">ARROZ</text>
      <path d="M45 34c2-4 6-4 8 0M64 36c2-4 6-4 8 0" stroke="#e4a93a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </>
  ),
  // mazorcas de maíz
  'MAI-004': (
    <>
      <path d="M44 74c-14-12-12-34 4-44 6 6 10 28-4 44z" fill="#5ea85f" /><path d="M78 74c14-12 12-34-4-44-6 6-10 28 4 44z" fill="#4b9650" />
      <ellipse cx="60" cy="50" rx="13" ry="28" fill="#f4c62a" />
      {Array.from({ length: 5 }, (_, r) => Array.from({ length: 3 }, (_, c) => <circle key={`${r}${c}`} cx={52 + c * 8} cy={32 + r * 10} r="3" fill="#e0a712" />))}
    </>
  ),
  // bolsa de café con granos
  'CAF-005': (
    <>
      <path d="M38 26h44l6 52H32z" fill="#6b3f26" /><path d="M38 26h44l1 8H37z" fill="#4e2b18" />
      <ellipse cx="60" cy="56" rx="14" ry="10" fill="#f4e7dc" /><path d="M60 47c-5 5 5 9 0 18" stroke="#6b3f26" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {[[28, 80, 20], [92, 82, -25], [22, 74, 60]].map(([x, y, g], i) => <ellipse key={i} cx={x} cy={y} rx="5" ry="3.2" fill="#4e2b18" transform={`rotate(${g} ${x} ${y})`} />)}
    </>
  ),
  // taza de api morado
  'API-008': (
    <>
      <path d="M34 42h50l-4 32a10 10 0 0 1-10 8H48a10 10 0 0 1-10-8z" fill="#fff" stroke="#d8c7ee" strokeWidth="1.5" />
      <path d="M36 48h46l-2 18a8 8 0 0 1-8 7H46a8 8 0 0 1-8-7z" fill="#7b2d8e" />
      <path d="M84 50h6a7 7 0 0 1 0 14h-6" stroke="#d8c7ee" strokeWidth="4" fill="none" />
      <path d="M50 36c-4-6 4-8 0-14M64 36c-4-6 4-8 0-14M78 36c-4-6 4-8 0-14" stroke="#b78bd6" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </>
  ),
  // rueda de queso con cuña
  'QUE-006': (
    <>
      <ellipse cx="58" cy="66" rx="34" ry="12" fill="#d9a21b" /><path d="M24 54v12a34 12 0 0 0 68 0V54z" fill="#eebb2d" />
      <ellipse cx="58" cy="54" rx="34" ry="12" fill="#f8d45a" />
      {[[44, 54, 4], [64, 50, 3.4], [76, 57, 4.4], [54, 60, 3]].map(([x, y, r], i) => <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.6} fill="#e1ab25" />)}
      <path d="M58 54l30 6" stroke="#d9a21b" strokeWidth="1.5" />
    </>
  ),
  // tiras de charque
  'CHA-007': (
    <>
      <path d="M30 28h60" stroke="#a9835a" strokeWidth="2.5" />
      {[[40, -4], [56, 3], [72, -2]].map(([x, g], i) => (
        <g key={i} transform={`rotate(${g} ${x} 30)`}>
          <path d={`M${x - 7} 30h14l-2 38c-1 6-9 6-10 0z`} fill="#8a4630" /><path d={`M${x - 3} 36v22M${x + 3} 38v18`} stroke="#c98a6a" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      ))}
      <ellipse cx="60" cy="82" rx="36" ry="4" fill="#00000012" />
    </>
  ),
  // salteña
  'SAL-009': (
    <>
      <path d="M22 62c0-24 18-36 38-36s38 12 38 36c0 8-8 12-38 12S22 70 22 62z" fill="#e69a3c" />
      <path d="M26 56c4-22 20-30 34-30s30 8 34 30c-10 4-22 6-34 6s-24-2-34-6z" fill="#f3b45a" />
      <path d="M22 64q38 18 76 0" fill="none" stroke="#c9782a" strokeWidth="3" strokeDasharray="2 4" strokeLinecap="round" />
      <path d="M44 40c8-6 24-6 32 0" stroke="#fbd699" strokeWidth="3" strokeLinecap="round" fill="none" />
    </>
  ),
  // pan de batalla
  'PAN-010': (
    <>
      {[[40, 64], [74, 64], [57, 46]].map(([x, y], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx="19" ry="14" fill="#c98a3a" /><ellipse cx={x} cy={y - 3} rx="17" ry="11" fill="#e3a954" />
          <path d={`M${x - 8} ${y - 6}q8 4 16 0`} stroke="#c98a3a" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  // frasco de miel
  'MIE-011': (
    <>
      <rect x="40" y="22" width="40" height="12" rx="4" fill="#8a5a28" />
      <path d="M36 36h48l3 34a12 12 0 0 1-12 12H45a12 12 0 0 1-12-12z" fill="#f2a413" />
      <path d="M36 36h48l1 12H35z" fill="#f8c24b" />
      <rect x="44" y="52" width="32" height="18" rx="3" fill="#fff8e6" />
      <text x="60" y="64" textAnchor="middle" fontSize="8" fontWeight="800" fill="#8a5a28" fontFamily="sans-serif">MIEL</text>
      <path d="M52 34c0 9 6 9 6 0" fill="#f8c24b" />
    </>
  ),
  // barra de chocolate
  'CHO-012': (
    <>
      <rect x="30" y="34" width="60" height="42" rx="5" fill="#5b3424" transform="rotate(-8 60 55)" />
      <g transform="rotate(-8 60 55)">
        {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={34 + c * 14} y={38 + r * 12.5} width="12" height="10.5" rx="2" fill="#7b4a33" />))}
        <path d="M30 34h60v10H30z" fill="#2f8f57" opacity=".92" /><text x="60" y="42" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="#fff" fontFamily="sans-serif">CACAO · BENI</text>
      </g>
    </>
  ),
}

function ImagenProducto({ sku, descripcion }) {
  const [a, b] = FONDOS[sku] ?? ['#eef1f6', '#d6dde8']
  const id = `fondo-${sku}`
  return (
    <svg className="sim-producto-img" viewBox="0 0 120 90" role="img" aria-label={descripcion} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
      </defs>
      <rect width="120" height="90" fill={`url(#${id})`} />
      <ellipse cx="60" cy="84" rx="38" ry="5" fill="#0b122014" />
      {ARTE[sku] ?? <rect x="38" y="26" width="44" height="44" rx="6" fill="#9aa7bb" />}
    </svg>
  )
}

export default ImagenProducto
