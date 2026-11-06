/* ¿En qué número va la lista? — lógica de la página.
 * Lee data/listas.json, data/<id>.json y data/historico/<id>.json (generados por
 * scripts/actualizar.py en GitHub Actions) y pinta todo. Los datos de SATAP se
 * tratan como texto no confiable: siempre se insertan con textContent.
 */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const fmtN = new Intl.NumberFormat("es-MX");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const REPO = "https://github.com/MartinCerda17/plaza-docente";

  const estado = { listas: [], listaId: null, lugar: null, avisos: null, datos: null, historico: null, cargando: false };

  // ---------------------------------------------------------------- utilidades
  function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of hijos.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function s(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    return el;
  }
  const n = (x) => fmtN.format(x);

  // "2026-10-28 08:49:48" o "2026-10-28" -> Date local (hora de NL tal cual la da SATAP)
  function fechaLocal(t) {
    if (!t) return null;
    const [d, hr] = t.split(" ");
    const [y, m, dd] = d.split("-").map(Number);
    const [hh, mm] = (hr || "0:0").split(":").map(Number);
    return new Date(y, m - 1, dd, hh || 0, mm || 0);
  }
  function fCorta(dt, conAnio) {
    if (!dt) return "—";
    return `${dt.getDate()} ${MESES[dt.getMonth()]}${conAnio ? " " + dt.getFullYear() : ""}`;
  }
  function fLarga(dt) {
    return `${dt.getDate()} de ${MESES_LARGOS[dt.getMonth()]} de ${dt.getFullYear()}`;
  }
  function hora(dt) {
    return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  }
  function hace(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    const d = Math.round(hrs / 24);
    return `hace ${d} día${d === 1 ? "" : "s"}`;
  }
  function diasEntre(a, b) {
    const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  }
  // Día dentro del ciclo: 0 = 1 de agosto del primer año del ciclo.
  function inicioCiclo(ciclo) {
    return new Date(Number(ciclo.slice(0, 4)), 7, 1);
  }
  function cicloCorto(ciclo) {
    return `${ciclo.slice(0, 4)}-${ciclo.slice(7, 9)}`;
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ }
  }
  function leer(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }
  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("on"), 2600);
  }

  // ------------------------------------------------------------ enlace / hash
  // Formatos: #lista=nl-primaria&lugar=352&avisos=TEMA   o   #nl-primaria/352
  function leerHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
    const out = {};
    if (!raw) return out;
    if (raw.includes("=")) {
      for (const par of raw.split("&")) {
        const [k, v] = par.split("=");
        if (k && v) out[k] = v;
      }
    } else {
      const [a, b, c] = raw.split("/");
      if (/^\d+$/.test(a)) out.lugar = a;
      else { out.lista = a; if (b) out.lugar = b; if (c) out.avisos = c; }
    }
    return out;
  }
  function escribirHash() {
    const p = [];
    if (estado.listaId) p.push(`lista=${estado.listaId}`);
    if (estado.lugar) p.push(`lugar=${estado.lugar}`);
    if (estado.avisos) p.push(`avisos=${estado.avisos}`);
    history.replaceState(null, "", p.length ? `#${p.join("&")}` : location.pathname);
  }

  // ------------------------------------------------------------------- datos
  async function getJSON(url) {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  async function cargar(manual) {
    if (estado.cargando) return;
    estado.cargando = true;
    const btn = $("#btn-actualizar");
    btn.classList.add("spin");
    document.body.classList.add("loading");
    const antes = estado.datos ? `${estado.datos.consultadoEn}|${estado.datos.vanEn}` : null;
    try {
      const idx = await getJSON("data/listas.json");
      estado.listas = idx.listas || [];
      if (!estado.listaId || !estado.listas.some((l) => l.id === estado.listaId)) {
        estado.listaId = estado.listas[0] && estado.listas[0].id;
      }
      llenarSelect();
      const [datos, hist] = await Promise.all([
        getJSON(`data/${estado.listaId}.json`),
        getJSON(`data/historico/${estado.listaId}.json`).catch(() => null),
      ]);
      const avanzo = estado.datos && estado.datos.id === datos.id && datos.vanEn > estado.datos.vanEn;
      estado.datos = datos;
      estado.historico = hist;
      pintar();
      if (manual) {
        const ahora = `${datos.consultadoEn}|${datos.vanEn}`;
        if (avanzo) toast(`¡Avanzó! Ahora va en ${n(datos.vanEn)}`);
        else if (ahora === antes) toast(`Sin cambios · última consulta a SATAP ${hace(datos.consultadoEn)}`);
        else toast(`Actualizado · consulta a SATAP ${hace(datos.consultadoEn)}`);
      }
    } catch (e) {
      console.error(e);
      toast("No se pudo cargar. Revisa tu conexión e intenta de nuevo.");
      if (!estado.datos) $("#hero").replaceChildren(h("p", { class: "label", text: "No se pudieron cargar los datos. Intenta de nuevo en un momento." }));
    } finally {
      estado.cargando = false;
      btn.classList.remove("spin");
      document.body.classList.remove("loading");
    }
  }

  function llenarSelect() {
    const sel = $("#sel-lista");
    const actual = sel.value;
    if (sel.options.length !== estado.listas.length || actual !== estado.listaId) {
      sel.replaceChildren(...estado.listas.map((l) => h("option", { value: l.id, text: `${l.nombre} · ${l.entidad} · ${l.ciclo}` })));
      sel.value = estado.listaId;
    }
  }

  // ------------------------------------------------------------------ pintar
  function estatusDe(d, lugar) {
    if (!lugar || !d.estatus || lugar > d.estatus.length) return null;
    return d.codigos[d.estatus[lugar - 1]] || null;
  }
  function clasePill(texto) {
    if (!texto) return "";
    if (texto === "Persona asignada") return "good";
    if (/rechaz|renuncia|elimin/i.test(texto)) return "bad";
    if (/listado/i.test(texto)) return "";
    return "warn";
  }

  function pintar() {
    const d = estado.datos;
    if (!d) return;
    document.querySelectorAll('[data-f="entidad"]').forEach((e) => (e.textContent = d.entidad));
    document.querySelectorAll('[data-f="ciclo"]').forEach((e) => (e.textContent = d.ciclo));
    document.querySelectorAll('[data-f="apreciacion"]').forEach((e) => (e.textContent = d.apreciacion));
    pintarHeroe(d);
    pintarCuando(d);
    pintarGrafica(d);
    pintarEventos(d);
    pintarPlazas(d);
    pintarAvisos();
    pintarFuenteArchivo(d);
    revisarConfeti(d);
  }

  function pintarHeroe(d) {
    const lugar = estado.lugar;
    const van = d.vanEn;
    const hero = $("#hero");
    const ult = fechaLocal(d.ultimoMovimiento);
    const mio = estatusDe(d, lugar);
    const vence = d.vence ? fechaLocal(d.vence) : null;
    const diasVence = vence ? diasEntre(new Date(), vence) : null;

    const top = h("div", { class: "hero-top" },
      h("div", null,
        h("p", { class: "label", text: "La lista va en" }),
        h("p", { class: "big", text: n(van) }),
        h("p", { class: "of", text: `de ${n(d.total)} · ${d.nombre} · ${d.entidad} · ${d.ciclo}` })),
      lugar ? h("div", { class: "me" }, h("p", { class: "label", text: "Tu lugar" }), h("p", { class: "num", text: n(lugar) })) : null);

    const kids = [top];

    if (lugar) {
      const tope = Math.max(lugar, van);
      const pct = Math.min(100, (van / tope) * 100);
      const mePct = Math.min(100, (lugar / tope) * 100);
      kids.push(h("div", { class: "track", role: "img", "aria-label": `La lista va en ${van} de ${lugar}` },
        h("div", { class: "track-bar" },
          h("div", { class: "track-fill", style: `width:${pct}%` }),
          h("div", { class: "track-me", style: `left:${mePct}%`, title: `Tu lugar: ${lugar}` })),
        h("div", { class: "track-legend" }, h("span", { text: "1" }), h("span", { text: `${n(van)} de ${n(lugar)}` }))));

      const faltan = lugar - van - 1;
      let frase;
      if (mio === "Persona asignada") frase = "🎉 Tu lugar ya aparece como «Persona asignada».";
      else if (van >= lugar) frase = "La lista ya pasó tu lugar. Revisa tu estatus en el sitio oficial.";
      else if (faltan <= 0) frase = "¡Sigues tú! Eres la siguiente posición en la lista.";
      else frase = `Hay ${n(faltan)} ${faltan === 1 ? "persona" : "personas"} antes que tú.`;
      kids.push(h("p", { class: "headline", text: frase }));
    } else {
      kids.push(h("p", { class: "headline", text: "Escribe tu lugar arriba para ver cuánto te falta." }));
    }

    const tiles = h("div", { class: "tiles" });
    tiles.append(h("div", { class: "tile" },
      h("p", { class: "k", text: "Siguiente en turno" }),
      h("p", { class: "v", text: d.siguiente ? `Lugar ${n(d.siguiente)}` : "—" }),
      h("p", { class: "n", text: `${n(d.conteo["Persona asignada"] || 0)} asignadas · ${n(d.conteo["Persona rechazó plaza"] || 0)} rechazos` })));
    tiles.append(h("div", { class: "tile" },
      h("p", { class: "k", text: "Último movimiento" }),
      h("p", { class: "v", text: ult ? fCorta(ult, true) : "—" }),
      h("p", { class: "n", text: ult ? `a las ${hora(ult)} (hora de NL)` : "" })));
    if (lugar) {
      tiles.append(h("div", { class: "tile" },
        h("p", { class: "k", text: "Tu estatus oficial" }),
        h("p", { class: "v" }, h("span", { class: `pill ${clasePill(mio)}` }, h("span", { class: "dot" }), h("span", { text: mio ? mio.replace("Persona en listado para su asignación", "En listado para su asignación") : "Fuera de la lista" })))));
    }
    if (vence) {
      tiles.append(h("div", { class: "tile" },
        h("p", { class: "k", text: "La lista vence" }),
        h("p", { class: "v", text: diasVence >= 0 ? `en ${n(diasVence)} días` : "ya venció" }),
        h("p", { class: "n", text: fLarga(vence) })));
    }
    kids.push(tiles);

    if (d.adelantados && d.adelantados.length) {
      kids.push(h("p", { class: "alert", text: `Ojo: ${d.adelantados.length === 1 ? "la posición" : "las posiciones"} ${d.adelantados.slice(0, 5).join(", ")} ya ${d.adelantados.length === 1 ? "tiene" : "tienen"} movimiento aunque la lista va en ${van} (casos aislados, por ejemplo plazas por tiempo fijo).` }));
    }

    const viejo = Date.now() - new Date(d.consultadoEn).getTime() > 3 * 3600 * 1000;
    kids.push(h("div", { class: `fresh${viejo ? " stale" : ""}` },
      h("span", { class: "live" }),
      h("span", { text: `Consulta a SATAP ${hace(d.consultadoEn)}` }),
      h("span", { text: "·" }),
      h("span", { text: viejo ? "Algo falla con la consulta automática; los datos pueden estar atrasados." : "se revisa sola cada 30 min" })));
    if (d.errorUltimaConsulta) {
      kids.push(h("p", { class: "alert", text: `La última consulta a SATAP falló (${hace(d.errorUltimaConsulta)}). Se muestran los datos anteriores.` }));
    }
    hero.replaceChildren(...kids);
  }

  // Valor de una serie [[fecha, valor], ...] en el día-de-ciclo `dia`.
  function valorEn(serie, ciclo, dia) {
    const ini = inicioCiclo(ciclo);
    let v = 0;
    for (const [f, val] of serie) {
      if (diasEntre(ini, fechaLocal(f)) <= dia) v = val; else break;
    }
    return v;
  }
  function cruce(serie, lugar) {
    const p = serie.find(([, v]) => v >= lugar);
    return p ? fechaLocal(p[0]) : null;
  }

  function pintarCuando(d) {
    const sec = $("#cuando");
    const hist = estado.historico && estado.historico.ciclos;
    const lugar = estado.lugar;
    if (!hist || !hist.length || !lugar) { sec.hidden = true; return; }
    sec.hidden = false;
    const hoyDia = diasEntre(inicioCiclo(d.ciclo), new Date());
    $("#cuando-sub").textContent = `En los ciclos anteriores de esta misma lista (${d.nombre}, ${d.entidad}), así fue para el lugar ${n(lugar)}:`;
    const ul = $("#cuando-lista");
    ul.replaceChildren(...hist.map((c) => {
      const f = cruce(c.serie, lugar);
      const mismaFecha = valorEn(c.serie, c.ciclo, hoyDia);
      return h("li", null,
        h("div", null,
          h("div", null, h("b", { text: `Ciclo ${c.ciclo}` })),
          h("div", { class: "c", text: `Lista de ${n(c.total)} · llegó hasta el ${n(c.final)} · a estas alturas iba en ${n(mismaFecha)}` })),
        h("div", { style: "text-align:right" },
          f ? h("b", { text: fCorta(f, true) }) : h("b", { text: "No llegó" }),
          h("div", { class: "c", text: f ? "llegó a tu lugar" : `se quedó en ${n(c.final)}` })));
    }));
    const llegaron = hist.filter((c) => cruce(c.serie, lugar)).length;
    $("#cuando-nota").textContent =
      `En ${llegaron} de ${hist.length} ciclos la lista llegó a tu lugar antes de vencer. Este año va en ${n(d.vanEn)}. ` +
      "No es una promesa: depende de cuántas plazas definitivas se liberen (jubilaciones, renuncias, nuevas plazas).";
  }

  // ----------------------------------------------------------------- gráfica
  function pintarGrafica(d) {
    const sec = $("#avance");
    const hist = (estado.historico && estado.historico.ciclos) || [];
    if (!d.serie) { sec.hidden = true; return; }
    sec.hidden = false;

    const cont = $("#chart");
    const W = Math.max(320, Math.min(cont.clientWidth || 680, 720));
    const H = W < 480 ? 260 : 300;
    const m = { t: 16, r: W < 480 ? 64 : 84, b: 28, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const DIAS = 304 + 15; // 1 ago -> 15 jun
    const hoyDia = Math.min(DIAS, Math.max(0, diasEntre(inicioCiclo(d.ciclo), new Date())));
    const lugar = estado.lugar;

    const series = [
      { ciclo: d.ciclo, serie: d.serie, color: "var(--accent)", actual: true, hasta: hoyDia },
      ...hist.map((c, i) => ({ ciclo: c.ciclo, serie: c.serie, color: `var(--past-${Math.min(3, i + 1)})`, actual: false, hasta: diasEntre(inicioCiclo(c.ciclo), new Date(Number(c.ciclo.slice(5, 9)), 4, 31)) })),
    ];
    const maxV = Math.max(10, lugar || 0, d.vanEn, ...hist.map((c) => c.final));
    const paso = niceStep(maxV * 1.12 / 5);
    const topV = Math.ceil((maxV * 1.08) / paso) * paso;
    const x = (dia) => m.l + (Math.max(0, Math.min(DIAS, dia)) / DIAS) * iw;
    const y = (v) => m.t + ih - (v / topV) * ih;

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Gráfica: la lista ${d.nombre} ${d.entidad} va en ${d.vanEn}; ciclos anteriores llegaron a ${hist.map((c) => `${c.final} (${c.ciclo})`).join(", ")}.` });
    const grid = s("g", { class: "grid" });
    for (let v = 0; v <= topV; v += paso) {
      grid.append(s("line", { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }));
      const t = s("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = n(v);
      grid.append(t);
    }
    svg.append(grid);
    const ax = s("g", { class: "axis-x" });
    ax.append(s("line", { x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }));
    const meses = ["ago", "sep", "oct", "nov", "dic", "ene", "feb", "mar", "abr", "may", "jun"];
    const anio = Number(d.ciclo.slice(0, 4));
    meses.forEach((mes, i) => {
      const fecha = new Date(i < 5 ? anio : anio + 1, (7 + i) % 12, 1);
      const dia = diasEntre(inicioCiclo(d.ciclo), fecha);
      if (W < 480 && i % 2 === 1) return;
      const t = s("text", { x: x(dia), y: H - 8, "text-anchor": "start" });
      t.textContent = mes;
      ax.append(t);
    });
    svg.append(ax);

    // Fin de vigencia (31 may)
    const diaVence = diasEntre(inicioCiclo(d.ciclo), new Date(anio + 1, 4, 31));
    svg.append(s("line", { class: "marker-line", x1: x(diaVence), x2: x(diaVence), y1: m.t, y2: y(0) }));
    const tv = s("text", { x: x(diaVence) - 4, y: m.t + 10, "text-anchor": "end" });
    tv.textContent = "vence";
    svg.append(tv);

    // Líneas (escalonadas: la lista se queda en su número hasta el siguiente evento)
    const finales = [];
    for (const sr of [...series].reverse()) {
      const pts = [[0, 0]];
      let prev = 0;
      for (const [f, v] of sr.serie) {
        const dia = diasEntre(inicioCiclo(sr.ciclo), fechaLocal(f));
        if (dia > DIAS) break;
        pts.push([dia, prev], [dia, v]);
        prev = v;
      }
      pts.push([Math.max(sr.hasta, pts[pts.length - 1][0]), prev]);
      const dstr = pts.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join("");
      if (sr.actual) {
        svg.append(s("path", { class: "area", d: `${dstr}L${x(pts[pts.length - 1][0]).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`, fill: "var(--accent-wash)" }));
      }
      svg.append(s("path", { class: "line", d: dstr, stroke: sr.color }));
      const last = pts[pts.length - 1];
      finales.push({ sr, xx: x(last[0]), yy: y(last[1]), v: last[1] });
    }
    // Punto actual
    const cur = finales.find((f) => f.sr.actual);
    if (cur) svg.append(s("circle", { cx: cur.xx, cy: cur.yy, r: 5, fill: "var(--accent)", class: "dot-ring" }));

    // Etiquetas al final de cada línea (con separación mínima)
    const etiquetas = finales.map((f) => ({ ...f, ly: f.yy })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < etiquetas.length; i++) {
      if (etiquetas[i].ly - etiquetas[i - 1].ly < 14) etiquetas[i].ly = etiquetas[i - 1].ly + 14;
    }
    for (const e of etiquetas) {
      const lx = e.sr.actual ? e.xx + 8 : x(DIAS) + 6;
      if (!e.sr.actual && Math.abs(e.ly - e.yy) > 2) {
        svg.append(s("line", { x1: e.xx + 2, x2: lx - 2, y1: e.yy, y2: e.ly - 4, stroke: "var(--axis)", "stroke-width": 1 }));
      }
      const t = s("text", { x: lx, y: e.ly + (e.sr.actual ? 4 : 0), class: `end-label${e.sr.actual ? " now" : ""}` });
      t.textContent = e.sr.actual ? `${n(e.v)}` : `${cicloCorto(e.sr.ciclo)} · ${n(e.v)}`;
      svg.append(t);
    }

    // Tu lugar
    if (lugar && lugar <= topV) {
      svg.append(s("line", { class: "me-line", x1: m.l, x2: m.l + iw, y1: y(lugar), y2: y(lugar) }));
      const t = s("text", { x: m.l + 6, y: y(lugar) - 6, class: "me-label" });
      t.textContent = `Tu lugar · ${n(lugar)}`;
      svg.append(t);
      // Dónde cruzaron los ciclos anteriores
      for (const sr of series.slice(1)) {
        const f = cruce(sr.serie, lugar);
        if (!f) continue;
        svg.append(s("circle", { cx: x(diasEntre(inicioCiclo(sr.ciclo), f)), cy: y(lugar), r: 4, fill: sr.color, class: "dot-ring" }));
      }
    }

    // Capa de interacción (cruz + tooltip)
    const cross = s("line", { class: "cross", y1: m.t, y2: y(0), opacity: 0 });
    svg.append(cross);
    const hit = s("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", tabindex: 0, "aria-label": "Recorre la gráfica para ver los valores por fecha" });
    svg.append(hit);
    const tip = h("div", { class: "tooltip" });
    cont.replaceChildren(svg, tip);

    function mostrar(dia) {
      dia = Math.max(0, Math.min(DIAS, Math.round(dia)));
      cross.setAttribute("x1", x(dia));
      cross.setAttribute("x2", x(dia));
      cross.setAttribute("opacity", 1);
      const fecha = new Date(inicioCiclo(d.ciclo).getTime() + dia * 86400000 + 3600000);
      const filas = series.map((sr) => {
        const v = sr.actual && dia > hoyDia ? null : valorEn(sr.serie, sr.ciclo, dia);
        return h("div", { class: "row" },
          h("span", { class: "key" }, h("i", { style: `background:${sr.color}` }), h("span", { text: cicloCorto(sr.ciclo) })),
          h("b", { text: v == null ? "—" : n(v) }));
      });
      tip.replaceChildren(h("div", { class: "t", text: `Al ${fecha.getDate()} de ${MESES_LARGOS[fecha.getMonth()]}` }), ...filas);
      tip.classList.add("on");
      const rect = cont.getBoundingClientRect();
      const px = (x(dia) / W) * rect.width;
      const tw = tip.offsetWidth || 160;
      tip.style.left = `${Math.max(0, Math.min(rect.width - tw, px + (px > rect.width / 2 ? -tw - 12 : 12)))}px`;
    }
    function ocultar() { cross.setAttribute("opacity", 0); tip.classList.remove("on"); }
    function desdeEvento(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      return ((px - m.l) / iw) * DIAS;
    }
    let diaFoco = hoyDia;
    hit.addEventListener("pointermove", (ev) => { diaFoco = desdeEvento(ev); mostrar(diaFoco); });
    hit.addEventListener("pointerdown", (ev) => { diaFoco = desdeEvento(ev); mostrar(diaFoco); });
    hit.addEventListener("pointerleave", ocultar);
    hit.addEventListener("focus", () => mostrar(diaFoco));
    hit.addEventListener("blur", ocultar);
    hit.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight") { diaFoco = Math.min(DIAS, diaFoco + 7); mostrar(diaFoco); ev.preventDefault(); }
      if (ev.key === "ArrowLeft") { diaFoco = Math.max(0, diaFoco - 7); mostrar(diaFoco); ev.preventDefault(); }
    });

    // Leyenda
    $("#chart-legend").replaceChildren(
      ...series.map((sr) => h("span", null, h("i", { style: `background:${sr.color}` }), h("span", { text: sr.actual ? `${cicloCorto(sr.ciclo)} (este ciclo)` : cicloCorto(sr.ciclo) }))),
      lugar ? h("span", null, h("i", { class: "dash" }), h("span", { text: "Tu lugar" })) : null);

    // Tabla equivalente
    const filas = [];
    for (const sr of series) for (const [f, v] of sr.serie) filas.push({ ciclo: sr.ciclo, f, v });
    $("#chart-table").replaceChildren(h("table", null,
      h("thead", null, h("tr", null, h("th", { text: "Ciclo" }), h("th", { text: "Fecha" }), h("th", { class: "n", text: "Iba en" }))),
      h("tbody", null, ...filas.map((r) => h("tr", null, h("td", { text: r.ciclo }), h("td", { text: fCorta(fechaLocal(r.f), true) }), h("td", { class: "n", text: n(r.v) }))))));
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  // ----------------------------------------------------------------- eventos
  function pintarEventos(d) {
    const sec = $("#eventos");
    if (!d.eventos || !d.eventos.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const evs = [...d.eventos].reverse();
    $("#eventos-tabla").replaceChildren(h("table", null,
      h("thead", null, h("tr", null,
        h("th", { text: "Fecha" }), h("th", { class: "n", text: "Avanzó" }), h("th", { text: "Qué pasó" }), h("th", { class: "n", text: "Quedó en" }))),
      h("tbody", null, ...evs.map((e) => {
        const partes = [];
        if (e.asignaciones) partes.push(`${e.asignaciones} asignaci${e.asignaciones === 1 ? "ón" : "ones"}`);
        if (e.rechazos) partes.push(`${e.rechazos} rechazo${e.rechazos === 1 ? "" : "s"}`);
        if (e.correcciones) partes.push(`${e.correcciones} corrección${e.correcciones === 1 ? "" : "es"}`);
        if (e.otros) partes.push(`${e.otros} otro${e.otros === 1 ? "" : "s"}`);
        return h("tr", null,
          h("td", { text: fCorta(fechaLocal(e.fecha), true) }),
          h("td", { class: "n", text: e.avance ? `+${n(e.avance)}` : "0" }),
          h("td", { text: partes.join(" · ") || "—" }),
          h("td", { class: "n" }, h("b", { text: n(e.vanEn) })));
      }))));
    const tipos = d.asignacionesPorTipo || {};
    const t = Object.entries(tipos).map(([k, v]) => `${n(v)} ${k.toLowerCase()}${v === 1 ? "" : "s"}`).join(", ");
    $("#eventos-nota").textContent = t ? `Asignaciones vigentes de la lista por tipo: ${t}.` : "";
  }

  // ------------------------------------------------------------------ plazas
  function pintarPlazas(d) {
    const sec = $("#plazas");
    const p = d.plazas;
    if (!p) { sec.hidden = true; return; }
    sec.hidden = false;
    $("#plazas-sub").textContent = `Según la consulta pública de vacancia y ocupación (${d.nombre}, ${d.entidad}, ${d.ciclo}). Consultado ${hace(p.consultadoEn)}.`;
    const cuerpo = [];

    const defin = (p.vacantesPorTipo && p.vacantesPorTipo.Definitiva) || 0;
    const temp = (p.vacantesPorTipo && p.vacantesPorTipo.Temporal) || 0;
    cuerpo.push(h("div", { class: "tiles", style: "margin-top:0" },
      h("div", { class: "tile" }, h("p", { class: "k", text: "Vacantes publicadas" }), h("p", { class: "v", text: n(p.vacantes.length) }),
        h("p", { class: "n", text: `${n(defin)} definitiva${defin === 1 ? "" : "s"} · ${n(temp)} temporal${temp === 1 ? "" : "es"}` })),
      h("div", { class: "tile" }, h("p", { class: "k", text: "Ocupadas este ciclo" }), h("p", { class: "v", text: n(p.ocupadas) }),
        h("p", { class: "n", text: "por la lista y por necesidades del servicio" }))));

    if (p.ocupadasPorOrigen && p.ocupadasPorOrigen.length) {
      // Primero las de la lista ordenada (las que mueven el número).
      p.ocupadasPorOrigen = [...p.ocupadasPorOrigen].sort((a, b) => (/lista ordenada/i.test(b.origen) ? 1 : 0) - (/lista ordenada/i.test(a.origen) ? 1 : 0));
      const tot = p.ocupadasPorOrigen.reduce((a, b) => a + b.n, 0) || 1;
      const color = (o) => (/lista ordenada/i.test(o.origen) ? "var(--accent)" : "var(--series-2)");
      const nombre = (o) => (/lista ordenada/i.test(o.origen) ? "Por la lista ordenada" : /necesidades/i.test(o.origen) ? "Por necesidades del servicio" : o.origen);
      cuerpo.push(h("p", { class: "k", style: "margin:16px 0 0;font-size:14px;font-weight:600", text: "¿Cómo se ocuparon las plazas?" }));
      cuerpo.push(h("div", { class: "seg", role: "img", "aria-label": p.ocupadasPorOrigen.map((o) => `${nombre(o)} (${o.tipo}): ${o.n}`).join("; ") },
        ...p.ocupadasPorOrigen.map((o) => {
          const pct = (o.n / tot) * 100;
          return h("div", { style: `flex:${o.n} 1 0;background:${color(o)}`, title: `${nombre(o)} · ${o.tipo}: ${n(o.n)} (${Math.round(pct)}%)`, text: pct > 14 ? `${n(o.n)}` : "" });
        })));
      cuerpo.push(h("div", { class: "seg-legend" }, ...p.ocupadasPorOrigen.map((o) =>
        h("span", null, h("i", { style: `background:${color(o)}` }), h("span", { text: `${nombre(o)} · ${o.tipo.toLowerCase()}: ${n(o.n)}` })))));
      cuerpo.push(h("p", { class: "note", text: "Las asignadas “por necesidades del servicio” son temporales y se dieron a personas fuera de la lista; no hacen avanzar el número." }));
    }

    if (p.vacantes.length) {
      cuerpo.push(h("p", { class: "k", style: "margin:16px 0 8px;font-size:14px;font-weight:600", text: "Vacantes publicadas ahorita" }));
      cuerpo.push(h("div", { class: "vac" }, ...p.vacantes.slice(0, 30).map((v) => {
        const periodo = [v.inicio && fCorta(fechaLocal(v.inicio), true), v.fin && fCorta(fechaLocal(v.fin), true)].filter(Boolean).join(" → ");
        return h("div", { class: "vac-item" },
          h("div", { class: "h" }, h("span", { text: v.motivo || "Vacante" }), h("span", { class: "tag", text: v.tipo || "" })),
          h("div", { class: "d", text: [v.escuela, v.municipio, v.turno].filter(Boolean).join(" · ") }),
          h("div", { class: "d", text: [periodo && `Periodo: ${periodo}`, v.cargada && `publicada ${fCorta(fechaLocal(v.cargada), true)}`].filter(Boolean).join(" · ") }));
      })));
      if (p.vacantes.length > 30) cuerpo.push(h("p", { class: "note", text: `…y ${n(p.vacantes.length - 30)} más en el sitio oficial.` }));
    } else {
      cuerpo.push(h("p", { class: "note", text: "No hay vacantes publicadas en este momento para esta lista." }));
    }
    $("#plazas-cuerpo").replaceChildren(...cuerpo);
  }

  // ------------------------------------------------------------------ avisos
  function pintarAvisos() {
    const sec = $("#avisos");
    if (!estado.avisos) { sec.hidden = true; return; }
    sec.hidden = false;
    $("#avisos-topic").textContent = estado.avisos;
  }

  function pintarFuenteArchivo(d) {
    const p = $("#src-archivo");
    p.replaceChildren(
      "Archivo oficial de la última consulta: ",
      h("code", { text: d.archivoOficial || "—" }),
      ` (${hace(d.consultadoEn)}). `,
      d.copiaArchivo ? h("a", { href: d.copiaArchivo, download: d.archivoOficial || "listado.xlsx", text: "Descargar la misma copia" }) : null,
      " para compararla.");
  }

  // ----------------------------------------------------------------- confeti
  function revisarConfeti(d) {
    const lugar = estado.lugar;
    if (!lugar) return;
    const mio = estatusDe(d, lugar);
    if (!(mio === "Persona asignada" || d.vanEn >= lugar - 1)) return;
    const clave = `confeti:${d.id}:${lugar}:${mio}:${new Date().toDateString()}`;
    if (leer(clave)) return;
    guardar(clave, "1");
    confeti();
  }
  function confeti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = $("#confetti");
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colores = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
    const piezas = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6, hh: 8 + Math.random() * 8, col: colores[(Math.random() * colores.length) | 0],
    }));
    let frames = 0;
    (function paso() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of piezas) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.hh / 2, p.w, p.hh); ctx.restore();
      }
      if (++frames < 200) requestAnimationFrame(paso); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }

  // -------------------------------------------------------------- arranque
  function init() {
    const hs = leerHash();
    estado.listaId = hs.lista || leer("lista") || null;
    const lg = hs.lugar || leer("lugar");
    estado.lugar = lg && /^\d+$/.test(lg) ? Number(lg) : null;
    estado.avisos = hs.avisos || leer("avisos") || null;
    if (estado.avisos) guardar("avisos", estado.avisos);
    if (estado.lugar) $("#in-lugar").value = estado.lugar;
    escribirHash();
    $("#repo-link").href = REPO;

    $("#sel-lista").addEventListener("change", (e) => {
      estado.listaId = e.target.value;
      guardar("lista", estado.listaId);
      escribirHash();
      estado.datos = null;
      cargar(false);
    });
    let t;
    $("#in-lugar").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const v = e.target.value.trim();
        estado.lugar = /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;
        guardar("lugar", estado.lugar || "");
        escribirHash();
        pintar();
      }, 250);
    });
    $("#btn-actualizar").addEventListener("click", () => cargar(true));
    $("#btn-copiar-topic").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(estado.avisos); toast("Tema copiado"); } catch (_) { toast("No se pudo copiar; selecciónalo a mano"); }
    });
    window.addEventListener("hashchange", () => {
      const nh = leerHash();
      if (nh.lugar) { estado.lugar = Number(nh.lugar); $("#in-lugar").value = estado.lugar; }
      if (nh.avisos) { estado.avisos = nh.avisos; guardar("avisos", nh.avisos); }
      if (nh.lista && nh.lista !== estado.listaId) { estado.listaId = nh.lista; estado.datos = null; cargar(false); } else pintar();
    });
    let rz;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => estado.datos && pintarGrafica(estado.datos), 150); });
    // Se actualiza sola cuando vuelves a la página y cada 5 minutos mientras está abierta.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(false); });
    setInterval(() => { if (!document.hidden) cargar(false); }, 5 * 60 * 1000);
    cargar(false);
  }
  init();
})();
