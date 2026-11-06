"""Cliente mínimo de las consultas públicas de SATAP (USICAMM).

Solo usa la biblioteca estándar de Python. Las dos aplicaciones públicas que
consulta piden lo mismo que pide el navegador:

1. Abrir la página (da las cookies y el token `_csrf` en un <meta>).
2. Mandar el token en los encabezados `X-CSRF-TOKEN` y `x-xsrf-token`.

No hay HTTPS: el sitio solo responde en http://www03.uscmm.gob.mx:8080.
"""

from __future__ import annotations

import base64
import http.cookiejar
import io
import json
import re
import time
import urllib.error
import urllib.request
import zipfile

BASE = "http://www03.uscmm.gob.mx:8080"
LISTADO = f"{BASE}/ListadoNominalOrdenamiento"
PLAZAS = f"{BASE}/ConsultaPublicaPlazas"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


class SatapError(RuntimeError):
    pass


class Sesion:
    """Una sesión de navegador simulada contra una de las apps de SATAP."""

    def __init__(self, app_url: str, pagina: str = "/", timeout: int = 60):
        self.app_url = app_url
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.referer = app_url + pagina
        html = self._abrir(urllib.request.Request(self.referer, headers=self._headers())).decode(
            "utf-8", "replace"
        )
        m = re.search(r'<meta[^>]*name="_csrf"[^>]*content="([^"]+)"', html)
        if not m:
            raise SatapError(
                f"{self.referer} no trae el token _csrf (¿bloqueo anti-bots?). "
                f"Primeros 300 caracteres: {html[:300]!r}"
            )
        self.token = m.group(1)

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-MX,es;q=0.9",
        }
        if extra:
            h.update(extra)
        return h

    def _abrir(self, req: urllib.request.Request) -> bytes:
        ultimo = None
        for intento in range(3):
            try:
                with self.opener.open(req, timeout=self.timeout) as r:
                    return r.read()
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                ultimo = e
                time.sleep(3 * (intento + 1))
        raise SatapError(f"No se pudo consultar {req.full_url}: {ultimo}")

    def _api(self, metodo: str, ruta: str, cuerpo: dict | None = None):
        datos = None if cuerpo is None else json.dumps(cuerpo).encode()
        req = urllib.request.Request(
            f"{self.app_url}/{ruta}",
            data=datos,
            method=metodo,
            headers=self._headers(
                {
                    "Content-Type": "application/json;charset=UTF-8",
                    "X-CSRF-TOKEN": self.token,
                    "x-xsrf-token": self.token,
                    "Referer": self.referer,
                }
            ),
        )
        crudo = self._abrir(req)
        try:
            resp = json.loads(crudo)
        except json.JSONDecodeError as e:
            raise SatapError(f"{ruta} no regresó JSON: {crudo[:200]!r}") from e
        if not isinstance(resp, dict) or "response" not in resp:
            raise SatapError(f"{ruta} regresó algo inesperado: {str(resp)[:200]}")
        return resp["response"]

    def post(self, ruta: str, cuerpo: dict):
        return self._api("POST", ruta, cuerpo)

    def get(self, ruta: str):
        return self._api("GET", ruta)


# --------------------------------------------------------------------------
# Listado nominal ordenado (el Excel con cada posición y su estatus)
# --------------------------------------------------------------------------


def catalogo_apreciaciones(s: Sesion, entidad: int, ciclo: int, nivel: int = 2, proceso: int = 9):
    return s.post(
        "api/catalogos/catalogoApreciacionesAsignados/read",
        {
            "cveEntidad": entidad,
            "cveEntidadReal": None,
            "cveCicloEscolar": ciclo,
            "cveProcesoEvaluacion": proceso,
            "cveSostenimiento": None,
            "categoriaSegunEvaluacion": None,
            "cveNivelEducativo": nivel,
            "cveSubsistema": None,
            "cveTipoEvaluacion": None,
        },
    )


def descargar_listado(s: Sesion, lista: dict) -> tuple[str, bytes]:
    """Regresa (nombre del archivo oficial, bytes del .xlsx)."""
    r = s.post(
        "api/reportes/reportePersonasAsignadas/read",
        {
            "cveNivelEducativo": lista["nivel"],
            "cveProcesoEvaluacion": lista["proceso"],
            "cveCicloEscolar": lista["ciclo"],
            "cveEntidad": lista["entidad"],
            "cveSostenimiento": None,
            "categoriaSegunEvaluacion": None,
            "cveSubsistema": None,
            "nombreApreciacion": lista["apreciacion"],
            "cveTipoEvaluacion": lista["tipoEvaluacion"],
            "nombreSubsistemas": None,
        },
    )
    if not r or not r.get("cadenaArchivo"):
        raise SatapError(f"El reporte de {lista['id']} vino vacío")
    return r.get("nombreArchivo") or "listado.xlsx", base64.b64decode(r["cadenaArchivo"])


def _texto(xml: str) -> str:
    t = re.sub(r"<[^>]+>", "", xml)
    return (
        t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    )


def leer_xlsx(contenido: bytes, fila_inicio: int = 9) -> tuple[list[dict], dict]:
    """Lee la hoja más grande del Excel. Regresa (filas de datos, encabezado)."""
    z = zipfile.ZipFile(io.BytesIO(contenido))
    try:
        compartidas = [_texto(m) for m in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
    except KeyError:
        compartidas = []
    hojas = [n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)]
    hoja = max(hojas, key=lambda n: z.getinfo(n).file_size)
    xml = z.read(hoja).decode()
    filas, encabezado = [], {}
    for num, cuerpo in re.findall(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        celdas = {}
        for col, attrs, valor in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(?:<v>([^<]*)</v>)?)', cuerpo):
            if not valor:
                continue
            celdas[col] = compartidas[int(valor)] if 't="s"' in attrs else valor
        if int(num) < fila_inicio:
            encabezado[int(num)] = celdas
        else:
            filas.append(celdas)
    return filas, encabezado


# --------------------------------------------------------------------------
# Consulta pública de vacancia y ocupación
# --------------------------------------------------------------------------


def plazas(s: Sesion, lista: dict, estatus: int):
    """estatus: 1 = vacante, 2 = ocupada."""
    return s.post(
        "api/plazas/read",
        {
            "cveCicloEscolar": lista["ciclo"],
            "cveEntidadFederativa": lista["entidad"],
            "cveNivelEducativo": lista["nivel"],
            "cveProcesoEvaluacion": lista["proceso"],
            "cveEstatusPlaza": estatus,
            "cveSubsistema": 0,
            "cveTipoSostenimiento": 0,
            "cveTipoParticipante": 0,
            "cvePuesto": 0,
            "cveTipoFuncion": 0,
            "cveTipoEvaluacion": lista["tipoEvaluacion"],
        },
    ) or []
