# ¿En qué número va la lista?

Página **no oficial** que sigue el *listado nominal ordenado* de USICAMM (admisión docente en educación básica): en qué número va la asignación de plazas, cómo ha avanzado comparado con ciclos anteriores, qué vacantes hay y dónde verificar todo en los sitios oficiales.

## Cómo funciona

```
GitHub Actions (cada 30 min)
  └─ scripts/actualizar.py
       ├─ SATAP · ListadoNominalOrdenamiento  → Excel con cada posición y su estatus
       ├─ SATAP · ConsultaPublicaPlazas       → vacantes y plazas ocupadas
       ├─ escribe site/data/*.json
       └─ si la lista avanzó → aviso por ntfy.sh
  └─ publica site/ en GitHub Pages
```

- **"La lista va en"** = primera posición con estatus «Persona en listado para su asignación», menos uno.
- El Excel trae la fecha de cada movimiento, así que el avance por fecha se reconstruye en cada consulta; no se guarda historial.
- Los ciclos anteriores (`site/data/historico/`) se generan con `python3 scripts/historico.py` y se suben al repo.
- Solo usa la biblioteca estándar de Python. La página es HTML/JS sin dependencias.
- SATAP no permite consultas desde el navegador de otro sitio (CORS) y solo funciona con `http://`, por eso la consulta la hace el workflow y la página solo lee JSON.

## Enlace personal

La página es genérica. Lo personal va después del `#` (nunca se manda al servidor):

```
https://<usuario>.github.io/plaza-docente/#lista=nl-primaria&lugar=150&avisos=<tema-ntfy>
```

## Secretos del repo (Settings → Secrets and variables → Actions)

| Secreto | Para qué |
|---|---|
| `NTFY_TOPIC` | Tema secreto de ntfy.sh al que llegan los avisos. |
| `AVISAR_LISTA` | Lista a vigilar (`nl-primaria`, `nl-preescolar`, `nl-especial`). |
| `AVISAR_LUGAR` | Posición en esa lista, para decir cuántos lugares faltan y avisar si cambia su estatus. |

Para probar los avisos: Actions → *Actualizar lista* → *Run workflow* → marcar «Mandar una notificación de prueba».

## Agregar otra lista

Agrega un elemento en `config.json` con los códigos del catálogo de SATAP (`cveTipoEvaluacion` y el nombre de la apreciación por ciclo) y corre `scripts/historico.py`.

## En local

```bash
python3 scripts/actualizar.py
cd site && python3 -m http.server 8765
```

## Fuentes oficiales

- [Asignaciones del listado nominal ordenado](http://www03.uscmm.gob.mx:8080/ListadoNominalOrdenamiento/)
- [Consulta pública de vacancia y ocupación](http://www03.uscmm.gob.mx:8080/ConsultaPublicaPlazas/app)
- [Publicación de resultados, admisión EB 2026-2027](http://balanceador-aplicaciones.uscmm.gob.mx/Resultados/consulta.jsp?publicacion=125)
- [Acuerdo de admisión EB 2026-2027](http://usicamm.sep.gob.mx/usicamm_dsk08/2026-2027/compilacion/EB/Acuerdo_Admision_EB.pdf)
- [Portal de transparencia de USICAMM](https://usicamm.sep.gob.mx/transparencia)
