// Package importer varre diretórios externos de imagens. O ponto crítico: uma
// imagem importada NÃO entra no dataset até ser conciliada a uma carcaça. Isso
// transforma o modo de falha da coleta anterior (imagens órfãs viram vínculos
// inventados) num estado explícito que o operador tem que resolver.
package importer

import (
	"os"
	"path/filepath"
	"strings"

	"carcass_integration/backend/store"
)

// ScannedFile é uma imagem encontrada num diretório externo, ainda NÃO pareada.
type ScannedFile struct {
	Path       string `json:"path"`       // caminho absoluto de origem
	Name       string `json:"name"`       // nome do arquivo
	SizeBytes  int64  `json:"sizeBytes"`
	SHA256     string `json:"sha256"`
	Duplicate  bool   `json:"duplicate"`  // já existe no banco (mesmo sha)
	Ext        string `json:"ext"`
}

var imageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".bmp": true,
	".tif": true, ".tiff": true, ".webp": true,
}

// ScanDir percorre recursivamente um diretório e retorna as imagens encontradas,
// marcando as que já existem no banco (dedup por sha256).
func ScanDir(dir string, st *store.Store) ([]ScannedFile, error) {
	out := []ScannedFile{} // nunca nil
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // ignora arquivos ilegíveis, continua a varredura
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if !imageExts[ext] {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		sha, err := store.HashFile(path)
		if err != nil {
			return nil
		}
		dup, _ := st.SHA256Exists(sha)
		out = append(out, ScannedFile{
			Path:      path,
			Name:      d.Name(),
			SizeBytes: info.Size(),
			SHA256:    sha,
			Duplicate: dup,
			Ext:       ext,
		})
		return nil
	})
	return out, err
}
