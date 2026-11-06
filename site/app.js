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
  const MOV = !matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICON = {
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  };

  const estado = { listas: [], listaId: null, lugar: null, avisos: null, datos: null, historico: null, cargando: false };

  // ---------------------------------------------------------------- utilidades
  function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "svg") el.innerHTML = v; // solo íconos propios (constantes), nunca datos
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
    toastT = setTimeout(() => t.classList.remove("on"), 2800);
  }
  // Número que "cuenta" hasta su valor.
  function contar(el, hasta, desde) {
    if (!MOV || desde === hasta) { el.textContent = n(hasta); return; }
    const ini = performance.now();
    const dur = 900;
    const a = desde || 0;
    (function paso(t) {
      const p = Math.min(1, (t - ini) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = n(Math.round(a + (hasta - a) * e));
      if (p < 1) requestAnimationFrame(paso);
    })(ini);
  }

  // ------------------------------------------------------------ enlace / hash
  // Formatos: #lista=nl-primaria&lugar=150&avisos=TEMA   o   #nl-primaria/150
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

  let vanMostrado = 0;
  async function cargar(manual) {
    if (estado.cargando) return;
    estado.cargando = true;
    const btns = [$("#btn-actualizar"), $("#mini-refresh")];
    btns.forEach((b) => b.classList.add("spin"));
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
        else if (ahora === antes) toast(`Sin cambios · SATAP se consultó ${hace(datos.consultadoEn)}`);
        else toast(`Al día · SATAP se consultó ${hace(datos.consultadoEn)}`);
        const b = $("#btn-actualizar");
        b.classList.add("ok");
        b.querySelector("span").textContent = "Al día";
        setTimeout(() => { b.classList.remove("ok"); b.querySelector("span").textContent = "Actualizar"; }, 1800);
      }
    } catch (e) {
      console.error(e);
      toast("No se pudo cargar. Revisa tu conexión e intenta de nuevo.");
      if (!estado.datos) $("#hero").replaceChildren(h("p", { class: "eyebrow", text: "No se pudieron cargar los datos." }), h("p", { class: "headline", text: "Intenta de nuevo en un momento." }));
    } finally {
      estado.cargando = false;
      btns.forEach((b) => b.classList.remove("spin"));
      document.body.classList.remove("loading");
    }
  }

  function llenarSelect() {
    const sel = $("#sel-lista");
    if (sel.options.length !== estado.listas.length || sel.value !== estado.listaId) {
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
    pintarFila(d);
    pintarCuando(d);
    pintarGrafica(d);
    pintarEventos(d);
    pintarPlazas(d);
    pintarAvisos();
    pintarFuenteArchivo(d);
    pintarMini(d);
    revisarConfeti(d);
  }

  function pintarHeroe(d) {
    const lugar = estado.lugar;
    const van = d.vanEn;
    const hero = $("#hero");
    const mio = estatusDe(d, lugar);
    const listo = mio === "Persona asignada" || (lugar && van >= lugar);
    hero.classList.toggle("done", !!listo);

    const big = h("p", { class: "big" });
    const kids = [
      h("div", { class: "hero-row" },
        h("div", null,
          h("p", { class: "eyebrow", text: "La lista va en" }),
          big,
          h("p", { class: "of", text: `de ${n(d.total)} · ${d.nombre} · ${d.entidad} · ${d.ciclo}` })),
        lugar ? h("div", { class: "me-chip" }, h("span", { text: "Tu lugar" }), h("b", { text: n(lugar) })) : null),
    ];

    let frase;
    if (lugar) {
      const tope = Math.max(lugar, van);
      const pct = Math.min(100, (van / tope) * 100);
      const fill = h("div", { class: "hero-fill" });
      kids.push(h("div", { class: "hero-track", role: "img", "aria-label": `La lista va en ${van} de ${lugar}` },
        h("div", { class: "hero-bar" }, fill, h("div", { class: "hero-me", style: `left:${Math.min(100, (lugar / tope) * 100)}%`, title: `Tu lugar: ${lugar}` })),
        h("div", { class: "hero-legend" }, h("span", { text: "Lugar 1" }), h("span", { text: `${Math.round(pct)}% del camino a tu lugar` }))));
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));

      const faltan = lugar - van - 1;
      if (mio === "Persona asignada") frase = "🎉 ¡Tu lugar ya aparece como «Persona asignada»!";
      else if (van >= lugar) frase = "La lista ya pasó tu lugar. Revisa tu estatus en el sitio oficial.";
      else if (faltan <= 0) frase = "¡Sigues tú! Eres la siguiente en la lista.";
      else frase = `Hay ${n(faltan)} ${faltan === 1 ? "persona" : "personas"} antes que tú.`;
    } else {
      frase = "Escribe tu lugar arriba para ver cuánto te falta.";
    }
    kids.push(h("p", { class: "headline", text: frase }));

    const viejo = Date.now() - new Date(d.consultadoEn).getTime() > 3 * 3600 * 1000;
    kids.push(h("div", { class: `hero-foot${viejo ? " stale" : ""}` },
      h("span", { class: "live" }),
      h("span", { text: viejo ? `Última consulta a SATAP ${hace(d.consultadoEn)} · puede estar atrasada` : `SATAP se consultó ${hace(d.consultadoEn)} · se revisa sola cada 30 min` })));
    hero.replaceChildren(...kids);
    contar(big, van, vanMostrado === van ? van : vanMostrado);
    vanMostrado = van;

    // Tarjetas de datos
    const ult = fechaLocal(d.ultimoMovimiento);
    const vence = d.vence ? fechaLocal(d.vence) : null;
    const diasVence = vence ? diasEntre(new Date(), vence) : null;
    const stat = (ico, k, v, nota, cls) => h("div", { class: `stat${cls ? " " + cls : ""}` },
      h("span", { class: "ico", svg: ico }), h("p", { class: "k", text: k }), v, nota ? h("p", { class: "n", text: nota }) : null);
    const stats = [
      stat(ICON.next, "Siguiente en turno", h("p", { class: "v", text: d.siguiente ? `Lugar ${n(d.siguiente)}` : "—" }),
        `${n(d.conteo["Persona asignada"] || 0)} asignadas · ${n(d.conteo["Persona rechazó plaza"] || 0)} rechazos`),
      stat(ICON.clock, "Último movimiento", h("p", { class: "v", text: ult ? fCorta(ult, true) : "—" }), ult ? `a las ${hora(ult)} (hora de NL)` : ""),
    ];
    if (lugar) {
      const txt = mio ? mio.replace("Persona en listado para su asignación", "En listado para su asignación") : "Fuera de la lista";
      stats.push(stat(mio === "Persona asignada" ? ICON.check : ICON.user, "Tu estatus oficial",
        h("p", { class: "v" }, h("span", { class: `pill ${clasePill(mio)}` }, h("span", { class: "dot" }), h("span", { text: txt }))),
        null, mio === "Persona asignada" ? "good" : ""));
    }
    if (vence) {
      stats.push(stat(ICON.hourglass, "La lista vence", h("p", { class: "v", text: diasVence >= 0 ? `en ${n(diasVence)} días` : "ya venció" }), fLarga(vence)));
    }
    $("#stats").replaceChildren(...stats);

    const alertas = [];
    if (d.adelantados && d.adelantados.length) {
      alertas.push(h("p", { class: "alert", text: `Ojo: ${d.adelantados.length === 1 ? "la posición" : "las posiciones"} ${d.adelantados.slice(0, 5).join(", ")} ya ${d.adelantados.length === 1 ? "tiene" : "tienen"} movimiento aunque la lista va en ${van} (casos aislados, por ejemplo plazas por tiempo fijo).` }));
    }
    if (d.errorUltimaConsulta) {
      alertas.push(h("p", { class: "alert", text: `La última consulta a SATAP falló (${hace(d.errorUltimaConsulta)}). Se muestran los datos anteriores.` }));
    }
    $("#alertas").replaceChildren(...alertas);
  }

  // ------------------------------------------------- la fila (un punto por lugar)
  let filaVista = false;
  const CLASE_PUNTO = { A: "a", R: "r", L: "", E: "x", V: "x", N: "x", C: "x", P: "x", X: "x" };
  function pintarFila(d) {
    const sec = $("#fila");
    if (!d.estatus) { sec.hidden = true; return; }
    sec.hidden = false;
    const lugar = estado.lugar;
    const hasta = Math.min(d.total, lugar ? Math.max(lugar, d.vanEn) + 10 : Math.max(d.vanEn + 120, 200));
    const porPunto = Math.max(1, Math.ceil(hasta / 700));
    const nPuntos = Math.ceil(hasta / porPunto);
    $("#fila-sub").textContent = porPunto === 1
      ? `Cada punto es un lugar de la lista, del 1 al ${n(hasta)}.${lugar ? " El tuyo es el del anillo." : ""}`
      : `Cada punto representa ${porPunto} lugares de la lista, del 1 al ${n(hasta)}.`;
    const cont = $("#dots");
    const frag = document.createDocumentFragment();
    const cuenta = { a: 0, r: 0, x: 0, "": 0 };
    for (let i = 0; i < nPuntos; i++) {
      const p = i * porPunto + 1;
      const cod = d.estatus[p - 1] || "L";
      let cls = CLASE_PUNTO[cod] ?? "x";
      const esMio = lugar && lugar >= p && lugar < p + porPunto;
      const el = document.createElement("i");
      el.dataset.p = p;
      el.style.setProperty("--d", MOV ? Math.min(i * 2, 900) : 0);
      if (esMio) cls = "me";
      if (cls) el.className = cls;
      frag.append(el);
    }
    for (let p = 1; p <= hasta; p++) {
      const c = CLASE_PUNTO[d.estatus[p - 1]] ?? "x";
      if (p < (lugar || Infinity) || !lugar) cuenta[c] = (cuenta[c] || 0) + 1;
    }
    cont.classList.toggle("anim", !filaVista);
    filaVista = true;
    cont.replaceChildren(frag);
    cont.setAttribute("aria-label", `Fila de la lista: ${cuenta.a} asignadas, ${cuenta.r} rechazos y ${cuenta[""]} en espera${lugar ? ` antes del lugar ${lugar}` : ""}.`);

    const cap = $("#dots-cap");
    const capDefault = () => {
      cap.replaceChildren(lugar
        ? h("span", null, "Toca un punto para ver su estatus. Tú eres el ", h("b", { text: `lugar ${n(lugar)}` }), ".")
        : h("span", { text: "Toca un punto para ver su estatus." }));
    };
    capDefault();
    let marcado = null;
    const mostrar = (el) => {
      if (!el || !el.dataset.p) return;
      if (marcado) marcado.classList.remove("hl");
      marcado = el;
      el.classList.add("hl");
      const p = Number(el.dataset.p);
      const st = d.codigos[d.estatus[p - 1]] || "—";
      cap.replaceChildren(h("b", { text: porPunto === 1 ? `Lugar ${n(p)}` : `Lugares ${n(p)}–${n(p + porPunto - 1)}` }), ` · ${st}${lugar === p ? " (tú)" : ""}`);
    };
    cont.onpointerover = (e) => mostrar(e.target.closest("i"));
    cont.onpointerdown = (e) => mostrar(e.target.closest("i"));
    cont.onpointerleave = () => { if (marcado) marcado.classList.remove("hl"); marcado = null; capDefault(); };

    const k = (color, txt) => h("span", null, h("i", { style: `background:${color}` }), h("span", { text: txt }));
    $("#dots-key").replaceChildren(...[
      k("var(--accent)", `Asignada · ${n(cuenta.a)}`),
      k("var(--series-2)", `Rechazó · ${n(cuenta.r)}`),
      cuenta.x ? k("var(--past-2)", `Otro estatus · ${n(cuenta.x)}`) : null,
      k("var(--dot-wait)", lugar ? `Esperando antes que tú · ${n(cuenta[""])}` : `En espera · ${n(cuenta[""])}`),
      lugar ? k("var(--ink)", "Tú") : null].filter(Boolean));
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
    $("#cuando-sub").textContent = `Hasta dónde llegó la misma lista (${d.nombre}, ${d.entidad}) en los ciclos anteriores. La rayita vertical es tu lugar.`;
    const escala = Math.max(lugar, d.vanEn, ...hist.map((c) => c.final)) * 1.06;
    const fila = (clase, titulo, badge, badgeCls, valor, nota) => {
      const fill = h("div", { class: "cyc-fill" });
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${(valor / escala) * 100}%`)));
      return h("li", { class: clase },
        h("div", { class: "cyc-h" }, h("b", { text: titulo }), h("span", { class: `badge ${badgeCls}`, text: badge })),
        h("div", { class: "cyc-bar" }, fill, h("div", { class: "cyc-mark", style: `left:${(lugar / escala) * 100}%` })),
        h("div", { class: "cyc-n", text: nota }));
    };
    const items = [fila("now", `${d.ciclo} · este ciclo`, `va en ${n(d.vanEn)}`, "now", d.vanEn, `Lista de ${n(d.total)} · vence el 31 may ${Number(d.ciclo.slice(5, 9))}`)];
    for (const c of hist) {
      const f = cruce(c.serie, lugar);
      const mismaFecha = valorEn(c.serie, c.ciclo, hoyDia);
      items.push(fila("", c.ciclo, f ? `llegó el ${fCorta(f, true)}` : "no llegó", f ? "good" : "", c.final,
        `Llegó hasta el ${n(c.final)} de ${n(c.total)} · a estas alturas iba en ${n(mismaFecha)}`));
    }
    $("#cuando-lista").replaceChildren(...items);

    const llegaron = hist.filter((c) => cruce(c.serie, lugar));
    const fechas = llegaron.map((c) => cruce(c.serie, lugar));
    let resumen = `En ${llegaron.length} de ${hist.length} ciclos anteriores la lista llegó a tu lugar antes de vencer.`;
    if (fechas.length) {
      const meses = [...new Set(fechas.map((f) => MESES_LARGOS[f.getMonth()]))];
      resumen += ` Fue en ${meses.join(" y ")}.`;
    }
    $("#cuando-veredicto").replaceChildren(
      h("span", { class: "big-n", text: `${llegaron.length} de ${hist.length}` }),
      h("p", { text: resumen }));
    $("#cuando-nota").textContent = "No es una promesa: depende de cuántas plazas definitivas se liberen (jubilaciones, renuncias, nuevas plazas). Los saltos grandes suelen venir en enero.";
  }

  // ----------------------------------------------------------------- gráfica
  function pintarGrafica(d) {
    const sec = $("#avance");
    const hist = (estado.historico && estado.historico.ciclos) || [];
    if (!d.serie) { sec.hidden = true; return; }
    sec.hidden = false;

    const cont = $("#chart");
    const W = Math.max(320, Math.min(cont.clientWidth || 680, 720));
    const H = W < 480 ? 270 : 310;
    const m = { t: 16, r: W < 480 ? 66 : 86, b: 28, l: 40 };
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
    const defs = s("defs");
    const grad = s("linearGradient", { id: "g-area", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(s("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": 0.28 }), s("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": 0.02 }));
    defs.append(grad);
    svg.append(defs);

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
    // Hoy
    svg.append(s("line", { class: "marker-line", x1: x(hoyDia), x2: x(hoyDia), y1: m.t, y2: y(0), "stroke-dasharray": "2 3" }));
    const th = s("text", { x: x(hoyDia) + 4, y: m.t + 10 });
    th.textContent = "hoy";
    svg.append(th);

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
        svg.append(s("path", { d: `${dstr}L${x(pts[pts.length - 1][0]).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`, fill: "url(#g-area)" }));
      }
      svg.append(s("path", { class: `line${sr.actual ? " now" : ""}`, d: dstr, stroke: sr.color }));
      const last = pts[pts.length - 1];
      finales.push({ sr, xx: x(last[0]), yy: y(last[1]), v: last[1] });
    }
    const cur = finales.find((f) => f.sr.actual);
    if (cur) {
      svg.append(s("circle", { cx: cur.xx, cy: cur.yy, r: 6, class: "halo" }));
      svg.append(s("circle", { cx: cur.xx, cy: cur.yy, r: 5, fill: "var(--accent)", class: "dot-ring" }));
    }

    // Etiquetas al final de cada línea (con separación mínima)
    const etiquetas = finales.map((f) => ({ ...f, ly: f.yy })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < etiquetas.length; i++) {
      if (etiquetas[i].ly - etiquetas[i - 1].ly < 14) etiquetas[i].ly = etiquetas[i - 1].ly + 14;
    }
    for (const e of etiquetas) {
      const lx = e.sr.actual ? e.xx + 10 : x(DIAS) + 6;
      if (!e.sr.actual && Math.abs(e.ly - e.yy) > 2) {
        svg.append(s("line", { x1: e.xx + 2, x2: lx - 2, y1: e.yy, y2: e.ly - 4, stroke: "var(--axis)", "stroke-width": 1 }));
      }
      const t = s("text", { x: lx, y: e.ly + 4, class: `end-label${e.sr.actual ? " now" : ""}` });
      t.textContent = e.sr.actual ? `${n(e.v)}` : `${cicloCorto(e.sr.ciclo)} · ${n(e.v)}`;
      svg.append(t);
    }

    // Tu lugar
    if (lugar && lugar <= topV) {
      svg.append(s("line", { class: "me-line", x1: m.l, x2: m.l + iw, y1: y(lugar), y2: y(lugar) }));
      const t = s("text", { x: m.l + 6, y: y(lugar) - 6, class: "me-label" });
      t.textContent = `Tu lugar · ${n(lugar)}`;
      svg.append(t);
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
          h("span", { class: "k2" }, h("i", { style: `background:${sr.color}` }), h("span", { text: cicloCorto(sr.ciclo) })),
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

    $("#chart-legend").replaceChildren(...[
      ...series.map((sr) => h("span", null, h("i", { style: `background:${sr.color}` }), h("span", { text: sr.actual ? `${cicloCorto(sr.ciclo)} (este ciclo)` : cicloCorto(sr.ciclo) }))),
      lugar ? h("span", null, h("i", { class: "dash" }), h("span", { text: "Tu lugar" })) : null].filter(Boolean));

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
  function partesEvento(e) {
    const partes = [];
    if (e.asignaciones) partes.push(`${e.asignaciones} asignaci${e.asignaciones === 1 ? "ón" : "ones"}`);
    if (e.rechazos) partes.push(`${e.rechazos} rechazo${e.rechazos === 1 ? "" : "s"}`);
    if (e.correcciones) partes.push(`${e.correcciones} correcci${e.correcciones === 1 ? "ón" : "ones"}`);
    if (e.otros) partes.push(`${e.otros} otro${e.otros === 1 ? "" : "s"} movimiento${e.otros === 1 ? "" : "s"}`);
    return partes.join(" · ");
  }
  function pintarEventos(d) {
    const sec = $("#eventos");
    if (!d.eventos || !d.eventos.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const evs = [...d.eventos].reverse();
    $("#eventos-tl").replaceChildren(...evs.map((e) => {
      const f = fechaLocal(e.fecha);
      return h("li", null,
        h("div", { class: "tl-top" },
          h("span", { class: "tl-date", text: `${f.getDate()} ${MESES[f.getMonth()]} ${f.getFullYear()}` }),
          h("span", { class: "chip", text: `quedó en ${n(e.vanEn)}` })),
        h("div", { class: "tl-main" },
          e.avance ? h("span", { class: "plus", text: `+${n(e.avance)}` }) : h("span", { class: "plus", text: "0" }),
          ` ${e.avance === 1 ? "lugar" : "lugares"}`),
        h("div", { class: "tl-sub", text: partesEvento(e) || "—" }));
    }));
    $("#eventos-tabla").replaceChildren(h("table", null,
      h("thead", null, h("tr", null,
        h("th", { text: "Fecha" }), h("th", { class: "n", text: "Avanzó" }), h("th", { text: "Qué pasó" }), h("th", { class: "n", text: "Quedó en" }))),
      h("tbody", null, ...evs.map((e) => h("tr", null,
        h("td", { text: fCorta(fechaLocal(e.fecha), true) }),
        h("td", { class: "n", text: e.avance ? `+${n(e.avance)}` : "0" }),
        h("td", { text: partesEvento(e) || "—" }),
        h("td", { class: "n" }, h("b", { text: n(e.vanEn) })))))));
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
    cuerpo.push(h("div", { class: "mini-stats" },
      h("div", null, h("p", { class: "k", text: "Vacantes publicadas" }), h("p", { class: "v", text: n(p.vacantes.length) }),
        h("p", { class: "n", text: `${n(defin)} definitiva${defin === 1 ? "" : "s"} · ${n(temp)} temporal${temp === 1 ? "" : "es"}` })),
      h("div", null, h("p", { class: "k", text: "Ocupadas este ciclo" }), h("p", { class: "v", text: n(p.ocupadas) }),
        h("p", { class: "n", text: "por la lista y por necesidades del servicio" }))));

    if (p.ocupadasPorOrigen && p.ocupadasPorOrigen.length) {
      const orden = [...p.ocupadasPorOrigen].sort((a, b) => (/lista ordenada/i.test(b.origen) ? 1 : 0) - (/lista ordenada/i.test(a.origen) ? 1 : 0));
      const tot = orden.reduce((a, b) => a + b.n, 0) || 1;
      const color = (o) => (/lista ordenada/i.test(o.origen) ? "var(--accent)" : "var(--series-2)");
      const nombre = (o) => (/lista ordenada/i.test(o.origen) ? "Por la lista ordenada" : /necesidades/i.test(o.origen) ? "Por necesidades del servicio" : o.origen);
      cuerpo.push(h("p", { class: "h3", text: "¿Cómo se ocuparon las plazas?" }));
      cuerpo.push(h("div", { class: "seg", role: "img", "aria-label": orden.map((o) => `${nombre(o)} (${o.tipo}): ${o.n}`).join("; ") },
        ...orden.map((o) => {
          const pct = (o.n / tot) * 100;
          return h("div", { style: `flex:${o.n} 1 0;background:${color(o)}`, title: `${nombre(o)} · ${o.tipo}: ${n(o.n)} (${Math.round(pct)}%)`, text: pct > 14 ? `${n(o.n)}` : "" });
        })));
      cuerpo.push(h("div", { class: "seg-legend" }, ...orden.map((o) =>
        h("span", null, h("i", { style: `background:${color(o)}` }), h("span", { text: `${nombre(o)} · ${o.tipo.toLowerCase()}: ${n(o.n)}` })))));
      cuerpo.push(h("p", { class: "note", text: "Las asignadas “por necesidades del servicio” son temporales y se dieron a personas fuera de la lista; no hacen avanzar el número." }));
    }

    if (p.vacantes.length) {
      cuerpo.push(h("p", { class: "h3", text: "Vacantes publicadas ahorita" }));
      cuerpo.push(h("div", { class: "vac" }, ...p.vacantes.slice(0, 30).map((v) => {
        const periodo = [v.inicio && fCorta(fechaLocal(v.inicio), true), v.fin && fCorta(fechaLocal(v.fin), true)].filter(Boolean).join(" → ");
        return h("div", { class: "vac-item" },
          h("div", { class: "h" }, h("span", { text: v.motivo || "Vacante" }), h("span", { class: `tag${v.tipo === "Definitiva" ? " def" : ""}`, text: v.tipo || "" })),
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
    $("#src-archivo").replaceChildren(
      "Archivo oficial de la última consulta: ",
      h("code", { text: d.archivoOficial || "—" }),
      ` (${hace(d.consultadoEn)}). `,
      ...(d.copiaArchivo ? [h("a", { href: d.copiaArchivo, download: d.archivoOficial || "listado.xlsx", text: "Descargar la misma copia" }), " para compararla."] : []));
  }

  // -------------------------------------------------------------- barra fija
  function pintarMini(d) {
    const lugar = estado.lugar;
    const t = $("#mini-txt");
    const partes = [h("span", null, "Va en ", h("b", { text: n(d.vanEn) }))];
    if (lugar) {
      partes.push(h("span", { class: "sep", text: "·" }), h("span", null, "Tú ", h("b", { text: n(lugar) })));
      const faltan = lugar - d.vanEn - 1;
      if (faltan > 0) partes.push(h("span", { class: "sep", text: "·" }), h("span", { text: `faltan ${n(faltan)}` }));
    }
    t.replaceChildren(...partes);
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
    if (!MOV) return;
    const c = $("#confetti");
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colores = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
    const piezas = Array.from({ length: 180 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 140, y: innerHeight * 0.3,
      vx: (Math.random() - 0.5) * 15, vy: -Math.random() * 15 - 4,
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
      if (++frames < 220) requestAnimationFrame(paso); else ctx.clearRect(0, 0, innerWidth, innerHeight);
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
      vanMostrado = 0;
      filaVista = false;
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
      }, 300);
    });
    $("#btn-actualizar").addEventListener("click", () => cargar(true));
    $("#mini-refresh").addEventListener("click", () => cargar(true));
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

    // La barra fija aparece cuando el encabezado azul sale de la pantalla.
    const mini = $("#mini");
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([en]) => {
        const on = !en.isIntersecting && en.boundingClientRect.top < 0;
        mini.classList.toggle("on", on);
        mini.setAttribute("aria-hidden", on ? "false" : "true");
      }).observe($("#hero"));
    }

    // Se actualiza sola cuando vuelves a la página y cada 5 minutos mientras está abierta.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(false); });
    setInterval(() => { if (!document.hidden) cargar(false); }, 5 * 60 * 1000);
    cargar(false);
  }
  init();
})();
