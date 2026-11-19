CREATE SCHEMA IF NOT EXISTS devoluciones;

-- TDSI-71: catalogo de motivos predefinidos
CREATE TABLE IF NOT EXISTS devoluciones.motivos (
    id      BIGSERIAL PRIMARY KEY,
    nombre  VARCHAR(100) NOT NULL UNIQUE,
    activo  BOOLEAN      NOT NULL DEFAULT true
);
INSERT INTO devoluciones.motivos (nombre) VALUES
    ('Producto defectuoso'), ('Producto equivocado'), ('Cliente se arrepintio'), ('Otro')
ON CONFLICT DO NOTHING;

-- TDSI-68/69/70/71/76/78/80/81: cabecera de la devolucion
CREATE TABLE IF NOT EXISTS devoluciones.devoluciones (
    id                    BIGSERIAL PRIMARY KEY,
    codigo                VARCHAR(20)  NOT NULL UNIQUE,          -- TDSI-76: correlativo unico
    factura_numero        VARCHAR(20)  NOT NULL,                 -- TDSI-68: busqueda por comprobante
    venta_id              VARCHAR(60),
    cliente_nit           VARCHAR(30),
    fecha_venta           TIMESTAMPTZ  NOT NULL,
    fecha_solicitud       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    dentro_de_plazo       BOOLEAN      NOT NULL,                 -- TDSI-69
    tipo                  VARCHAR(10)  NOT NULL CHECK (tipo IN ('TOTAL','PARCIAL')),  -- TDSI-70
    motivo_id             BIGINT       REFERENCES devoluciones.motivos(id),           -- TDSI-71
    observaciones         VARCHAR(300),
    metodo_pago_original  VARCHAR(20)  NOT NULL,                 -- TDSI-72: define opciones de reembolso
    monto_total           NUMERIC(14,2) NOT NULL CHECK (monto_total > 0),
    estado                VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (estado IN ('PENDIENTE','APROBADA','RECHAZADA','PROCESADA')),  -- TDSI-78
    motivo_rechazo        VARCHAR(300),
    requiere_autorizacion BOOLEAN      NOT NULL DEFAULT false,   -- TDSI-80: monto sobre el limite
    autorizado_por        VARCHAR(60),
    autorizado_en         TIMESTAMPTZ,
    creado_por            VARCHAR(60)
);
CREATE INDEX IF NOT EXISTS idx_devoluciones_factura ON devoluciones.devoluciones (factura_numero);
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado   ON devoluciones.devoluciones (estado);
CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha    ON devoluciones.devoluciones (fecha_solicitud);

-- TDSI-70: items devueltos (para devolucion parcial)
CREATE TABLE IF NOT EXISTS devoluciones.devolucion_items (
    id              BIGSERIAL PRIMARY KEY,
    devolucion_id   BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    descripcion     VARCHAR(200) NOT NULL,
    cantidad        NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(14,2) NOT NULL,
    subtotal        NUMERIC(14,2) NOT NULL
);

-- TDSI-81: historial inmutable de cambios de estado (append-only, nunca se actualiza ni borra)
CREATE TABLE IF NOT EXISTS devoluciones.historial_estados (
    id              BIGSERIAL PRIMARY KEY,
    devolucion_id   BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    estado_anterior VARCHAR(20),
    estado_nuevo    VARCHAR(20) NOT NULL,
    cambiado_por    VARCHAR(60),
    cambiado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TDSI-72/74: reembolsos derivados de la devolucion (efectivo, reversion de tarjeta, etc.)
CREATE TABLE IF NOT EXISTS devoluciones.reembolsos (
    id                  BIGSERIAL PRIMARY KEY,
    devolucion_id       BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    tipo                VARCHAR(20)  NOT NULL CHECK (tipo IN ('EFECTIVO','REVERSION_TARJETA','REVERSION_QR')),
    monto               NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    estado              VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','PROCESADO','ERROR')),
    procesado_en        TIMESTAMPTZ
);

-- TDSI-74: envio de anulacion/reversion a la pasarela de pagos (con reintentos)
CREATE TABLE IF NOT EXISTS devoluciones.envios_pasarela (
    id              BIGSERIAL PRIMARY KEY,
    reembolso_id    BIGINT NOT NULL REFERENCES devoluciones.reembolsos(id) ON DELETE CASCADE,
    pasarela        VARCHAR(60),
    estado          VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR')),
    intentos        INT NOT NULL DEFAULT 0,
    enviado_en      TIMESTAMPTZ
);

-- TDSI-48: una devolucion tiene como maximo un reembolso por tipo (EFECTIVO / REVERSION_TARJETA / REVERSION_QR) y cada
-- reembolso de tarjeta/QR tiene un solo envio a la pasarela, con su ultimo error y la hora del proximo reintento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reembolsos_devolucion_tipo ON devoluciones.reembolsos (devolucion_id, tipo);
ALTER TABLE devoluciones.envios_pasarela ADD COLUMN IF NOT EXISTS ultimo_error       VARCHAR(400);
ALTER TABLE devoluciones.envios_pasarela ADD COLUMN IF NOT EXISTS proximo_intento_en TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_envios_pasarela_reembolso ON devoluciones.envios_pasarela (reembolso_id);
CREATE INDEX IF NOT EXISTS ix_envios_pasarela_pendientes ON devoluciones.envios_pasarela (proximo_intento_en) WHERE estado = 'PENDIENTE';

-- TDSI-73/79: notas de credito electronicas
CREATE TABLE IF NOT EXISTS devoluciones.notas_credito (
    id              BIGSERIAL PRIMARY KEY,
    devolucion_id   BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    numero          VARCHAR(20)  NOT NULL UNIQUE,
    monto           NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    estado          VARCHAR(20)  NOT NULL DEFAULT 'EMITIDA' CHECK (estado IN ('EMITIDA','ANULADA')),
    emitida_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    enviada_por_correo BOOLEAN   NOT NULL DEFAULT false,          -- TDSI-79
    enviada_en      TIMESTAMPTZ
);

-- TDSI-57: una devolucion procesada tiene una sola nota de credito (y la numeracion NC-000001 no se repite: UNIQUE(numero))
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_credito_devolucion ON devoluciones.notas_credito (devolucion_id);

-- TDSI-75: vales de compra / tarjetas de saldo digitales
CREATE TABLE IF NOT EXISTS devoluciones.vales_compra (
    id                BIGSERIAL PRIMARY KEY,
    devolucion_id     BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    codigo            VARCHAR(30)  NOT NULL UNIQUE,
    monto             NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    saldo_disponible  NUMERIC(14,2) NOT NULL,
    estado            VARCHAR(20)  NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','USADO','EXPIRADO')),
    emitido_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expira_en         TIMESTAMPTZ
);

-- TDSI-79: envio de comprobante digital (nota de credito o reembolso) por correo
CREATE TABLE IF NOT EXISTS devoluciones.envios_comprobante (
    id              BIGSERIAL PRIMARY KEY,
    devolucion_id   BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    email_destino   VARCHAR(150),
    tipo            VARCHAR(20)  NOT NULL CHECK (tipo IN ('NOTA_CREDITO','REEMBOLSO','VALE')),
    estado          VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR')),
    enviado_en      TIMESTAMPTZ
);

-- TDSI-68: el reembolso puede ser un VALE de compra (no sale efectivo); una devolucion genera como maximo un vale.
ALTER TABLE devoluciones.reembolsos DROP CONSTRAINT IF EXISTS reembolsos_tipo_check;
ALTER TABLE devoluciones.reembolsos ADD CONSTRAINT reembolsos_tipo_check CHECK (tipo IN ('EFECTIVO','REVERSION_TARJETA','REVERSION_QR','VALE'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_vales_compra_devolucion ON devoluciones.vales_compra (devolucion_id);

-- TDSI-71: cada cobro hecho con un vale queda registrado (idempotente por referencia: reintentar el mismo cobro no
-- descuenta dos veces) y se puede revertir si el cobro no llega a registrarse.
CREATE TABLE IF NOT EXISTS devoluciones.vales_usos (
    id             BIGSERIAL PRIMARY KEY,
    vale_id        BIGINT NOT NULL REFERENCES devoluciones.vales_compra(id) ON DELETE CASCADE,
    monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    referencia     VARCHAR(60) NOT NULL,
    usado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revertido_en   TIMESTAMPTZ
);
-- una referencia solo puede estar activa una vez por vale; si el uso se revierte, la referencia queda libre.
ALTER TABLE devoluciones.vales_usos DROP CONSTRAINT IF EXISTS vales_usos_vale_id_referencia_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vales_usos_activos ON devoluciones.vales_usos (vale_id, referencia) WHERE revertido_en IS NULL;
ALTER TABLE devoluciones.vales_usos ENABLE ROW LEVEL SECURITY;

-- TDSI-59: sin credenciales SMTP el correo se "simula" (se deja constancia pero no sale nada): estado propio SIMULADO.
ALTER TABLE devoluciones.envios_comprobante DROP CONSTRAINT IF EXISTS envios_comprobante_estado_check;
ALTER TABLE devoluciones.envios_comprobante ADD CONSTRAINT envios_comprobante_estado_check CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR','SIMULADO'));

-- TDSI-77: notificacion al subsistema de inventario
CREATE TABLE IF NOT EXISTS devoluciones.notificaciones_inventario (
    id              BIGSERIAL PRIMARY KEY,
    devolucion_id   BIGINT NOT NULL REFERENCES devoluciones.devoluciones(id) ON DELETE CASCADE,
    estado          VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR')),
    enviado_en      TIMESTAMPTZ
);

-- NOTA: TDSI-29/135/136 (supervision de devoluciones en caja) no crea tabla nueva aqui.
-- El microservicio "cajeros" consulta esta informacion via HTTP (GET a devoluciones.devoluciones),
-- no accede directo a este schema.

ALTER TABLE devoluciones.motivos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.devoluciones               ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.devolucion_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.historial_estados          ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.reembolsos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.envios_pasarela            ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.notas_credito              ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.vales_compra               ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.envios_comprobante         ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones.notificaciones_inventario  ENABLE ROW LEVEL SECURITY;
-- TDSI-92: envio de cada nota de credito a Contabilidad (Grupo D) por Pub/Sub. Una nota tiene un solo envio
-- (idempotency_key nc-{numero}); guarda el messageId que devuelve Pub/Sub, los reintentos y, despues, la respuesta
-- de Contabilidad (TDSI-94: registrado con N° de asiento, o rechazado con su motivo).
CREATE TABLE IF NOT EXISTS devoluciones.envios_contabilidad_nc (
    id                    BIGSERIAL PRIMARY KEY,
    nota_credito_id       BIGINT       NOT NULL UNIQUE REFERENCES devoluciones.notas_credito(id) ON DELETE CASCADE,
    idempotency_key       VARCHAR(60)  NOT NULL UNIQUE,
    estado                VARCHAR(20)  NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Enviado','Error')),
    intentos              INT          NOT NULL DEFAULT 0,
    ultimo_intento_en     TIMESTAMPTZ,
    ultimo_error          VARCHAR(400),
    pubsub_message_id     VARCHAR(100),
    proximo_intento_en    TIMESTAMPTZ,
    enviado_en            TIMESTAMPTZ,
    payload               JSONB        NOT NULL,
    creado_en             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resultado             VARCHAR(20),
    numero_asiento        VARCHAR(30),
    resultado_motivo      VARCHAR(400),
    resultado_en          TIMESTAMPTZ,
    resultado_message_id  VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS ix_envios_contabilidad_nc_pendientes ON devoluciones.envios_contabilidad_nc (proximo_intento_en) WHERE estado = 'Pendiente';
ALTER TABLE devoluciones.envios_contabilidad_nc ENABLE ROW LEVEL SECURITY;
