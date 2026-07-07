# Pesos dos modelos

Estes arquivos são grandes e **não são versionados no git** (ver `.gitignore`).
Copie-os do repositório de pesquisa (`carcass_quality/ricardo`) para cá:

| Arquivo | Origem (fase_1/experiments/pipeline_validation/training_runs) | O que é |
|---|---|---|
| `fat_binary.pth` | `fat_binary_20260116_092002/best/best_model.pth` | Segmentação de gordura (ColorNaming + CNN). **Validado**, IoU ~0.92. |
| `direct_class.pth` | `direct_class_20260121_142848/best/best_model.pth` | Grau de acabamento (3 classes). **Experimental** (n=22). |
| `eg_regression.pth` | `eg_regression_20260121_120029/best/best_model.pth` | Regressão EG. **Experimental**. |
| `joost_color_naming.mat` | `data/colornaming_lookup_table/joost_color_naming.mat` | LUT ColorNaming (32768×11). Necessária para todos. |

O sidecar `sidecar/inference.py` procura os pesos aqui (ou em `CARCASS_MODEL_DIR`).
Reconstrói as arquiteturas a partir do `state_dict` e valida com `strict=True`.

## Requisitos de runtime

A inferência precisa de um Python com `torch`, `opencv-python`, `numpy`, `scipy`.
Se o `python3` do sistema não os tiver, defina `CARCASS_PYTHON=/caminho/para/python`
(ex.: o `.venv` do repositório de pesquisa).

Teste rápido:

```bash
CARCASS_MODEL_DIR=./model/weights python3 sidecar/inference.py --selftest
```
