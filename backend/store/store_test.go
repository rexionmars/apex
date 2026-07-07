package store

import (
	"path/filepath"
	"testing"
)

// Testa o núcleo de integridade: pareamento obrigatório, unicidade de etiqueta,
// dedup por sha256, e contagem de imagens.
func TestIntegridadePareamento(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	// Lote
	b, err := st.CreateBatch(Batch{Name: "Lote A", Location: "Frigorífico X"})
	if err != nil {
		t.Fatalf("criar lote: %v", err)
	}
	if b.ID == 0 {
		t.Fatal("lote sem id")
	}

	// Carcaça sem etiqueta -> deve falhar (defesa central)
	if _, err := st.CreateCarcass(Carcass{BatchID: b.ID}); err == nil {
		t.Fatal("esperava erro: carcaça sem etiqueta física")
	}

	// Carcaça válida
	c, err := st.CreateCarcass(Carcass{BatchID: b.ID, PhysicalTag: "10", AnimalID: "A10"})
	if err != nil {
		t.Fatalf("criar carcaça: %v", err)
	}

	// Etiqueta duplicada no mesmo lote -> deve falhar (UNIQUE)
	if _, err := st.CreateCarcass(Carcass{BatchID: b.ID, PhysicalTag: "10"}); err == nil {
		t.Fatal("esperava erro: etiqueta duplicada no lote")
	}

	// Imagem sem carcaça -> deve falhar (não há imagem órfã)
	if _, err := st.AddImage(Image{RGBPath: "x.jpg", SHA256: "abc"}); err == nil {
		t.Fatal("esperava erro: imagem sem carcass_id")
	}

	// Imagem válida, pareada
	img, err := st.AddImage(Image{
		CarcassID: c.ID, RGBPath: "images/x.jpg", Source: "webcam", SHA256: "hash1",
	})
	if err != nil {
		t.Fatalf("gravar imagem: %v", err)
	}
	if img.CarcassID != c.ID {
		t.Fatal("imagem não pareada corretamente")
	}

	// Dedup: mesmo sha256 -> deve falhar
	if _, err := st.AddImage(Image{CarcassID: c.ID, RGBPath: "y.jpg", Source: "import", SHA256: "hash1"}); err == nil {
		t.Fatal("esperava erro: sha256 duplicado (dedup)")
	}

	// SHA256Exists
	if ok, _ := st.SHA256Exists("hash1"); !ok {
		t.Fatal("SHA256Exists deveria achar hash1")
	}
	if ok, _ := st.SHA256Exists("naoexiste"); ok {
		t.Fatal("SHA256Exists não deveria achar hash inexistente")
	}

	// Contagem de imagens na listagem
	list, err := st.ListCarcasses(b.ID)
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(list) != 1 || list[0].ImageCount != 1 {
		t.Fatalf("esperava 1 carcaça com 1 imagem, veio %+v", list)
	}

	// Referência física (R4) via update
	fat := 3.2
	c.FatThicknessMM = &fat
	updated, err := st.UpdateCarcass(c)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.FatThicknessMM == nil || *updated.FatThicknessMM != 3.2 {
		t.Fatal("referência física não persistida")
	}
}

// Testa o import direto: criar carcaças com etiqueta derivada do arquivo, mesmo
// com nomes repetidos (deve gerar tag-2, tag-3, ...).
func TestCreateCarcassUniqueTag(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	b, _ := st.CreateBatch(Batch{Name: "Import"})

	// três "IMG_6194" no mesmo lote -> tags distintas
	tags := map[string]bool{}
	for i := 0; i < 3; i++ {
		c, err := st.CreateCarcassUniqueTag(Carcass{BatchID: b.ID, PhysicalTag: "IMG_6194"})
		if err != nil {
			t.Fatalf("criar %d: %v", i, err)
		}
		if tags[c.PhysicalTag] {
			t.Fatalf("etiqueta repetida: %s", c.PhysicalTag)
		}
		tags[c.PhysicalTag] = true
	}
	if len(tags) != 3 {
		t.Fatalf("esperava 3 etiquetas únicas, veio %v", tags)
	}
	// deve ter gerado IMG_6194, IMG_6194-2, IMG_6194-3
	for _, want := range []string{"IMG_6194", "IMG_6194-2", "IMG_6194-3"} {
		if !tags[want] {
			t.Fatalf("faltou etiqueta %s (veio %v)", want, tags)
		}
	}
}
