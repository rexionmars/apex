// Package grading calcula concordância inter-avaliador e grau de consenso.
// Requisito R2: o grau só é válido como referência se os avaliadores concordam.
package grading

import "sort"

// CategoryVotes conta, para UM item (carcaça), quantos avaliadores deram cada categoria.
// map[categoria]contagem.
type CategoryVotes map[string]int

// FleissKappa calcula o κ de Fleiss para N itens avaliados por n avaliadores fixos,
// em k categorias. `items` é uma lista de contagens por categoria (uma entrada por item).
// Retorna (kappa, ok). ok=false quando não há dados suficientes (ex.: n<2 ou 1 categoria).
//
// Fórmula clássica (Fleiss, 1971):
//   P_i = (1/(n(n-1))) * (sum_j n_ij^2 - n)
//   P_bar = média dos P_i
//   p_j = (1/(N*n)) * sum_i n_ij ; P_e = sum_j p_j^2
//   kappa = (P_bar - P_e) / (1 - P_e)
func FleissKappa(items []CategoryVotes) (float64, bool) {
	if len(items) == 0 {
		return 0, false
	}

	// coleta o conjunto de categorias e verifica n (avaliadores por item) constante.
	catSet := map[string]bool{}
	n := -1
	for _, it := range items {
		total := 0
		for c, cnt := range it {
			catSet[c] = true
			total += cnt
		}
		if total == 0 {
			return 0, false
		}
		if n == -1 {
			n = total
		} else if total != n {
			// número de avaliadores varia entre itens -> Fleiss clássico não se aplica
			return 0, false
		}
	}
	if n < 2 || len(catSet) < 2 {
		return 0, false
	}

	cats := make([]string, 0, len(catSet))
	for c := range catSet {
		cats = append(cats, c)
	}
	sort.Strings(cats)

	N := float64(len(items))
	nf := float64(n)

	// P_i por item
	var sumPi float64
	for _, it := range items {
		var sumSq float64
		for _, c := range cats {
			v := float64(it[c])
			sumSq += v * v
		}
		Pi := (sumSq - nf) / (nf * (nf - 1))
		sumPi += Pi
	}
	pBar := sumPi / N

	// p_j e P_e
	var Pe float64
	for _, c := range cats {
		var colSum float64
		for _, it := range items {
			colSum += float64(it[c])
		}
		pj := colSum / (N * nf)
		Pe += pj * pj
	}

	if 1-Pe == 0 {
		return 1, true // concordância total e sem variância esperada
	}
	return (pBar - Pe) / (1 - Pe), true
}

// PercentAgreement é a fração de itens em que TODOS os avaliadores concordaram (unânime).
func PercentAgreement(items []CategoryVotes) (float64, bool) {
	if len(items) == 0 {
		return 0, false
	}
	unanime := 0
	for _, it := range items {
		if len(it) == 1 { // todos na mesma categoria
			unanime++
		}
	}
	return float64(unanime) / float64(len(items)), true
}

// Consensus devolve a categoria de maioria e se houve empate.
// Em empate, retorna a categoria alfabeticamente menor e tie=true (o consenso é fraco).
func Consensus(v CategoryVotes) (category string, tie bool) {
	best := -1
	cats := make([]string, 0, len(v))
	for c := range v {
		cats = append(cats, c)
	}
	sort.Strings(cats) // determinismo em empate
	countBest := 0
	for _, c := range cats {
		if v[c] > best {
			best = v[c]
			category = c
			countBest = 1
		} else if v[c] == best {
			countBest++
		}
	}
	return category, countBest > 1
}

// InterpretKappa dá o rótulo qualitativo (Landis & Koch, 1977).
func InterpretKappa(k float64) string {
	switch {
	case k < 0:
		return "pior que o acaso"
	case k < 0.20:
		return "leve"
	case k < 0.40:
		return "razoável"
	case k < 0.60:
		return "moderada"
	case k < 0.80:
		return "substancial"
	default:
		return "quase perfeita"
	}
}
