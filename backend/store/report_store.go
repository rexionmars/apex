package store

// CountAll preenche contagens globais para o readout de telemetria.
func (s *Store) CountAll(batches, carcasses, images, graded *int) {
	s.db.QueryRow(`SELECT COUNT(*) FROM batches`).Scan(batches)
	s.db.QueryRow(`SELECT COUNT(*) FROM carcasses`).Scan(carcasses)
	s.db.QueryRow(`SELECT COUNT(*) FROM images`).Scan(images)
	s.db.QueryRow(`SELECT COUNT(DISTINCT carcass_id) FROM grades`).Scan(graded)
}

// StratumCount conta carcaças por estrato de amostragem (R3).
type StratumCount struct {
	Stratum string `json:"stratum"`
	Count   int    `json:"count"`
}

// BatchProgress resume o progresso de coleta de um lote.
type BatchProgress struct {
	BatchID      int64          `json:"batchId"`
	BatchName    string         `json:"batchName"`
	CarcassCount int            `json:"carcassCount"`
	ImageCount   int            `json:"imageCount"`
	GradedCount  int            `json:"gradedCount"` // carcaças com >=1 nota
	ByStratum    []StratumCount `json:"byStratum"`
}

// BatchProgressReport devolve o progresso de todos os lotes (para o dashboard, R3).
func (s *Store) BatchProgressReport() ([]BatchProgress, error) {
	batches, err := s.ListBatches()
	if err != nil {
		return nil, err
	}
	out := []BatchProgress{}
	for _, b := range batches {
		bp := BatchProgress{BatchID: b.ID, BatchName: b.Name, ByStratum: []StratumCount{}}

		s.db.QueryRow(`SELECT COUNT(*) FROM carcasses WHERE batch_id=?`, b.ID).Scan(&bp.CarcassCount)
		s.db.QueryRow(
			`SELECT COUNT(*) FROM images i JOIN carcasses c ON c.id=i.carcass_id WHERE c.batch_id=?`,
			b.ID).Scan(&bp.ImageCount)
		s.db.QueryRow(
			`SELECT COUNT(DISTINCT g.carcass_id) FROM grades g
			 JOIN carcasses c ON c.id=g.carcass_id WHERE c.batch_id=?`, b.ID).Scan(&bp.GradedCount)

		rows, err := s.db.Query(
			`SELECT CASE WHEN stratum='' THEN '(sem estrato)' ELSE stratum END, COUNT(*)
			 FROM carcasses WHERE batch_id=? GROUP BY stratum ORDER BY 1`, b.ID)
		if err == nil {
			for rows.Next() {
				var sc StratumCount
				if err := rows.Scan(&sc.Stratum, &sc.Count); err == nil {
					bp.ByStratum = append(bp.ByStratum, sc)
				}
			}
			rows.Close()
		}
		out = append(out, bp)
	}
	return out, nil
}

// UnpairedInfo mede imagens sem pareamento. No schema atual toda imagem TEM
// carcass_id (garantia estrutural), então unpaired é sempre 0 — o relatório
// existe para atestar isso explicitamente no dataset exportado.
type UnpairedInfo struct {
	TotalImages int `json:"totalImages"`
	Unpaired    int `json:"unpaired"`
}

func (s *Store) UnpairedReport() (UnpairedInfo, error) {
	var info UnpairedInfo
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&info.TotalImages); err != nil {
		return info, err
	}
	// carcass_id é NOT NULL + FK; contamos órfãos por segurança (deve ser 0).
	s.db.QueryRow(
		`SELECT COUNT(*) FROM images i
		 LEFT JOIN carcasses c ON c.id=i.carcass_id WHERE c.id IS NULL`).Scan(&info.Unpaired)
	return info, nil
}

// ExportRow é uma linha do manifesto: uma imagem com todo o pareamento resolvido.
type ExportRow struct {
	ImageID        int64
	RGBPath        string
	DepthPath      string
	Source         string
	View           string
	SHA256         string
	CarcassID      int64
	PhysicalTag    string
	AnimalID       string
	Treatment      string
	Stratum        string
	Species        string
	FatThicknessMM *float64
	GRMeasureMM    *float64
	LoinEyeAreaCM2 *float64
}

// ExportRows devolve, para um lote (0=todos), uma linha por imagem com o pareamento
// completo. Só imagens de carcaças reais entram (JOIN garante isso).
func (s *Store) ExportRows(batchID int64) ([]ExportRow, error) {
	q := `
		SELECT i.id, i.rgb_path, i.depth_path, i.source, i.view, i.sha256,
		       c.id, c.physical_tag, c.animal_id, c.treatment, c.stratum, c.species,
		       c.fat_thickness_mm, c.gr_measure_mm, c.loin_eye_area_cm2
		FROM images i
		JOIN carcasses c ON c.id = i.carcass_id`
	args := []interface{}{}
	if batchID != 0 {
		q += ` WHERE c.batch_id = ?`
		args = append(args, batchID)
	}
	q += ` ORDER BY c.physical_tag, i.id`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExportRow{}
	for rows.Next() {
		var r ExportRow
		if err := rows.Scan(&r.ImageID, &r.RGBPath, &r.DepthPath, &r.Source, &r.View, &r.SHA256,
			&r.CarcassID, &r.PhysicalTag, &r.AnimalID, &r.Treatment, &r.Stratum, &r.Species,
			&r.FatThicknessMM, &r.GRMeasureMM, &r.LoinEyeAreaCM2); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
