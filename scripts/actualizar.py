"""Consulta SATAP, escribe site/data/*.json y avisa por ntfy si la lista avanzó.

Variables de entorno (todas opcionales):

- PAGES_URL      URL pública de la página (para leer la consulta anterior y
                 armar el enlace de la notificación).
- NTFY_TOPIC     tema secreto de ntfy.sh al que se mandan los avisos.
- NTFY_SERVER    servidor de ntfy (por omisión https://ntfy.sh).
- AVISAR_LISTA   id de la lista a vigilar (por omisión nl-primaria).
- AVISAR_LUGAR   posición de la persona en esa lista (p. ej. 150).
- NTFY_PRUEBA    si vale "1", manda un aviso de prueba con el estado actual.

Uso local:  python3 scripts/actualizar.py
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
import traceback
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import lista as calc  # noqa: E402
import satap  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DATOS = RAIZ / "site" / "data"


def ahora() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def leer_anterior(pages_url: str | None, nombre: str) -> dict | None:
    if not pages_url:
        return None
    url = f"{pages_url.rstrip('/')}/data/{nombre}?t={int(dt.datetime.now().timestamp())}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-cache"}), timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:  # primera publicación, o Pages caído
        print(f"(sin consulta anterior de {nombre}: {e})", file=sys.stderr)
        return None


def consultar_lista(l: dict, s_listado: satap.Sesion, s_plazas: satap.Sesion | None) -> dict:
    c = l["ciclos"][0]
    params = l | c
    nombre, xlsx = satap.descargar_listado(s_listado, params)
    filas, _ = satap.leer_xlsx(xlsx)
    r = calc.resumen(filas)
    (DATOS / f"{l['id']}.xlsx").write_bytes(xlsx)

    plazas = None
    if s_plazas is not None:
        try:
            plazas = calc.resumen_plazas(satap.plazas(s_plazas, params, 1), satap.plazas(s_plazas, params, 2))
            plazas["consultadoEn"] = ahora()
        except Exception as e:
            print(f"Vacantes de {l['id']}: {e}", file=sys.stderr)

    return {
        "v": 1,
        "id": l["id"],
        "nombre": l["nombre"],
        "entidad": l["entidadNombre"],
        "nivel": l["nivelNombre"],
        "proceso": l["procesoNombre"],
        "ciclo": c["nombre"],
        "apreciacion": c["apreciacion"],
        "vence": c.get("vence"),
        "consultadoEn": ahora(),
        "archivoOficial": nombre,
        "copiaArchivo": f"data/{l['id']}.xlsx",
        **r,
        "plazas": plazas,
    }


MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def fecha_bonita(t: str | None) -> str:
    """'2026-10-28 08:49:48' -> '28 oct 2026, 08:49'."""
    if not t:
        return ""
    try:
        d, h = (t.split(" ") + [""])[:2]
        y, m, dd = d.split("-")
        return f"{int(dd)} {MESES[int(m) - 1]} {y}" + (f", {h[:5]}" if h else "")
    except (ValueError, IndexError):
        return t


def ntfy(titulo: str, mensaje: str, click: str | None, tags: list[str], prioridad: int = 3) -> None:
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        print(f"(sin NTFY_TOPIC; no se avisa) {titulo}: {mensaje}", file=sys.stderr)
        return
    cuerpo = {"topic": topic, "title": titulo, "message": mensaje, "tags": tags, "priority": prioridad}
    if click:
        cuerpo["click"] = click
    req = urllib.request.Request(
        os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
        data=json.dumps(cuerpo).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()
    print("Aviso enviado.", file=sys.stderr)


def avisar(nuevo: dict, anterior: dict | None, pages_url: str | None) -> None:
    lugar_txt = os.environ.get("AVISAR_LUGAR", "").strip()
    lugar = int(lugar_txt) if lugar_txt.isdigit() else None
    click = None
    if pages_url:
        click = f"{pages_url.rstrip('/')}/#{nuevo['id']}" + (f"/{lugar}" if lugar else "")

    van = nuevo["vanEn"]
    antes_de_ti = (lugar - van - 1) if lugar else None
    if antes_de_ti is None or antes_de_ti < 0:
        falta = ""
    elif antes_de_ti == 0:
        falta = " ¡Sigues tú!"
    else:
        falta = f" Hay {antes_de_ti} {'persona' if antes_de_ti == 1 else 'personas'} antes que tú ({lugar})."
    cuando = fecha_bonita(nuevo.get("ultimoMovimiento"))

    if os.environ.get("NTFY_PRUEBA") == "1":
        ntfy(
            f"Prueba: la lista va en {van}",
            f"{nuevo['nombre']} · {nuevo['entidad']} {nuevo['ciclo']}. Último movimiento: {cuando}.{falta}",
            click,
            ["white_check_mark"],
        )
        return
    if anterior is None:
        return

    antes = anterior.get("vanEn") or 0
    mi_antes = mi_ahora = None
    if lugar:
        e_ant, e_new = anterior.get("estatus") or "", nuevo.get("estatus") or ""
        cod = nuevo.get("codigos", {})
        mi_antes = cod.get(e_ant[lugar - 1]) if len(e_ant) >= lugar else None
        mi_ahora = cod.get(e_new[lugar - 1]) if len(e_new) >= lugar else None

    if lugar and mi_ahora and mi_antes and mi_ahora != mi_antes:
        ntfy(
            "Cambió tu estatus en la lista",
            f"Lugar {lugar}: ahora dice «{mi_ahora}» (antes «{mi_antes}»). Revísalo en el sitio oficial.",
            click,
            ["tada" if mi_ahora == "Persona asignada" else "warning"],
            5,
        )
    if van > antes:
        llego = lugar and van >= lugar - 1 and antes < lugar - 1
        ntfy(
            ("¡La lista llegó a tu lugar!" if llego else f"La lista avanzó: va en {van}"),
            f"{nuevo['nombre']} {nuevo['entidad']}: de {antes} a {van} (+{van - antes}).{falta}"
            + (f" Último movimiento: {cuando}." if cuando else ""),
            click,
            ["tada"] if llego else ["chart_with_upwards_trend"],
            5 if llego else 4,
        )
    elif van < antes:
        print(f"Ojo: {nuevo['id']} bajó de {antes} a {van} (corrección en SATAP)", file=sys.stderr)


def main() -> int:
    config = json.loads((RAIZ / "config.json").read_text())
    DATOS.mkdir(parents=True, exist_ok=True)
    pages_url = os.environ.get("PAGES_URL") or None
    vigilada = os.environ.get("AVISAR_LISTA") or "nl-primaria"

    s_listado = satap.Sesion(satap.LISTADO)
    try:
        s_plazas = satap.Sesion(satap.PLAZAS, "/app")
    except Exception as e:
        print(f"No se pudo abrir la consulta de vacantes: {e}", file=sys.stderr)
        s_plazas = None

    indice, fallas = [], 0
    for l in config["listas"]:
        anterior = leer_anterior(pages_url, f"{l['id']}.json")
        try:
            nuevo = consultar_lista(l, s_listado, s_plazas)
            print(f"{l['id']}: van en {nuevo['vanEn']} de {nuevo['total']}", file=sys.stderr)
        except Exception:
            fallas += 1
            traceback.print_exc()
            if not anterior:
                continue
            nuevo = anterior | {"errorUltimaConsulta": ahora()}
        (DATOS / f"{l['id']}.json").write_text(json.dumps(nuevo, ensure_ascii=False, separators=(",", ":")))
        indice.append({"id": l["id"], "nombre": l["nombre"], "entidad": l["entidadNombre"], "ciclo": l["ciclos"][0]["nombre"]})
        if l["id"] == vigilada and "errorUltimaConsulta" not in nuevo:
            try:
                avisar(nuevo, anterior, pages_url)
            except Exception:
                traceback.print_exc()

    (DATOS / "listas.json").write_text(
        json.dumps({"consultadoEn": ahora(), "listas": indice}, ensure_ascii=False, separators=(",", ":"))
    )
    if fallas == len(config["listas"]):
        print("Falló la consulta de todas las listas.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
