package store

import "fmt"

// ---------------------------------------------------------------------------
// Raters
// ---------------------------------------------------------------------------

func (s *Store) CreateRater(r Rater) (Rater, error) {
	if r.Name == "" {
		return Rater{}, fmt.Errorf("rater name is required")
	}
	r.CreatedAt = nowISO()
	res, err := s.db.Exec(
		`INSERT INTO raters (name, role, created_at) VALUES (?, ?, ?)`,
		r.Name, r.Role, r.CreatedAt)
	if err != nil {
		return Rater{}, fmt.Errorf("create rater: %w", err)
	}
	r.ID, _ = res.LastInsertId()
	return r, nil
}

func (s *Store) ListRaters() ([]Rater, error) {
	rows, err := s.db.Query(`SELECT id, name, role, created_at FROM raters ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Rater{}
	for rows.Next() {
		var r Rater
		if err := rows.Scan(&r.ID, &r.Name, &r.Role, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Grading sessions
// ---------------------------------------------------------------------------

// StartSession abre uma sessão cega para um avaliador.
func (s *Store) StartSession(raterID int64, blind bool) (GradingSession, error) {
	if raterID == 0 {
		return GradingSession{}, fmt.Errorf("rater is required")
	}
	b := 0
	if blind {
		b = 1
	}
	now := nowISO()
	res, err := s.db.Exec(
		`INSERT INTO grading_sessions (rater_id, blind, started_at) VALUES (?, ?, ?)`,
		raterID, b, now)
	if err != nil {
		return GradingSession{}, fmt.Errorf("start session: %w", err)
	}
	id, _ := res.LastInsertId()
	return GradingSession{ID: id, RaterID: raterID, Blind: blind, StartedAt: now}, nil
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

// UpsertGrade grava/atualiza a nota de uma carcaça numa sessão (independente/cega).
func (s *Store) UpsertGrade(g Grade) (Grade, error) {
	if g.SessionID == 0 || g.CarcassID == 0 {
		return Grade{}, fmt.Errorf("session and carcass are required")
	}
	g.GradedAt = nowISO()
	_, err := s.db.Exec(
		`INSERT INTO grades (session_id, carcass_id, conformation, finishing, confidence, graded_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(session_id, carcass_id) DO UPDATE SET
		   conformation=excluded.conformation,
		   finishing=excluded.finishing,
		   confidence=excluded.confidence,
		   graded_at=excluded.graded_at`,
		g.SessionID, g.CarcassID, g.Conformation, g.Finishing, g.Confidence, g.GradedAt)
	if err != nil {
		return Grade{}, fmt.Errorf("save grade: %w", err)
	}
	return g, nil
}

// GradesForSession devolve as notas já dadas numa sessão (para retomar).
func (s *Store) GradesForSession(sessionID int64) (map[int64]Grade, error) {
	rows, err := s.db.Query(
		`SELECT id, session_id, carcass_id, conformation, finishing, confidence, graded_at
		 FROM grades WHERE session_id=?`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]Grade{}
	for rows.Next() {
		var g Grade
		if err := rows.Scan(&g.ID, &g.SessionID, &g.CarcassID, &g.Conformation,
			&g.Finishing, &g.Confidence, &g.GradedAt); err != nil {
			return nil, err
		}
		out[g.CarcassID] = g
	}
	return out, rows.Err()
}

// CarcassGradeRow agrega, por carcaça, os votos de todos os avaliadores num eixo.
type CarcassGradeRow struct {
	CarcassID     int64             `json:"carcassId"`
	PhysicalTag   string            `json:"physicalTag"`
	RaterCount    int               `json:"raterCount"`
	Conformation  map[string]int    `json:"conformation"` // categoria -> nº de votos
	Finishing     map[string]int    `json:"finishing"`
}

// GradesByCarcass agrega todas as notas por carcaça de um lote (ou todos, se batchID=0),
// contando avaliadores DISTINTOS por categoria em cada eixo. Base para a concordância.
func (s *Store) GradesByCarcass(batchID int64) ([]CarcassGradeRow, error) {
	q := `
		SELECT c.id, c.physical_tag, g.conformation, g.finishing
		FROM grades g
		JOIN carcasses c ON c.id = g.carcass_id`
	args := []interface{}{}
	if batchID != 0 {
		q += ` WHERE c.batch_id = ?`
		args = append(args, batchID)
	}
	q += ` ORDER BY c.id`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*CarcassGradeRow{}
	order := []int64{}
	for rows.Next() {
		var cid int64
		var tag, conf, fin string
		if err := rows.Scan(&cid, &tag, &conf, &fin); err != nil {
			return nil, err
		}
		r, ok := byID[cid]
		if !ok {
			r = &CarcassGradeRow{
				CarcassID: cid, PhysicalTag: tag,
				Conformation: map[string]int{}, Finishing: map[string]int{},
			}
			byID[cid] = r
			order = append(order, cid)
		}
		r.RaterCount++
		if conf != "" {
			r.Conformation[conf]++
		}
		if fin != "" {
			r.Finishing[fin]++
		}
	}
	out := make([]CarcassGradeRow, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, rows.Err()
}
