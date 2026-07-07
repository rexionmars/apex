package store

import "fmt"

// Analysis é um resultado de inferência persistido.
type Analysis struct {
	ID                int64    `json:"id"`
	ImageID           int64    `json:"imageId"`
	CarcassID         int64    `json:"carcassId"`
	FatPercent        float64  `json:"fatPercent"`
	BackgroundRemoved bool     `json:"backgroundRemoved"`
	ForegroundFrac    float64  `json:"foregroundFrac"`
	FinishingClass    string   `json:"finishingClass"`
	FinishingProbs    string   `json:"finishingProbs"` // JSON
	EGValue           *float64 `json:"egValue"`
	OverlayPath       string   `json:"overlayPath"`
	CarcassPath       string   `json:"carcassPath"`
	GradeExperimental bool     `json:"gradeExperimental"`
	// Conformação (convexidade integral) — medida objetiva; grau estimado NÃO validado.
	ConvPerna         *float64 `json:"convPerna"`
	ConvLombo         *float64 `json:"convLombo"`
	ConvPaleta        *float64 `json:"convPaleta"`
	ConformationIndex *float64 `json:"conformationIndex"`
	ConformationGrade string   `json:"conformationGrade"`
	ConformationConf  *float64 `json:"conformationConf"`
	ConformationMap   string   `json:"conformationMap"`
	AnalyzedAt        string   `json:"analyzedAt"`
	// campos juntados da carcaça (para tabela/estatística), não persistidos aqui:
	PhysicalTag    string   `json:"physicalTag"`
	Stratum        string   `json:"stratum"`
	FatThicknessMM *float64 `json:"fatThicknessMm"`
	GRMeasureMM    *float64 `json:"grMeasureMm"`
	LoinEyeAreaCM2 *float64 `json:"loinEyeAreaCm2"`
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// UpsertAnalysis grava/substitui a análise de uma imagem.
func (s *Store) UpsertAnalysis(a Analysis) (Analysis, error) {
	if a.ImageID == 0 || a.CarcassID == 0 {
		return Analysis{}, fmt.Errorf("image_id and carcass_id are required")
	}
	a.AnalyzedAt = nowISO()
	_, err := s.db.Exec(
		`INSERT INTO analyses
		 (image_id, carcass_id, fat_percent, background_removed, foreground_frac,
		  finishing_class, finishing_probs, eg_value, overlay_path, carcass_path,
		  grade_experimental, conv_perna, conv_lombo, conv_paleta, conformation_index,
		  conformation_grade, conformation_conf, conformation_map, analyzed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(image_id) DO UPDATE SET
		   fat_percent=excluded.fat_percent,
		   background_removed=excluded.background_removed,
		   foreground_frac=excluded.foreground_frac,
		   finishing_class=excluded.finishing_class,
		   finishing_probs=excluded.finishing_probs,
		   eg_value=excluded.eg_value,
		   overlay_path=excluded.overlay_path,
		   carcass_path=excluded.carcass_path,
		   grade_experimental=excluded.grade_experimental,
		   conv_perna=excluded.conv_perna,
		   conv_lombo=excluded.conv_lombo,
		   conv_paleta=excluded.conv_paleta,
		   conformation_index=excluded.conformation_index,
		   conformation_grade=excluded.conformation_grade,
		   conformation_conf=excluded.conformation_conf,
		   conformation_map=excluded.conformation_map,
		   analyzed_at=excluded.analyzed_at`,
		a.ImageID, a.CarcassID, a.FatPercent, b2i(a.BackgroundRemoved), a.ForegroundFrac,
		a.FinishingClass, a.FinishingProbs, a.EGValue, a.OverlayPath, a.CarcassPath,
		b2i(a.GradeExperimental), a.ConvPerna, a.ConvLombo, a.ConvPaleta, a.ConformationIndex,
		a.ConformationGrade, a.ConformationConf, a.ConformationMap, a.AnalyzedAt)
	if err != nil {
		return Analysis{}, fmt.Errorf("save analysis: %w", err)
	}
	return a, nil
}

// scanAnalysisRows lê linhas de análise com os campos juntados da carcaça.
func (s *Store) queryAnalyses(where string, args ...interface{}) ([]Analysis, error) {
	q := `
		SELECT a.id, a.image_id, a.carcass_id, a.fat_percent, a.background_removed,
		       a.foreground_frac, a.finishing_class, a.finishing_probs, a.eg_value,
		       a.overlay_path, a.carcass_path, a.grade_experimental,
		       a.conv_perna, a.conv_lombo, a.conv_paleta, a.conformation_index,
		       a.conformation_grade, a.conformation_conf, a.conformation_map, a.analyzed_at,
		       c.physical_tag, c.stratum, c.fat_thickness_mm, c.gr_measure_mm, c.loin_eye_area_cm2
		FROM analyses a
		JOIN carcasses c ON c.id = a.carcass_id ` + where + `
		ORDER BY c.physical_tag, a.id`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Analysis{}
	for rows.Next() {
		var a Analysis
		var bg, ge int
		if err := rows.Scan(&a.ID, &a.ImageID, &a.CarcassID, &a.FatPercent, &bg,
			&a.ForegroundFrac, &a.FinishingClass, &a.FinishingProbs, &a.EGValue,
			&a.OverlayPath, &a.CarcassPath, &ge,
			&a.ConvPerna, &a.ConvLombo, &a.ConvPaleta, &a.ConformationIndex,
			&a.ConformationGrade, &a.ConformationConf, &a.ConformationMap, &a.AnalyzedAt,
			&a.PhysicalTag, &a.Stratum, &a.FatThicknessMM, &a.GRMeasureMM, &a.LoinEyeAreaCM2); err != nil {
			return nil, err
		}
		a.BackgroundRemoved = bg == 1
		a.GradeExperimental = ge == 1
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListAnalysesByBatch lista as análises das carcaças de um lote (0 = todos).
func (s *Store) ListAnalysesByBatch(batchID int64) ([]Analysis, error) {
	if batchID == 0 {
		return s.queryAnalyses("")
	}
	return s.queryAnalyses("WHERE c.batch_id = ?", batchID)
}

// ImagesToAnalyze devolve os IDs das imagens (source != 'analysis') de um lote
// que ainda NÃO têm análise. Base para o batch incremental.
func (s *Store) ImagesToAnalyze(batchID int64) ([]int64, error) {
	rows, err := s.db.Query(
		`SELECT i.id FROM images i
		 JOIN carcasses c ON c.id = i.carcass_id
		 WHERE c.batch_id = ? AND i.source != 'analysis'
		   AND i.id NOT IN (SELECT image_id FROM analyses)
		 ORDER BY c.physical_tag, i.id`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// AllImagesOfBatch devolve todas as imagens analisáveis de um lote (para re-análise).
func (s *Store) AllImagesOfBatch(batchID int64) ([]int64, error) {
	rows, err := s.db.Query(
		`SELECT i.id FROM images i
		 JOIN carcasses c ON c.id = i.carcass_id
		 WHERE c.batch_id = ? AND i.source != 'analysis'
		 ORDER BY c.physical_tag, i.id`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}