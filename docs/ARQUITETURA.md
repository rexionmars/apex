# Plano de Arquitetura — Software de Coleta e Análise de Carcaças

**Projeto:** carcass_integration (PAVIC/UFPI)
**Data:** 2026-06-30
**Stack:** Wails v2 + Go 1.23+ + React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui
**Status:** proposta para revisão (nenhum código escrito ainda)

---

## 1. Por que este software existe (o problema real)

A tentativa anterior de pesquisa (ver `avaliacao_carcaca_por_foto.tex`) **não falhou pelos
métodos de ML — falhou pela integridade dos dados.** A causa demonstrada foi a **falha de
pareamento** entre imagem, animal e grau:

- O vínculo foto ↔ animal ↔ grau **não foi registrado no momento da coleta**; foi
  reconstruído depois por ordem de arquivo, sem verificação.
- Etiquetas físicas com duplicatas (3 fotos da mesma carcaça), etiquetas ilegíveis, e
  numeração que não bate com a planilha do laboratório (só 4 de 15 coincidiam).
- A planilha do laboratório **não tinha coluna de nome de imagem** — zero vínculo registrado.
- Captura sem padronização: fundo não uniforme, operador na foto, iluminação de janela.

**Consequência de design:** este software não é "um capturador de fotos". Seu propósito
central é **garantir pareamento verificável no ato da coleta**, de forma que seja
*impossível* reproduzir o erro anterior. Toda decisão de arquitetura abaixo serve a isso.

Os 4 requisitos da Seção 3 daquele documento são, na prática, a especificação deste software:

| # | Requisito do documento | Como o software atende |
|---|------------------------|------------------------|
| R1 | Pareamento físico imagem↔animal↔medidas no ato do abate; etiqueta legível na imagem; planilha única | Banco único (SQLite) preenchido na coleta; ID da carcaça digitado *antes* da captura; a imagem herda o vínculo do banco, nunca do nome de arquivo |
| R2 | Grau por 2–3 avaliadores independentes sobre a imagem; medir concordância inter-avaliador | Módulo de rating com sessões independentes por avaliador; cálculo de concordância (κ de Fleiss / ICC) e grau de consenso |
| R3 | Amostra estratificada de 100–120 carcaças cobrindo toda a faixa de grau | Dashboard de progresso por estrato; alertas de sub-representação |
| R4 | Referência física (espessura de gordura, GR, área de olho de lombo, dissecção) | Campos de medida física por carcaça na mesma ficha do pareamento |

---

## 2. Visão geral da arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  Binário único Wails (Go)                                      │
│                                                                │
│  ┌─────────────────────┐        ┌──────────────────────────┐  │
│  │ Frontend (React 19) │◄──────►│  App struct (Go)          │  │
│  │ WebView nativa      │ bridge │  métodos expostos ao front │  │
│  │ Tailwind + shadcn   │ tipado └──────────┬───────────────┘  │
│  └─────────────────────┘                   │                  │
│                              ┌─────────────┼───────────────┐  │
│                              ▼             ▼               ▼  │
│                        ┌──────────┐  ┌──────────┐  ┌─────────┐│
│                        │ store    │  │ capture  │  │ rating  ││
│                        │ (SQLite) │  │ (fontes) │  │ (κ/ICC) ││
│                        └────┬─────┘  └────┬─────┘  └─────────┘│
└─────────────────────────────┼─────────────┼──────────────────┘
                              │             │
                    ┌─────────▼───┐   ┌─────▼──────────────────┐
                    │ carcass.db  │   │ Fontes de captura:      │
                    │ + images/   │   │  • Webcam USB (Go/gocv) │
                    └─────────────┘   │  • Kinect v1/v2 ────────┼──► Sidecar Python
                                      │    (RGB + depth)        │    (libfreenect2 +
                                      └─────────────────────────┘     OpenCV) via
                                                                       JSON/socket local
```

**Princípio 1 — o banco é a fonte da verdade do pareamento.** A imagem nunca carrega o
vínculo no nome do arquivo. O fluxo é sempre: (a) operador seleciona/cria a carcaça no
banco → (b) captura acontece *dentro* do contexto dessa carcaça → (c) o arquivo salvo já
nasce com `carcass_id` gravado na tabela `images`. Reconstrução por nome de arquivo é
estruturalmente impossível.

**Princípio 2 — fontes de captura são intercambiáveis.** Uma interface Go única
(`CaptureSource`) abstrai webcam, Kinect v1 e Kinect v2. Webcam roda nativo em Go; Kinect
roda num sidecar Python que fala com o Go. O resto do app não sabe nem se importa qual
fonte está ativa.

**Princípio 3 — depth desde o schema.** Mesmo entregando webcam primeiro, o modelo de
dados já reserva `depth_path` e metadados 3D. O documento aponta a conformação (perfil
externo) como "a frente compatível com a modalidade bidimensional"; o depth do Kinect a
torna 3D real em vez de silhueta inferida.

---

## 3. Modelo de dados (SQLite — `modernc.org/sqlite`, Go puro, sem cgo)

Escolha de SQLite Go-puro preserva o "binário único de ~6MB" do guia. Um único arquivo
`carcass.db` **é** a planilha única exigida por R1.

```sql
-- Um lote de coleta (uma sessão de abate / um dia / um frigorífico)
CREATE TABLE batches (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  location      TEXT,
  collected_at  TEXT NOT NULL,         -- ISO-8601
  operator      TEXT,
  notes         TEXT
);

-- A carcaça: unidade central. O ID físico da etiqueta é OBRIGATÓRIO e digitado
-- ANTES da captura. É o que impede a reconstrução por nome de arquivo.
CREATE TABLE carcasses (
  id             INTEGER PRIMARY KEY,
  batch_id       INTEGER NOT NULL REFERENCES batches(id),
  physical_tag   TEXT NOT NULL,        -- ID legível da etiqueta física
  animal_id      TEXT,                 -- ID do animal na planilha do laboratório (o VÍNCULO explícito)
  treatment      TEXT,                 -- dieta/tratamento
  species        TEXT DEFAULT 'ovino',
  stratum        TEXT,                 -- estrato de amostragem (para R3)
  -- Referência física (R4): observável na imagem? NÃO. Medida no animal.
  fat_thickness_mm   REAL,
  gr_measure_mm      REAL,
  loin_eye_area_cm2  REAL,
  dissection_notes   TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(batch_id, physical_tag)       -- não deixa duplicar tag no mesmo lote
);

-- Imagens. O carcass_id é gravado NO MOMENTO da captura, não inferido depois.
CREATE TABLE images (
  id            INTEGER PRIMARY KEY,
  carcass_id    INTEGER NOT NULL REFERENCES carcasses(id),
  rgb_path      TEXT NOT NULL,         -- caminho relativo em images/
  depth_path    TEXT,                  -- mapa de profundidade (Kinect), .png 16-bit ou .npy
  source        TEXT NOT NULL,         -- 'webcam' | 'kinect_v1' | 'kinect_v2' | 'import'
  view          TEXT,                  -- 'posterior' | 'lateral' | ... (padronização de vista)
  width         INTEGER,
  height        INTEGER,
  sha256        TEXT NOT NULL,         -- integridade/dedup do arquivo
  captured_at   TEXT NOT NULL,
  imported_from TEXT,                  -- origem, se veio de upload externo
  meta_json     TEXT                   -- EXIF, intrínsecos da câmera, etc.
);

-- Avaliadores (R2)
CREATE TABLE raters (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  role   TEXT
);

-- Sessão de avaliação: um avaliador dá notas de forma INDEPENDENTE.
CREATE TABLE grading_sessions (
  id          INTEGER PRIMARY KEY,
  rater_id    INTEGER NOT NULL REFERENCES raters(id),
  started_at  TEXT NOT NULL,
  blind       INTEGER NOT NULL DEFAULT 1  -- avaliador não vê nota dos outros
);

-- Uma nota, sempre atrelada a (carcaça, avaliador). Grau sobre a IMAGEM (R2).
CREATE TABLE grades (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES grading_sessions(id),
  carcass_id    INTEGER NOT NULL REFERENCES carcasses(id),
  conformation  TEXT,                  -- eixo 1: forma/músculo (observável na imagem)
  finishing     TEXT,                  -- eixo 2: cobertura de gordura (limitação de modalidade)
  confidence    INTEGER,               -- 1–5, autoavaliação do avaliador
  graded_at     TEXT NOT NULL,
  UNIQUE(session_id, carcass_id)
);
-- Concordância (κ de Fleiss / ICC) e grau de consenso são CALCULADOS a partir de grades,
-- não armazenados de forma redundante.
```

**Integridade garantida no schema:** `physical_tag` obrigatório e único por lote;
`carcass_id` obrigatório em `images`; `sha256` para dedup; nota sempre ligada a avaliador.
A falha de 2022 (pareamento reconstruído) é impossível por construção.

### Layout em disco
```
<data_dir>/                     # ex.: ~/Library/App Support/carcass-integration (macOS)
├── carcass.db                  # a planilha única
└── images/
    └── batch_<id>/
        └── carcass_<tag>/
            ├── rgb_<uuid>.jpg
            └── depth_<uuid>.png
```

---

## 4. Interface de captura (o ponto Go ↔ Python)

```go
// backend/capture/source.go
type Frame struct {
    RGB       []byte  // JPEG/PNG bytes
    Depth     []byte  // 16-bit PNG ou .npy serializado (nil p/ webcam)
    Width     int
    Height    int
    Source    string  // "webcam" | "kinect_v1" | "kinect_v2"
    MetaJSON  string
}

type CaptureSource interface {
    Name() string
    Available() bool
    Start() error
    Preview() (<-chan Frame, error)  // stream p/ EventsEmit -> React
    Capture() (Frame, error)         // disparo único, alta qualidade
    Stop() error
}
```

- **`WebcamSource`** (fase 1): implementação Go nativa. Opção A: `gocv` (bindings OpenCV —
  requer OpenCV instalado, adiciona cgo). Opção B: captura via AVFoundation/V4L2/DirectShow
  por plataforma. **Decisão a validar na fase 1:** gocv é o caminho mais rápido, mas fere o
  "binário puro". Alternativa: capturar no *frontend* via `getUserMedia` (a WebView tem
  acesso a câmera) e mandar os bytes pro Go — **isto evita cgo inteiramente** e é minha
  recomendação para webcam. Kinect não dá pra fazer assim (sem depth no browser).

- **`KinectSource`** (fase 2): sidecar Python. O Go faz spawn de um processo
  `python sidecar/kinect_capture.py`. Protocolo local:
  - **Preview:** sidecar escreve frames JPEG num socket Unix / named pipe local; Go relê e
    reemite via `runtime.EventsEmit` para o React.
  - **Capture:** Go envia comando JSON (`{"cmd":"capture","carcass_id":42}`) por stdin;
    sidecar responde com paths dos arquivos RGB+depth já salvos + metadados por stdout.
  - Dependências do sidecar: `libfreenect2` + `pylibfreenect2` (v2) / `freenect` (v1) +
    `numpy` + `opencv-python`. Documentadas num `sidecar/requirements.txt` e num `README`
    de setup (Homebrew no macOS, apt no Linux).

---

## 5. Upload de datasets externos (o segundo pilar que você pediu)

Fotos de outras fontes (não capturadas por este software) **precisam entrar sem quebrar o
pareamento.** Fluxo de importação:

1. Operador escolhe um diretório.
2. Software varre imagens, calcula `sha256` (dedup), lê EXIF.
3. **Tela de conciliação obrigatória:** cada imagem importada precisa ser atribuída a uma
   carcaça (existente ou nova). Sem `carcass_id`, a imagem fica em estado `unpaired` e
   **não entra no dataset exportável** — fica visível num painel "pendências de pareamento".
4. Suporte a CSV de mapeamento (`filename,physical_tag,animal_id,...`) para importar em
   lote *com* o vínculo, quando a fonte externa já tiver essa informação.
5. `source='import'` + `imported_from` registram a proveniência — auditável.

Isto transforma o modo de falha de 2022 (imagens órfãs viram vínculos inventados) em um
estado explícito e visível que o operador *tem* que resolver.

---

## 6. Módulo de avaliação / inter-rater (R2)

- Cada avaliador loga como `rater` e abre uma `grading_session` **cega** (não vê notas dos
  outros).
- A UI mostra a imagem (RGB, e depth quando houver) e coleta `conformation` e `finishing`
  nos dois eixos que o documento descreve.
- Após ≥2 avaliadores completarem, o software calcula:
  - **κ de Fleiss** (categórico) ou **ICC** (ordinal/contínuo) para concordância.
  - **Grau de consenso** (maioria / mediana), marcado como inválido se a concordância for
    insuficiente — exatamente o guard-rail de R2.
- O `finishing` é coletado mas o software **sinaliza** (via nota de UI) que é a dimensão de
  limitação óptica descrita no documento; a validação preditiva séria dele depende da
  referência física de R4.

---

## 7. Estrutura de telas (React)

```
App
├── TitleBar (frameless, draggable)
├── Sidebar
│   ├── Coleta        → seleciona/cria Batch → Carcaça → Captura (RGB+depth)
│   ├── Importar      → upload de diretório + conciliação de pareamento
│   ├── Avaliação     → sessão de rating inter-avaliador
│   ├── Dashboard     → progresso por estrato (R3), concordância, pendências
│   └── Exportar      → dataset versionado + manifesto de integridade
└── Toaster (sonner)
```

Padrões do guia respeitados: `cn()` helper, tokens OKLCH, componentes shadcn que você
possui, `EventsEmit`/`EventsOn` para o stream de preview da câmera, slices Go
inicializadas como `[]T{}` (nunca nil) no boundary.

---

## 8. Exportação de dataset (o objetivo final da pesquisa)

Comando de export gera:
- Estrutura de pastas + um `manifest.csv`/`.parquet` com **uma linha por imagem**, contendo
  o pareamento completo: `image_path, depth_path, physical_tag, animal_id, treatment,
  stratum, conformation_consensus, finishing_consensus, fleiss_kappa, fat_thickness_mm, ...`
- **Apenas** carcaças com pareamento verificado e (opcionalmente) grau de consenso válido.
- Um `integrity_report.txt`: total por estrato, imagens `unpaired` excluídas, concordância
  inter-avaliador, hashes. É o artefato que atesta que o erro de 2022 não se repetiu.

---

## 9. Estrutura de diretórios do projeto

```
carcass_integration/
├── docs/                       # já existe (os .tex + este plano)
├── main.go                     # janela, go:embed, Bind
├── app.go                      # App struct → métodos expostos
├── wails.json
├── go.mod
├── backend/
│   ├── store/                  # SQLite: migrations, queries, models
│   ├── capture/                # CaptureSource, WebcamSource, KinectSource
│   ├── grading/                # κ de Fleiss / ICC, consenso
│   ├── importer/               # varredura de diretório, dedup, conciliação
│   └── export/                 # manifesto + relatório de integridade
├── sidecar/                    # (fase 2) Python p/ Kinect
│   ├── kinect_capture.py
│   └── requirements.txt
└── frontend/
    └── src/
        ├── components/ui/       # shadcn (você possui)
        ├── pages/               # Coleta, Importar, Avaliação, Dashboard, Exportar
        ├── hooks/               # useCapture, useGrading, ...
        └── lib/utils.ts         # cn()
```

---

## 10. Roadmap por fases

**Fase 0 — Setup (curto)**
- Instalar Wails (`go install`), scaffold do projeto, Tailwind 4 + shadcn.
- App abre vazio, compila nos 3 alvos. Go 1.26 e Node 22 já estão no ambiente. ✅

**Fase 1 — Núcleo de integridade (MVP)**
- Schema SQLite + migrations. Telas Coleta (Batch→Carcaça) e captura por **webcam via
  `getUserMedia`** (sem cgo). Pareamento gravado no banco. Importação de diretório com
  conciliação. Este é o incremento que já *previne o erro de 2022*.

**Fase 2 — Kinect (depth)**
- Sidecar Python (libfreenect2). `KinectSource` no Go. Captura RGB+depth pareada.
- Requer instalar `libfreenect2` + `pylibfreenect2` + `opencv-python` (nada disso está no
  ambiente ainda).

**Fase 3 — Avaliação inter-rater (R2)**
- Módulo de rating cego, κ de Fleiss/ICC, grau de consenso.

**Fase 4 — Dashboard + Export**
- Progresso estratificado (R3), pendências, exportação com relatório de integridade.

---

## 11. Riscos e decisões em aberto (para validar na Fase 1)

1. **Webcam: `getUserMedia` vs. gocv.** Recomendo `getUserMedia` (evita cgo, mantém binário
   puro). Perde-se controle fino de exposição/foco que uma DSLR daria — aceitável para
   webcam. **A validar com um protótipo de captura na Fase 1.**
2. **Kinect v2 no macOS (Apple Silicon).** libfreenect2 em ARM Mac pode exigir build manual
   e USB3 estável; se a estação de captura for Linux/Windows, é mais tranquilo. **Confirmar
   qual SO roda no frigorífico.**
3. **Padronização de captura** (o doc critica fundo/iluminação): o software pode impor uma
   *vista* obrigatória e um overlay-guia na tela de captura, mas fundo/luz são físicos —
   vale um checklist de setup no `README`.
4. **Assinatura macOS** (guia, pitfall 3): binário não assinado dá aviso; se distribuir para
   várias estações Mac, considerar conta Apple Developer.
```
