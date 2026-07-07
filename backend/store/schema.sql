-- Schema do banco de coleta de carcaças (PAVIC/UFPI).
-- Princípio central: o pareamento imagem<->animal<->grau vive AQUI, nunca no nome do arquivo.
-- Isso torna estruturalmente impossível o erro da coleta anterior (pareamento reconstruído
-- por ordem de arquivo sem verificação).

PRAGMA foreign_keys = ON;

-- Um lote de coleta (uma sessão de abate / um dia / um frigorífico).
CREATE TABLE IF NOT EXISTS batches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    location     TEXT NOT NULL DEFAULT '',
    operator     TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    collected_at TEXT NOT NULL,   -- ISO-8601
    created_at   TEXT NOT NULL
);

-- A carcaça: unidade central. physical_tag é OBRIGATÓRIO e digitado ANTES da captura.
CREATE TABLE IF NOT EXISTS carcasses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id          INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    physical_tag      TEXT NOT NULL,        -- ID legível da etiqueta física
    animal_id         TEXT NOT NULL DEFAULT '',  -- vínculo explícito com a planilha do laboratório
    treatment         TEXT NOT NULL DEFAULT '',
    species           TEXT NOT NULL DEFAULT 'ovino',
    stratum           TEXT NOT NULL DEFAULT '',   -- estrato de amostragem (R3)
    -- Referência física (R4) -- NÃO observável na imagem, medida no animal.
    fat_thickness_mm  REAL,
    gr_measure_mm     REAL,
    loin_eye_area_cm2 REAL,
    dissection_notes  TEXT NOT NULL DEFAULT '',
    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    UNIQUE (batch_id, physical_tag)   -- não permite duplicar tag no mesmo lote
);

-- Imagens. carcass_id é gravado NO MOMENTO da captura/import, nunca inferido depois.
CREATE TABLE IF NOT EXISTS images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    carcass_id    INTEGER NOT NULL REFERENCES carcasses(id) ON DELETE CASCADE,
    rgb_path      TEXT NOT NULL,        -- caminho relativo dentro de images/
    depth_path    TEXT NOT NULL DEFAULT '',  -- mapa de profundidade (Kinect)
    source        TEXT NOT NULL,        -- 'webcam' | 'kinect_v1' | 'kinect_v2' | 'import'
    view          TEXT NOT NULL DEFAULT '',  -- 'posterior' | 'lateral' | ...
    width         INTEGER NOT NULL DEFAULT 0,
    height        INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT NOT NULL,        -- integridade / dedup
    imported_from TEXT NOT NULL DEFAULT '',
    meta_json     TEXT NOT NULL DEFAULT '',
    captured_at   TEXT NOT NULL,
    UNIQUE (sha256)                     -- dedup: mesmo arquivo não entra duas vezes
);

-- Avaliadores (R2).
CREATE TABLE IF NOT EXISTS raters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

-- Sessão de avaliação: um avaliador dá notas de forma INDEPENDENTE (cega).
CREATE TABLE IF NOT EXISTS grading_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rater_id   INTEGER NOT NULL REFERENCES raters(id) ON DELETE CASCADE,
    blind      INTEGER NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL
);

-- Uma nota, sempre atrelada a (sessão, carcaça). Grau atribuído sobre a IMAGEM (R2).
CREATE TABLE IF NOT EXISTS grades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES grading_sessions(id) ON DELETE CASCADE,
    carcass_id   INTEGER NOT NULL REFERENCES carcasses(id) ON DELETE CASCADE,
    conformation TEXT NOT NULL DEFAULT '',  -- eixo 1: forma/músculo (observável na imagem)
    finishing    TEXT NOT NULL DEFAULT '',  -- eixo 2: cobertura de gordura (limitação óptica)
    confidence   INTEGER NOT NULL DEFAULT 0,  -- 1..5
    graded_at    TEXT NOT NULL,
    UNIQUE (session_id, carcass_id)
);

-- Resultado de inferência por modelo, persistido (uma linha por imagem analisada).
CREATE TABLE IF NOT EXISTS analyses (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id           INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    carcass_id         INTEGER NOT NULL REFERENCES carcasses(id) ON DELETE CASCADE,
    fat_percent        REAL NOT NULL,
    background_removed  INTEGER NOT NULL DEFAULT 0,
    foreground_frac    REAL NOT NULL DEFAULT 0,
    finishing_class    TEXT NOT NULL DEFAULT '',
    finishing_probs    TEXT NOT NULL DEFAULT '',  -- JSON
    eg_value           REAL,
    overlay_path       TEXT NOT NULL DEFAULT '',
    carcass_path       TEXT NOT NULL DEFAULT '',
    grade_experimental INTEGER NOT NULL DEFAULT 0,
    -- Conformação (convexidade integral) — medida objetiva; grau estimado NÃO validado.
    conv_perna         REAL,
    conv_lombo         REAL,
    conv_paleta        REAL,
    conformation_index REAL,
    conformation_grade TEXT NOT NULL DEFAULT '',
    conformation_conf  REAL,
    conformation_map   TEXT NOT NULL DEFAULT '',
    analyzed_at        TEXT NOT NULL,
    UNIQUE (image_id)  -- uma análise corrente por imagem (re-análise substitui)
);

CREATE INDEX IF NOT EXISTS idx_carcasses_batch ON carcasses(batch_id);
CREATE INDEX IF NOT EXISTS idx_images_carcass ON images(carcass_id);
CREATE INDEX IF NOT EXISTS idx_grades_carcass ON grades(carcass_id);
CREATE INDEX IF NOT EXISTS idx_grades_session ON grades(session_id);
CREATE INDEX IF NOT EXISTS idx_analyses_carcass ON analyses(carcass_id);
