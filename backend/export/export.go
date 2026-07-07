// Package export gera o dataset final: manifesto (uma linha por imagem, com o
// pareamento completo) + relatório de integridade. Só carcaças com pareamento
// verificado entram — é o artefato que atesta que a falha da coleta anterior
// (pareamento reconstruído por nome de arquivo) não se repetiu.
package export

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"carcass_integration/backend/store"
)

// Consensus associa, por carcaça, o grau de consenso e se houve empate.
type Consensus struct {
	Conformation string
	ConfTie      bool
	Finishing    string
	FinTie       bool
	RaterCount   int
}

// Result resume o que foi exportado.
type Result struct {
	Dir               string `json:"dir"`
	ManifestPath      string `json:"manifestPath"`
	ReportPath        string `json:"reportPath"`
	CarcassesExported int    `json:"carcassesExported"`
	ImagesExported    int    `json:"imagesExported"`
}

func f(p *float64) string {
	if p == nil {
		return ""
	}
	return strconv.FormatFloat(*p, 'f', -1, 64)
}

// WriteManifest grava o CSV do dataset em outDir. Se onlyWithConsensus, exclui
// carcaças sem grau de consenso (nenhum avaliador ou empate).
func WriteManifest(outDir string, rows []store.ExportRow, cons map[int64]Consensus, onlyWithConsensus bool) (Result, error) {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return Result{}, err
	}
	manifestPath := filepath.Join(outDir, "manifest.csv")
	mf, err := os.Create(manifestPath)
	if err != nil {
		return Result{}, err
	}
	defer mf.Close()

	w := csv.NewWriter(mf)
	header := []string{
		"image_id", "rgb_path", "depth_path", "source", "view", "sha256",
		"carcass_id", "physical_tag", "animal_id", "treatment", "stratum", "species",
		"conformation_consensus", "conformation_tie",
		"finishing_consensus", "finishing_tie", "rater_count",
		"fat_thickness_mm", "gr_measure_mm", "loin_eye_area_cm2",
	}
	if err := w.Write(header); err != nil {
		return Result{}, err
	}

	carcasses := map[int64]bool{}
	imgCount := 0
	for _, r := range rows {
		c := cons[r.CarcassID]
		hasConsensus := c.Conformation != "" || c.Finishing != ""
		if onlyWithConsensus && !hasConsensus {
			continue
		}
		rec := []string{
			strconv.FormatInt(r.ImageID, 10), r.RGBPath, r.DepthPath, r.Source, r.View, r.SHA256,
			strconv.FormatInt(r.CarcassID, 10), r.PhysicalTag, r.AnimalID, r.Treatment, r.Stratum, r.Species,
			c.Conformation, strconv.FormatBool(c.ConfTie),
			c.Finishing, strconv.FormatBool(c.FinTie), strconv.Itoa(c.RaterCount),
			f(r.FatThicknessMM), f(r.GRMeasureMM), f(r.LoinEyeAreaCM2),
		}
		if err := w.Write(rec); err != nil {
			return Result{}, err
		}
		carcasses[r.CarcassID] = true
		imgCount++
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return Result{}, err
	}

	return Result{
		Dir:               outDir,
		ManifestPath:      manifestPath,
		CarcassesExported: len(carcasses),
		ImagesExported:    imgCount,
	}, nil
}

// WriteReport grava o relatório de integridade legível.
func WriteReport(outDir string, res Result, unpaired store.UnpairedInfo, confLabel, finLabel string, confKappa, finKappa float64, generatedAt string) (string, error) {
	reportPath := filepath.Join(outDir, "integrity_report.txt")
	body := fmt.Sprintf(`RELATÓRIO DE INTEGRIDADE — Dataset de carcaças (iCEV)
Gerado em: %s

PAREAMENTO
  Toda imagem exportada tem carcaça associada, gravada no momento da coleta.
  Imagens órfãs (sem carcaça) no banco: %d de %d.
  O pareamento NÃO foi reconstruído por nome de arquivo — vem do banco.

EXPORTAÇÃO
  Carcaças exportadas: %d
  Imagens exportadas:  %d

CONCORDÂNCIA INTER-AVALIADOR (κ de Fleiss)
  Conformação: κ = %.3f (%s)
  Acabamento:  κ = %.3f (%s)
  Obs.: o acabamento (cobertura de gordura) é uma propriedade de profundidade,
  de validação preditiva limitada por imagem de superfície; requer referência
  física (espessura de gordura / GR / área de olho de lombo) nos mesmos animais.

ARQUIVOS
  manifest.csv        — uma linha por imagem, com o pareamento completo.
  integrity_report.txt — este arquivo.
`,
		generatedAt, unpaired.Unpaired, unpaired.TotalImages,
		res.CarcassesExported, res.ImagesExported,
		confKappa, confLabel, finKappa, finLabel)

	if err := os.WriteFile(reportPath, []byte(body), 0o644); err != nil {
		return "", err
	}
	return reportPath, nil
}
