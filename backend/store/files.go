package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// FileStore gerencia os arquivos de imagem em disco, sob um diretório de dados.
// Layout: <root>/images/batch_<id>/carcass_<tag>/rgb_<uuid>.<ext>
type FileStore struct {
	root string // diretório de dados (contém carcass.db e images/)
}

func NewFileStore(root string) (*FileStore, error) {
	if err := os.MkdirAll(filepath.Join(root, "images"), 0o755); err != nil {
		return nil, fmt.Errorf("create images directory: %w", err)
	}
	return &FileStore{root: root}, nil
}

// Root retorna o diretório de dados.
func (fs *FileStore) Root() string { return fs.root }

// SanitizeTag limpa a etiqueta para uso como nome de pasta (pública para que
// outros pacotes gerem o MESMO caminho de carcaça — evita divergência).
func SanitizeTag(tag string) string { return sanitizeTag(tag) }

// sanitizeTag limpa a etiqueta para uso como nome de pasta.
func sanitizeTag(tag string) string {
	tag = strings.TrimSpace(tag)
	repl := func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return '_'
		}
	}
	tag = strings.Map(repl, tag)
	if tag == "" {
		tag = "sem_tag"
	}
	return tag
}

// SaveBytes grava bytes de imagem no local pareado e devolve (caminho relativo, sha256).
// O caminho é relativo a root para portabilidade do dataset.
func (fs *FileStore) SaveBytes(batchID int64, tag string, data []byte, ext string) (relPath, sha string, err error) {
	sum := sha256.Sum256(data)
	sha = hex.EncodeToString(sum[:])

	if ext == "" {
		ext = ".jpg"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	dir := filepath.Join("images", fmt.Sprintf("batch_%d", batchID), "carcass_"+sanitizeTag(tag))
	if err := os.MkdirAll(filepath.Join(fs.root, dir), 0o755); err != nil {
		return "", "", fmt.Errorf("create carcass folder: %w", err)
	}

	name := "rgb_" + uuid.NewString() + ext
	relPath = filepath.Join(dir, name)
	abs := filepath.Join(fs.root, relPath)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return "", "", fmt.Errorf("write file: %w", err)
	}
	return relPath, sha, nil
}

// CopyFile copia um arquivo externo para o local pareado, devolvendo (relPath, sha256).
// Usado no import de diretórios externos.
func (fs *FileStore) CopyFile(batchID int64, tag, srcPath string) (relPath, sha string, err error) {
	src, err := os.Open(srcPath)
	if err != nil {
		return "", "", fmt.Errorf("open source: %w", err)
	}
	defer src.Close()

	// hash em streaming + buffer para escrever
	h := sha256.New()
	tmp, err := os.CreateTemp(fs.root, ".import-*")
	if err != nil {
		return "", "", fmt.Errorf("temp: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	w := io.MultiWriter(tmp, h)
	if _, err := io.Copy(w, src); err != nil {
		tmp.Close()
		return "", "", fmt.Errorf("copy bytes: %w", err)
	}
	tmp.Close()
	sha = hex.EncodeToString(h.Sum(nil))

	ext := strings.ToLower(filepath.Ext(srcPath))
	if ext == "" {
		ext = ".jpg"
	}
	dir := filepath.Join("images", fmt.Sprintf("batch_%d", batchID), "carcass_"+sanitizeTag(tag))
	if err := os.MkdirAll(filepath.Join(fs.root, dir), 0o755); err != nil {
		return "", "", fmt.Errorf("create carcass folder: %w", err)
	}
	name := "rgb_" + uuid.NewString() + ext
	relPath = filepath.Join(dir, name)
	if err := os.Rename(tmpName, filepath.Join(fs.root, relPath)); err != nil {
		return "", "", fmt.Errorf("move file: %w", err)
	}
	return relPath, sha, nil
}

// HashFile calcula o sha256 de um arquivo sem copiá-lo (para checagem de dedup no scan).
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
