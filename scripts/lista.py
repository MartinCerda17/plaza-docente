"""Cálculos sobre el Excel del listado nominal ordenado.

Regla para "en qué número va la lista": la primera posición cuyo estatus más
reciente es "Persona en listado para su asignación", menos uno. Es decir, el
tramo continuo de posiciones (1, 2, 3, ...) que ya tuvieron algún movimiento
(asignación, rechazo, etc.).

Cada fila del Excel trae la fecha del movimiento (columna T), así que también
se puede reconstruir en qué número iba la lista en cada fecha.
"""

from __future__ import annotations

from collections import Counter, defaultdict

EN_LISTA = "Persona en listado para su asignación"

# Una letra por estatus para mandar el estatus de cada posición en poco espacio.
CODIGOS = {
    "Persona asignada": "A",
    "Persona en listado para su asignación": "L",
    "Persona rechazó plaza": "R",
    "A la maestra o maestro se le eliminó la asignación por error": "E",
    "Persona fue reactivada": "V",
    "La maestra o maestro renuncia a su plaza": "N",
    "Persona tramitó licencia": "C",
    "A la maestra o maestro se le hizo un cambio de plaza": "P",
}
OTRO = "X"


def _fecha(v: str | None) -> str | None:
    """'2026-10-28 08:49:48' -> se queda igual. Ignora valores vacíos."""
    if not v:
        return None
    return v.strip()


def agrupar(filas: list[dict]) -> dict[int, list[dict]]:
    por_pos: dict[int, list[dict]] = defaultdict(list)
    for f in filas:
        if "C" not in f:
            continue
        try:
            pos = int(float(f["C"]))
        except ValueError:
            continue
        por_pos[pos].append(f)
    for movs in por_pos.values():
        # Orden cronológico; las filas sin fecha (en listado) van primero.
        movs.sort(key=lambda f: _fecha(f.get("T")) or "")
    return por_pos


def resumen(filas: list[dict]) -> dict:
    por_pos = agrupar(filas)
    if not por_pos:
        raise ValueError("El Excel no trae posiciones")
    total = max(por_pos)
    ultimo = {p: movs[-1].get("A", "") for p, movs in por_pos.items()}

    # Primera fecha en que cada posición tuvo un movimiento (no "en listado").
    primera: dict[int, str] = {}
    for p, movs in por_pos.items():
        fechas = [_fecha(m.get("T")) for m in movs if m.get("A") != EN_LISTA and _fecha(m.get("T"))]
        if fechas:
            primera[p] = min(fechas)

    # La regla oficial que usamos: primera posición que sigue "en listado", menos uno.
    pendientes = [p for p in range(1, total + 1) if ultimo.get(p, EN_LISTA) == EN_LISTA]
    van_en = (pendientes[0] - 1) if pendientes else total
    max_alcanzada = max(primera) if primera else 0
    # Casos aislados: posiciones después de "van en" que ya tuvieron movimiento
    # (p. ej., una asignación por tiempo fijo muy abajo en la lista).
    adelantados = sorted(p for p in primera if p > van_en)

    # Serie: en qué número iba la lista al cierre de cada día con movimientos.
    dias = sorted({f[:10] for f in primera.values()})
    serie, eventos = [], []
    alcanzadas: set[int] = set()
    frontera = 0
    por_dia: dict[str, list[int]] = defaultdict(list)
    for p, f in primera.items():
        por_dia[f[:10]].append(p)
    movs_por_dia: dict[str, Counter] = defaultdict(Counter)
    for p, movs in por_pos.items():
        for m in movs:
            t = _fecha(m.get("T"))
            if t and m.get("A") != EN_LISTA:
                movs_por_dia[t[:10]][m.get("A", "")] += 1
    for d in dias:
        alcanzadas.update(por_dia[d])
        antes = frontera
        while (frontera + 1) in alcanzadas:
            frontera += 1
        serie.append([d, frontera])
        c = movs_por_dia[d]
        eventos.append(
            {
                "fecha": d,
                "nuevos": len(por_dia[d]),
                "avance": frontera - antes,
                "asignaciones": c.get("Persona asignada", 0),
                "rechazos": c.get("Persona rechazó plaza", 0),
                "correcciones": c.get("A la maestra o maestro se le eliminó la asignación por error", 0),
                "otros": sum(v for k, v in c.items() if k not in (
                    "Persona asignada",
                    "Persona rechazó plaza",
                    "A la maestra o maestro se le eliminó la asignación por error",
                )),
                "vanEn": frontera,
            }
        )

    estatus = "".join(CODIGOS.get(ultimo.get(p, EN_LISTA), OTRO) for p in range(1, total + 1))
    conteo = Counter(ultimo.values())
    ultimo_mov = max((_fecha(m.get("T")) for movs in por_pos.values() for m in movs if _fecha(m.get("T"))), default=None)

    # Tipo de plaza (definitiva/temporal) de las asignaciones vigentes de la lista.
    tipos = Counter()
    for p, movs in por_pos.items():
        if movs[-1].get("A") == "Persona asignada":
            tipos[movs[-1].get("O") or movs[-1].get("F") or "Sin dato"] += 1

    return {
        "total": total,
        "vanEn": van_en,
        "siguiente": van_en + 1 if van_en < total else None,
        "maxAlcanzada": max_alcanzada,
        "adelantados": adelantados[:50],
        "conteo": dict(conteo.most_common()),
        "asignacionesPorTipo": dict(tipos.most_common()),
        "ultimoMovimiento": ultimo_mov,
        "serie": serie,
        "eventos": eventos,
        "estatus": estatus,
        "codigos": {v: k for k, v in CODIGOS.items()} | {OTRO: "Otro estatus"},
    }


def _fecha_dmy(v: str | None) -> str | None:
    """'05-11-2026 12:16:15 PM' -> '2026-11-05 12:16'. '16-10-2026' -> '2026-10-16'."""
    if not v:
        return None
    partes = v.split()
    d = partes[0].split("-")
    if len(d) != 3:
        return v
    iso = f"{d[2]}-{d[1]}-{d[0]}"
    if len(partes) >= 2:
        hh, mm = partes[1].split(":")[:2]
        h = int(hh)
        if len(partes) >= 3:
            if partes[2].upper() == "PM" and h != 12:
                h += 12
            if partes[2].upper() == "AM" and h == 12:
                h = 0
        iso += f" {h:02d}:{mm}"
    return iso


def _municipio(direccion: str | None) -> str | None:
    if not direccion:
        return None
    # "CALLE ROBLE,  GENERAL ESCOBEDO NUEVO LEÓN0 C.P. 66073" -> "GENERAL ESCOBEDO"
    resto = direccion.split(",", 1)[-1]
    resto = resto.split("NUEVO LEÓN")[0]
    return " ".join(resto.split()).title() or None


def resumen_plazas(vacantes: list[dict], ocupadas: list[dict]) -> dict:
    lista = []
    for v in vacantes:
        for p in v.get("plazas") or [v]:
            lista.append(
                {
                    "plaza": p.get("cvePlaza") or v.get("llavePlaza"),
                    "tipo": p.get("tipoVacante") or v.get("tipoVacante"),
                    "motivo": p.get("estatus") or v.get("estatus"),
                    "categoria": p.get("categoria") or v.get("categoria"),
                    "tipoPlaza": p.get("tipoPlaza"),
                    "horas": p.get("horas"),
                    "sostenimiento": p.get("sostenimiento") or v.get("sostenimiento"),
                    "escuela": p.get("nombreCct"),
                    "cct": p.get("cctDondeTrabaja"),
                    "municipio": _municipio(p.get("direccionCct")),
                    "turno": p.get("turno"),
                    "inicio": _fecha_dmy(p.get("fechaInicioVacancia")),
                    "fin": _fecha_dmy(p.get("fechaFinVacancia")),
                    "cargada": _fecha_dmy(p.get("fechaCarga")),
                }
            )
    lista.sort(key=lambda x: x.get("cargada") or "", reverse=True)
    por_origen = Counter()
    for o in ocupadas:
        por_origen[(o.get("tipoLista") or "Sin dato", o.get("tipoVacante") or "Sin dato")] += 1
    return {
        "vacantes": lista,
        "vacantesPorTipo": dict(Counter(x["tipo"] or "Sin dato" for x in lista).most_common()),
        "ocupadas": len(ocupadas),
        "ocupadasPorOrigen": [
            {"origen": k[0], "tipo": k[1], "n": n} for k, n in por_origen.most_common()
        ],
    }
