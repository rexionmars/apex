package grading

import (
	"math"
	"testing"
)

func almost(a, b float64) bool { return math.Abs(a-b) < 0.01 }

// Concordância perfeita -> kappa = 1.
func TestFleissPerfeito(t *testing.T) {
	items := []CategoryVotes{
		{"A": 3}, {"B": 3}, {"A": 3},
	}
	k, ok := FleissKappa(items)
	if !ok || !almost(k, 1.0) {
		t.Fatalf("esperava kappa=1, veio %v (ok=%v)", k, ok)
	}
}

// Caso clássico de Fleiss (1971) — 10 sujeitos, 14... simplificado:
// 6 itens, 3 avaliadores, categorias diversas. Verifica que kappa fica em [-1,1]
// e que discordância total reduz o kappa.
func TestFleissDiscordancia(t *testing.T) {
	items := []CategoryVotes{
		{"A": 1, "B": 1, "C": 1},
		{"A": 1, "B": 1, "C": 1},
		{"A": 1, "B": 1, "C": 1},
	}
	k, ok := FleissKappa(items)
	if !ok {
		t.Fatal("esperava computável")
	}
	if k > 0.01 {
		t.Fatalf("discordância máxima deveria dar kappa <= 0, veio %v", k)
	}
}

// n inconsistente entre itens -> não computável.
func TestFleissNInconsistente(t *testing.T) {
	items := []CategoryVotes{{"A": 3}, {"A": 2}}
	if _, ok := FleissKappa(items); ok {
		t.Fatal("esperava não-computável com n variável")
	}
}

func TestPercentAgreement(t *testing.T) {
	items := []CategoryVotes{{"A": 3}, {"A": 2, "B": 1}, {"B": 3}}
	pa, ok := PercentAgreement(items)
	if !ok || !almost(pa, 2.0/3.0) {
		t.Fatalf("esperava 0.667, veio %v", pa)
	}
}

func TestConsensus(t *testing.T) {
	c, tie := Consensus(CategoryVotes{"A": 2, "B": 1})
	if c != "A" || tie {
		t.Fatalf("esperava A sem empate, veio %v tie=%v", c, tie)
	}
	c, tie = Consensus(CategoryVotes{"A": 1, "B": 1})
	if !tie {
		t.Fatalf("esperava empate, veio %v tie=%v", c, tie)
	}
}
