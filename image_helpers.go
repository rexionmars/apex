package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// stripDataURL remove o prefixo "data:...;base64," se presente, devolvendo só o base64.
func stripDataURL(s string) string {
	if strings.HasPrefix(s, "data:") {
		if i := strings.Index(s, ","); i >= 0 {
			return s[i+1:]
		}
	}
	return s
}

// decodeBase64Image aceita uma string base64 crua ou com prefixo data URL.
func decodeBase64Image(s string) ([]byte, error) {
	if s == "" {
		return nil, fmt.Errorf("imagem vazia")
	}
	if i := strings.Index(s, ","); strings.HasPrefix(s, "data:") && i >= 0 {
		s = s[i+1:]
	}
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decodificar base64: %w", err)
	}
	return data, nil
}

// readAsDataURL lê um arquivo de imagem e o devolve como data URL para o WebView.
func readAsDataURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("ler imagem: %w", err)
	}
	mime := "image/jpeg"
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		mime = "image/png"
	case ".bmp":
		mime = "image/bmp"
	case ".webp":
		mime = "image/webp"
	case ".tif", ".tiff":
		mime = "image/tiff"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
