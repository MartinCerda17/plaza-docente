"""Genera site/data/historico/<id>.json con el avance de los ciclos anteriores.

Se corre a mano de vez en cuando (los ciclos pasados ya no cambian):

    python3 scripts/historico.py
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import lista as calc  # noqa: E402
import satap  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent


def main() -> None:
    config = json.loads((RAIZ / "config.json").read_text())
    salida = RAIZ / "site" / "data" / "historico"
    salida.mkdir(parents=True, exist_ok=True)
    s = satap.Sesion(satap.LISTADO)
    for l in config["listas"]:
        ciclos = []
        for c in l["ciclos"][1:]:
            params = l | c
            params["id"] = f"{l['id']}-{c['ciclo']}"
            nombre, xlsx = satap.descargar_listado(s, params)
            filas, _ = satap.leer_xlsx(xlsx)
            r = calc.resumen(filas)
            ciclos.append(
                {
                    "ciclo": c["nombre"],
                    "archivoOficial": nombre,
                    "total": r["total"],
                    "final": r["vanEn"],
                    "maxAlcanzada": r["maxAlcanzada"],
                    "serie": r["serie"],
                }
            )
            print(f"{l['id']} {c['nombre']}: lista de {r['total']}, llegó a {r['vanEn']}", file=sys.stderr)
        (salida / f"{l['id']}.json").write_text(
            json.dumps({"id": l["id"], "ciclos": ciclos}, ensure_ascii=False, separators=(",", ":"))
        )


if __name__ == "__main__":
    main()
