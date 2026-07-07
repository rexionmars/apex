// Package store é a camada de dados. Um único arquivo SQLite (carcass.db) é a
// "planilha única" exigida pela pesquisa: o pareamento imagem<->animal<->grau
// vive aqui, nunca no nome do arquivo.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // driver Go puro, sem cgo
)

//go:embed schema.sql
var schemaSQL string

// Store encapsula a conexão e todas as operações de dados.
type Store struct {
	db *sql.DB
}

// Open abre (ou cria) o banco no caminho dado e aplica o schema.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("abrir banco: %w", err)
	}
	// foreign_keys precisa ser ligado por conexão; garantimos com pragma na DSN também.
	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		db.Close()
		return nil, fmt.Errorf("ativar foreign_keys: %w", err)
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("aplicar schema: %w", err)
	}
	s := &Store{db: db}
	s.migrate() // adiciona colunas novas em bancos já existentes (idempotente)
	return s, nil
}

// migrate adiciona colunas introduzidas depois da criação do banco. Cada ALTER
// falha silenciosamente se a coluna já existe (SQLite não tem "ADD COLUMN IF NOT EXISTS").
func (s *Store) migrate() {
	cols := []string{
		`ALTER TABLE analyses ADD COLUMN conv_perna REAL`,
		`ALTER TABLE analyses ADD COLUMN conv_lombo REAL`,
		`ALTER TABLE analyses ADD COLUMN conv_paleta REAL`,
		`ALTER TABLE analyses ADD COLUMN conformation_index REAL`,
		`ALTER TABLE analyses ADD COLUMN conformation_grade TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE analyses ADD COLUMN conformation_conf REAL`,
		`ALTER TABLE analyses ADD COLUMN conformation_map TEXT NOT NULL DEFAULT ''`,
	}
	for _, c := range cols {
		s.db.Exec(c) // erro ignorado: coluna já existe
	}
}

// Close fecha a conexão.
func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

func (s *Store) CreateBatch(b Batch) (Batch, error) {
	if b.Name == "" {
		return Batch{}, fmt.Errorf("batch name is required")
	}
	if b.CollectedAt == "" {
		b.CollectedAt = nowISO()
	}
	b.CreatedAt = nowISO()
	res, err := s.db.Exec(
		`INSERT INTO batches (name, location, operator, notes, collected_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		b.Name, b.Location, b.Operator, b.Notes, b.CollectedAt, b.CreatedAt,
	)
	if err != nil {
		return Batch{}, fmt.Errorf("create batch: %w", err)
	}
	b.ID, _ = res.LastInsertId()
	return b, nil
}

func (s *Store) ListBatches() ([]Batch, error) {
	rows, err := s.db.Query(
		`SELECT id, name, location, operator, notes, collected_at, created_at
		 FROM batches ORDER BY collected_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list batches: %w", err)
	}
	defer rows.Close()

	out := []Batch{} // nunca nil (evita JSON null no bridge)
	for rows.Next() {
		var b Batch
		if err := rows.Scan(&b.ID, &b.Name, &b.Location, &b.Operator, &b.Notes,
			&b.CollectedAt, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Carcasses
// ---------------------------------------------------------------------------

// CreateCarcass exige batchId e physicalTag. A UNIQUE(batch_id, physical_tag)
// impede duplicar a etiqueta no mesmo lote — a primeira defesa contra o erro de pareamento.
func (s *Store) CreateCarcass(c Carcass) (Carcass, error) {
	if c.BatchID == 0 {
		return Carcass{}, fmt.Errorf("batch is required")
	}
	if c.PhysicalTag == "" {
		return Carcass{}, fmt.Errorf("physical tag (physical_tag) is required")
	}
	if c.Species == "" {
		c.Species = "ovino"
	}
	c.CreatedAt = nowISO()
	res, err := s.db.Exec(
		`INSERT INTO carcasses
		 (batch_id, physical_tag, animal_id, treatment, species, stratum,
		  fat_thickness_mm, gr_measure_mm, loin_eye_area_cm2, dissection_notes, notes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.BatchID, c.PhysicalTag, c.AnimalID, c.Treatment, c.Species, c.Stratum,
		c.FatThicknessMM, c.GRMeasureMM, c.LoinEyeAreaCM2, c.DissectionNotes, c.Notes, c.CreatedAt,
	)
	if err != nil {
		return Carcass{}, fmt.Errorf("create carcass (duplicate tag in batch?): %w", err)
	}
	c.ID, _ = res.LastInsertId()
	return c, nil
}

// CreateCarcassUniqueTag cria uma carcaça garantindo etiqueta única no lote:
// se a tag já existir, tenta "tag-2", "tag-3", ... Usado no import direto, onde
// a tag inicial vem do nome do arquivo e pode repetir.
func (s *Store) CreateCarcassUniqueTag(c Carcass) (Carcass, error) {
	base := c.PhysicalTag
	if base == "" {
		base = "sem_tag"
	}
	for i := 1; i <= 1000; i++ {
		try := base
		if i > 1 {
			try = fmt.Sprintf("%s-%d", base, i)
		}
		c.PhysicalTag = try
		out, err := s.CreateCarcass(c)
		if err == nil {
			return out, nil
		}
		// só continua tentando se for colisão de UNIQUE; outros erros abortam
		if !isUniqueViolation(err) {
			return Carcass{}, err
		}
	}
	return Carcass{}, fmt.Errorf("could not generate a unique tag for %q", base)
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE") || strings.Contains(msg, "duplicad")
}

// UpdateCarcass atualiza campos editáveis (inclui a referência física R4).
func (s *Store) UpdateCarcass(c Carcass) (Carcass, error) {
	if c.ID == 0 {
		return Carcass{}, fmt.Errorf("carcass id is required")
	}
	if c.PhysicalTag == "" {
		return Carcass{}, fmt.Errorf("physical tag is required")
	}
	_, err := s.db.Exec(
		`UPDATE carcasses SET
		   physical_tag=?, animal_id=?, treatment=?, species=?, stratum=?,
		   fat_thickness_mm=?, gr_measure_mm=?, loin_eye_area_cm2=?,
		   dissection_notes=?, notes=?
		 WHERE id=?`,
		c.PhysicalTag, c.AnimalID, c.Treatment, c.Species, c.Stratum,
		c.FatThicknessMM, c.GRMeasureMM, c.LoinEyeAreaCM2,
		c.DissectionNotes, c.Notes, c.ID,
	)
	if err != nil {
		return Carcass{}, fmt.Errorf("update carcass: %w", err)
	}
	return s.GetCarcass(c.ID)
}

func (s *Store) GetCarcass(id int64) (Carcass, error) {
	var c Carcass
	err := s.db.QueryRow(
		`SELECT id, batch_id, physical_tag, animal_id, treatment, species, stratum,
		        fat_thickness_mm, gr_measure_mm, loin_eye_area_cm2, dissection_notes,
		        notes, created_at
		 FROM carcasses WHERE id=?`, id,
	).Scan(&c.ID, &c.BatchID, &c.PhysicalTag, &c.AnimalID, &c.Treatment, &c.Species,
		&c.Stratum, &c.FatThicknessMM, &c.GRMeasureMM, &c.LoinEyeAreaCM2,
		&c.DissectionNotes, &c.Notes, &c.CreatedAt)
	if err != nil {
		return Carcass{}, fmt.Errorf("fetch carcass: %w", err)
	}
	return c, nil
}

// ListCarcasses lista as carcaças de um lote, com contagem de imagens pareadas.
func (s *Store) ListCarcasses(batchID int64) ([]Carcass, error) {
	rows, err := s.db.Query(
		`SELECT c.id, c.batch_id, c.physical_tag, c.animal_id, c.treatment, c.species,
		        c.stratum, c.fat_thickness_mm, c.gr_measure_mm, c.loin_eye_area_cm2,
		        c.dissection_notes, c.notes, c.created_at,
		        (SELECT COUNT(*) FROM images i WHERE i.carcass_id = c.id) AS image_count
		 FROM carcasses c
		 WHERE c.batch_id = ?
		 ORDER BY c.created_at DESC, c.id DESC`, batchID)
	if err != nil {
		return nil, fmt.Errorf("list carcasses: %w", err)
	}
	defer rows.Close()

	out := []Carcass{}
	for rows.Next() {
		var c Carcass
		if err := rows.Scan(&c.ID, &c.BatchID, &c.PhysicalTag, &c.AnimalID, &c.Treatment,
			&c.Species, &c.Stratum, &c.FatThicknessMM, &c.GRMeasureMM, &c.LoinEyeAreaCM2,
			&c.DissectionNotes, &c.Notes, &c.CreatedAt, &c.ImageCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

// AddImage grava uma imagem JÁ pareada a uma carcaça. carcassID é obrigatório —
// não existe caminho no código que crie imagem sem carcaça.
func (s *Store) AddImage(img Image) (Image, error) {
	if img.CarcassID == 0 {
		return Image{}, fmt.Errorf("carcass_id is required (no pairing, no image)")
	}
	if img.RGBPath == "" {
		return Image{}, fmt.Errorf("image path is required")
	}
	if img.SHA256 == "" {
		return Image{}, fmt.Errorf("sha256 is required")
	}
	if img.CapturedAt == "" {
		img.CapturedAt = nowISO()
	}
	res, err := s.db.Exec(
		`INSERT INTO images
		 (carcass_id, rgb_path, depth_path, source, view, width, height,
		  sha256, imported_from, meta_json, captured_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		img.CarcassID, img.RGBPath, img.DepthPath, img.Source, img.View,
		img.Width, img.Height, img.SHA256, img.ImportedFrom, img.MetaJSON, img.CapturedAt,
	)
	if err != nil {
		return Image{}, fmt.Errorf("save image (duplicate file?): %w", err)
	}
	img.ID, _ = res.LastInsertId()
	return img, nil
}

func (s *Store) ListImages(carcassID int64) ([]Image, error) {
	rows, err := s.db.Query(
		`SELECT id, carcass_id, rgb_path, depth_path, source, view, width, height,
		        sha256, imported_from, meta_json, captured_at
		 FROM images WHERE carcass_id=? ORDER BY captured_at DESC, id DESC`, carcassID)
	if err != nil {
		return nil, fmt.Errorf("list images: %w", err)
	}
	defer rows.Close()

	out := []Image{}
	for rows.Next() {
		var i Image
		if err := rows.Scan(&i.ID, &i.CarcassID, &i.RGBPath, &i.DepthPath, &i.Source,
			&i.View, &i.Width, &i.Height, &i.SHA256, &i.ImportedFrom, &i.MetaJSON,
			&i.CapturedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// GetImage busca uma imagem por id.
func (s *Store) GetImage(id int64) (Image, error) {
	var i Image
	err := s.db.QueryRow(
		`SELECT id, carcass_id, rgb_path, depth_path, source, view, width, height,
		        sha256, imported_from, meta_json, captured_at
		 FROM images WHERE id=?`, id,
	).Scan(&i.ID, &i.CarcassID, &i.RGBPath, &i.DepthPath, &i.Source, &i.View,
		&i.Width, &i.Height, &i.SHA256, &i.ImportedFrom, &i.MetaJSON, &i.CapturedAt)
	if err != nil {
		return Image{}, fmt.Errorf("fetch image: %w", err)
	}
	return i, nil
}

// SHA256Exists checa dedup antes de importar/salvar um arquivo.
func (s *Store) SHA256Exists(sha string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM images WHERE sha256=?`, sha).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
