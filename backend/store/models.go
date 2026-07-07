package store

// Modelos espelham as tabelas do schema. Todos os campos são exportados para
// atravessarem o bridge Wails (Go->TS) como interfaces tipadas.

type Batch struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Location    string `json:"location"`
	Operator    string `json:"operator"`
	Notes       string `json:"notes"`
	CollectedAt string `json:"collectedAt"`
	CreatedAt   string `json:"createdAt"`
}

type Carcass struct {
	ID              int64    `json:"id"`
	BatchID         int64    `json:"batchId"`
	PhysicalTag     string   `json:"physicalTag"`
	AnimalID        string   `json:"animalId"`
	Treatment       string   `json:"treatment"`
	Species         string   `json:"species"`
	Stratum         string   `json:"stratum"`
	FatThicknessMM  *float64 `json:"fatThicknessMm"`
	GRMeasureMM     *float64 `json:"grMeasureMm"`
	LoinEyeAreaCM2  *float64 `json:"loinEyeAreaCm2"`
	DissectionNotes string   `json:"dissectionNotes"`
	Notes           string   `json:"notes"`
	CreatedAt       string   `json:"createdAt"`
	// Derivado (não persistido): quantas imagens já pareadas.
	ImageCount int `json:"imageCount"`
}

type Image struct {
	ID           int64  `json:"id"`
	CarcassID    int64  `json:"carcassId"`
	RGBPath      string `json:"rgbPath"`
	DepthPath    string `json:"depthPath"`
	Source       string `json:"source"`
	View         string `json:"view"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	SHA256       string `json:"sha256"`
	ImportedFrom string `json:"importedFrom"`
	MetaJSON     string `json:"metaJson"`
	CapturedAt   string `json:"capturedAt"`
}

type Rater struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

type GradingSession struct {
	ID        int64  `json:"id"`
	RaterID   int64  `json:"raterId"`
	Blind     bool   `json:"blind"`
	StartedAt string `json:"startedAt"`
}

type Grade struct {
	ID           int64  `json:"id"`
	SessionID    int64  `json:"sessionId"`
	CarcassID    int64  `json:"carcassId"`
	Conformation string `json:"conformation"`
	Finishing    string `json:"finishing"`
	Confidence   int    `json:"confidence"`
	GradedAt     string `json:"gradedAt"`
}
