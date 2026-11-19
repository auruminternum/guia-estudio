(() => {
  'use strict';

  // ------------------------------------------------------------ utilidades
  const $ = (selector, raiz = document) => raiz.querySelector(selector);
  const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];
  const normal = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const textoPlano = (html) => html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\[()[\]]/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const memoria = {
    leer(clave, omision) {
      try {
        const v = localStorage.getItem(`ge.${clave}`);
        return v === null ? omision : JSON.parse(v);
      } catch { return omision; }
    },
    guardar(clave, valor) {
      try { localStorage.setItem(`ge.${clave}`, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
    },
    borrar(clave) {
      try { localStorage.removeItem(`ge.${clave}`); } catch { /* sin almacenamiento */ }
    },
  };

  // Las fórmulas se componen en orden y sólo cuando el contenido ya es visible.
  let cola = Promise.resolve();
  function componer(nodo) {
    if (!window.MathJax || !MathJax.startup) return;
    cola = cola
      .then(() => MathJax.startup.promise)
      .then(() => MathJax.typesetPromise([nodo]))
      .then(() => ajustarAnchas(nodo))
      .catch(() => {});
  }

  // Una fórmula en renglón más ancha que su párrafo se vuelve deslizable, para no ensanchar la página.
  function ajustarAnchas(raiz) {
    $$('mjx-container:not([display="true"])', raiz).forEach((formula) => {
      formula.classList.remove('ancha');
      let bloque = formula.parentElement;
      while (bloque && getComputedStyle(bloque).display.startsWith('inline')) bloque = bloque.parentElement;
      if (!bloque) return;
      const estilo = getComputedStyle(bloque);
      const disponible = bloque.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
      if (formula.getBoundingClientRect().width > disponible + 1) formula.classList.add('ancha');
    });
  }

  // ------------------------------------------------------------ cifrado
  const deBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const aBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

  async function derivar(clave, C) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: deBase64(C.sal), iterations: C.iter, hash: 'SHA-256' }, base, 256);
  }

  async function descifrar(bits, C) {
    const llave = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(C.iv) }, llave, deBase64(C.datos));
    return JSON.parse(new TextDecoder().decode(plano));
  }

  async function abrir() {
    if (window.DATOS) return arrancar(window.DATOS);
    const C = window.DATOS_CIFRADOS;
    const candado = $('#candado');
    const error = $('#errorClave');
    if (!C) {
      candado.hidden = false;
      error.hidden = false;
      error.textContent = 'No se encontró el contenido.';
      return undefined;
    }
    const guardada = memoria.leer('llave', null);
    if (guardada && guardada.sal === C.sal) {
      try { return arrancar(await descifrar(deBase64(guardada.bits), C)); } catch { memoria.borrar('llave'); }
    }
    candado.hidden = false;
    $('#clave').focus();
    $('#formaClave').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = $('#formaClave button');
      boton.disabled = true;
      boton.textContent = 'Abriendo…';
      error.hidden = true;
      try {
        const bits = await derivar($('#clave').value, C);
        const datos = await descifrar(bits, C);
        if ($('#recordar').checked) memoria.guardar('llave', { sal: C.sal, bits: aBase64(bits) });
        candado.hidden = true;
        arrancar(datos);
      } catch {
        error.hidden = false;
        error.textContent = 'La contraseña no es correcta.';
        boton.disabled = false;
        boton.textContent = 'Abrir';
        $('#clave').select();
      }
    });
    return undefined;
  }

  // ------------------------------------------------------------ estado
  let D = null;
  const ESTADOS = ['Sin marcar', 'Por repasar', 'Dominado'];
  const progreso = () => memoria.leer('progreso', {});
  const tarjetasMarcadas = () => memoria.leer('tarjetas', {});

  const examen = (id) => D.examenes.find((e) => e.id === id && e.estado === 'listo');
  const incisosDe = (p) => p.incisos.filter((i) => !i.grupo);

  function avance(ex, p) {
    const marcas = progreso();
    const incisos = p ? incisosDe(p) : ex.problemas.flatMap(incisosDe);
    const dominados = incisos.filter((i) => marcas[`${ex.id}.${i.clave}`] === 2).length;
    return { dominados, total: incisos.length };
  }

  // ------------------------------------------------------------ contenido plegable
  const perezosos = new Map();
  let serie = 0;
  const guardarPerezoso = (html) => { const id = `z${++serie}`; perezosos.set(id, html); return id; };

  function plegable(titulo, cuerpo, clase = '') {
    return `<details class="plegable ${clase}" data-pz="${guardarPerezoso(cuerpo)}"><summary>${titulo}</summary><div class="plegable-cuerpo"></div></details>`;
  }

  function pasosHtml(pasos) {
    if (pasos.length === 1) return pasos[0].html;
    const elementos = pasos.map((paso, k) => {
      const titulo = paso.titulo || (k === 0 ? 'Planteamiento' : `Paso ${k + 1}`);
      return `<li class="paso" hidden data-pz="${guardarPerezoso(paso.html)}"><h4><span class="num">${k + 1}</span> ${titulo}</h4><div class="paso-cuerpo"></div></li>`;
    }).join('');
    return `<div class="pasos"><ol class="pasos-lista">${elementos}</ol>
      <div class="pasos-botones">
        <button type="button" class="primario" data-accion="siguiente">Siguiente paso</button>
        <button type="button" data-accion="todos">Ver todos</button>
        <span class="cuenta" aria-live="polite"></span>
      </div></div>`;
  }

  function activarPasos(raiz) {
    $$('.pasos', raiz).forEach((caja) => {
      const pasos = $$('.paso', caja);
      const cuenta = $('.cuenta', caja);
      const siguiente = $('[data-accion="siguiente"]', caja);
      const todos = $('[data-accion="todos"]', caja);
      const mostrar = (paso) => {
        if (!paso.hidden) return;
        paso.hidden = false;
        const cuerpo = $('.paso-cuerpo', paso);
        cuerpo.innerHTML = perezosos.get(paso.dataset.pz);
        componer(paso);
      };
      const actualizar = () => {
        const vistos = pasos.filter((p) => !p.hidden).length;
        cuenta.textContent = `${vistos} de ${pasos.length}`;
        const fin = vistos === pasos.length;
        siguiente.hidden = fin;
        todos.hidden = fin;
      };
      siguiente.addEventListener('click', () => {
        const paso = pasos.find((p) => p.hidden);
        if (paso) { mostrar(paso); paso.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        actualizar();
      });
      todos.addEventListener('click', () => { pasos.forEach(mostrar); actualizar(); });
      mostrar(pasos[0]);
      actualizar();
    });
  }

  function activarPlegables(raiz) {
    $$('details[data-pz]', raiz).forEach((detalle) => {
      const llenar = () => {
        if (!detalle.open || detalle.dataset.listo) return;
        detalle.dataset.listo = '1';
        const cuerpo = detalle.querySelector(':scope > .plegable-cuerpo');
        cuerpo.innerHTML = perezosos.get(detalle.dataset.pz);
        activarPasos(cuerpo);
        componer(cuerpo);
      };
      detalle.addEventListener('toggle', llenar);
      llenar();
    });
  }

  // ------------------------------------------------------------ vistas
  const lista = (elementos, etiqueta = 'ul') => `<${etiqueta}>${elementos.map((e) => `<li>${e}</li>`).join('')}</${etiqueta}>`;

  function vistaInicio() {
    const tarjetas = D.examenes.map((ex) => {
      if (ex.estado !== 'listo') {
        return `<article class="ficha inactiva"><h2>${escapar(ex.sinodal)}</h2><p class="tema">${escapar(ex.materia)}</p><p class="nota">Próximamente</p></article>`;
      }
      const { dominados, total } = avance(ex);
      return `<article class="ficha">
        <h2>${escapar(ex.sinodal)}</h2>
        <p class="tema">${escapar(ex.materia)} · ${ex.problemas.length} problemas</p>
        <div class="barra-avance" role="img" aria-label="${dominados} de ${total} incisos dominados"><span style="width:${total ? (100 * dominados) / total : 0}%"></span></div>
        <p class="nota">${dominados} de ${total} incisos dominados</p>
        <div class="acciones">
          <a class="boton primario" href="#/e/${ex.id}/p/${ex.problemas[0].n}">Estudiar</a>
          <a class="boton" href="#/e/${ex.id}/reconocer">Reconocer</a>
          <a class="boton" href="#/e/${ex.id}/repaso">Repaso</a>
        </div>
      </article>`;
    }).join('');
    return `<h1>Guía de estudio</h1>
      <p class="entrada">Cada problema trae lo que hay que saber para sostenerlo: de qué trata, cómo reconocerlo, los antecedentes, el resultado, la demostración paso a paso, los errores típicos y las preguntas que pueden hacerte.</p>
      <div class="fichas">${tarjetas}</div>
      <section class="ayuda">
        <h2>Cómo usarla</h2>
        ${lista([
          '<strong>Estudiar.</strong> Lee el enunciado, intenta resolver y abre cada bloque sólo para comprobar. La demostración se revela paso por paso.',
          '<strong>Reconocer.</strong> Las señales del enunciado que indican qué herramienta usar, problema por problema.',
          '<strong>Repaso.</strong> Tarjetas con las preguntas probables. Marca las que fallas y vuelve sólo a ésas.',
          '<strong>Avance.</strong> El botón de cada inciso cambia entre sin marcar, por repasar y dominado. Se guarda en este dispositivo.',
        ])}
      </section>`;
  }

  function botonEstado(ex, inciso) {
    const valor = progreso()[`${ex.id}.${inciso.clave}`] || 0;
    return `<button type="button" class="estado e${valor}" data-estado="${ex.id}.${inciso.clave}" aria-label="Estado del inciso: ${ESTADOS[valor]}. Tocar para cambiar.">${ESTADOS[valor]}</button>`;
  }

  function incisoHtml(ex, inciso) {
    if (inciso.grupo) {
      return `<article class="inciso grupo" id="${inciso.clave}">
        <header><span class="id">${inciso.id}</span><h3>${inciso.titulo}</h3></header>
        <div class="pregunta">${inciso.pregunta}</div></article>`;
    }
    const preguntas = inciso.preguntas.map((par) => plegable(par.q, par.a, 'duda')).join('');
    return `<article class="inciso nivel${inciso.nivel}" id="${inciso.clave}">
      <header><span class="id">${inciso.id}</span><h3>${inciso.titulo}</h3>${botonEstado(ex, inciso)}</header>
      <div class="pregunta" lang="en">${inciso.pregunta}</div>
      ${plegable('Resultado', `<p>${inciso.resultado}</p>`, 'resultado')}
      ${plegable('Plan de ataque', lista(inciso.idea, 'ol'), 'plan')}
      ${plegable(`Demostración paso a paso${inciso.pasos.length > 1 ? ` <span class="cuantos">${inciso.pasos.length} pasos</span>` : ''}`, pasosHtml(inciso.pasos), 'demostracion')}
      ${plegable('Errores que hay que evitar', lista(inciso.trampas), 'trampas')}
      <h4 class="rotulo">Si te preguntan</h4>
      <div class="dudas">${preguntas}</div>
    </article>`;
  }

  function vistaProblema(ex, n) {
    const k = ex.problemas.findIndex((p) => p.n === n);
    const p = ex.problemas[k];
    if (!p) return '<h1>No existe ese problema</h1>';
    const anterior = ex.problemas[k - 1];
    const siguiente = ex.problemas[k + 1];
    return `<p class="migas"><a href="#/">Inicio</a> › ${escapar(ex.sinodal)}</p>
      <h1>Problema ${p.n}<span class="subtitulo">${p.titulo}</span></h1>
      <p class="tema">${p.tema}</p>
      <section class="enunciado" lang="en"><h2>Enunciado</h2>${p.enunciado}</section>
      <section><h2>De qué trata</h2><p>${p.resumen}</p></section>
      <section><h2>Cómo reconocerlo</h2>${lista(p.reconocer)}</section>
      ${plegable(`Antecedentes que hay que dominar <span class="cuantos">${p.antecedentes.length}</span>`, lista(p.antecedentes), 'antecedentes')}
      <div class="herramientas">
        <button type="button" data-accion="abrir">Abrir todo</button>
        <button type="button" data-accion="cerrar">Cerrar todo</button>
      </div>
      ${p.incisos.map((i) => incisoHtml(ex, i)).join('')}
      <nav class="paginas" aria-label="Problema anterior y siguiente">
        ${anterior ? `<a class="boton" href="#/e/${ex.id}/p/${anterior.n}">‹ Problema ${anterior.n}</a>` : '<span></span>'}
        ${siguiente ? `<a class="boton primario" href="#/e/${ex.id}/p/${siguiente.n}">Problema ${siguiente.n} ›</a>` : `<a class="boton primario" href="#/e/${ex.id}/repaso">Ir al repaso ›</a>`}
      </nav>`;
  }

  function vistaReconocer(ex) {
    const bloques = ex.problemas.map((p) => `<section class="senales">
        <h2><a href="#/e/${ex.id}/p/${p.n}">Problema ${p.n}. ${p.titulo}</a></h2>
        <p class="tema">${p.tema}</p>
        ${lista(p.reconocer)}
        <p class="resultados"><strong>Resultados:</strong></p>
        ${lista(incisosDe(p).map((i) => `<span class="id">${i.id}</span> ${i.resultado}`))}
      </section>`).join('');
    return `<p class="migas"><a href="#/">Inicio</a> › ${escapar(ex.sinodal)}</p>
      <h1>Cómo reconocer cada problema</h1>
      <p class="entrada">Las señales del enunciado que indican qué herramienta usar, y a qué resultado se llega.</p>${bloques}`;
  }

  function vistaBibliografia(ex) {
    return `<p class="migas"><a href="#/">Inicio</a> › ${escapar(ex.sinodal)}</p>
      <h1>Bibliografía</h1>${lista(ex.bibliografia).replace('<ul>', '<ul class="sin">')}`;
  }

  // ------------------------------------------------------------ repaso con tarjetas
  function mazo(ex) {
    const tarjetas = [];
    for (const p of ex.problemas) {
      for (const i of incisosDe(p)) {
        const etiqueta = `Problema ${p.n} ${i.id}`;
        const enlace = `#/e/${ex.id}/p/${p.n}/${i.clave}`;
        tarjetas.push({ id: `${ex.id}.${i.clave}.r`, n: p.n, etiqueta, enlace, frente: `<p class="mini">Da el resultado</p><div lang="en">${i.pregunta}</div>`, reverso: `<p>${i.resultado}</p>` });
        i.preguntas.forEach((par, k) => tarjetas.push({ id: `${ex.id}.${i.clave}.${k}`, n: p.n, etiqueta, enlace, frente: `<p>${par.q}</p>`, reverso: par.a }));
      }
    }
    return tarjetas;
  }

  function barajar(arreglo) {
    const a = [...arreglo];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function vistaRepaso(ex) {
    const opciones = ex.problemas.map((p) => `<option value="${p.n}">Problema ${p.n}</option>`).join('');
    return `<p class="migas"><a href="#/">Inicio</a> › ${escapar(ex.sinodal)}</p>
      <h1>Repaso con tarjetas</h1>
      <div class="filtros">
        <label>Problemas <select id="filtroProblema"><option value="0">Todos</option>${opciones}</select></label>
        <label class="casilla"><input type="checkbox" id="filtroRepasar"> Sólo las que marqué para repasar</label>
      </div>
      <p id="resumenRepaso" class="nota" aria-live="polite"></p>
      <div id="tarjeta" class="tarjeta"></div>`;
  }

  function activarRepaso(ex) {
    const todas = mazo(ex);
    const caja = $('#tarjeta');
    let pila = [];
    let actual = 0;

    const resumen = () => {
      const marcas = tarjetasMarcadas();
      const sabidas = todas.filter((t) => marcas[t.id] === 2).length;
      const repasar = todas.filter((t) => marcas[t.id] === 1).length;
      $('#resumenRepaso').textContent = `${todas.length} tarjetas · ${sabidas} sabidas · ${repasar} por repasar`;
    };

    const pintar = () => {
      resumen();
      if (!pila.length) {
        caja.innerHTML = '<p class="vacia">No hay tarjetas con ese filtro.</p>';
        return;
      }
      if (actual >= pila.length) {
        caja.innerHTML = `<p class="vacia">Terminaste esta vuelta (${pila.length} tarjetas).</p><div class="acciones"><button type="button" class="primario" data-accion="otra">Otra vuelta</button></div>`;
        return;
      }
      const t = pila[actual];
      caja.innerHTML = `<p class="mini"><a href="${t.enlace}">${t.etiqueta}</a><span>${actual + 1} de ${pila.length}</span></p>
        <div class="frente">${t.frente}</div>
        <div class="reverso" hidden>${t.reverso}</div>
        <div class="acciones">
          <button type="button" class="primario" data-accion="voltear">Mostrar respuesta</button>
          <button type="button" data-accion="repasar" hidden>Repasar</button>
          <button type="button" class="primario" data-accion="sabida" hidden>La sé</button>
        </div>`;
      componer(caja);
    };

    const armar = () => {
      const n = Number($('#filtroProblema').value);
      const soloRepasar = $('#filtroRepasar').checked;
      const marcas = tarjetasMarcadas();
      pila = barajar(todas.filter((t) => (!n || t.n === n) && (!soloRepasar || marcas[t.id] === 1)));
      actual = 0;
      pintar();
    };

    const marcar = (valor) => {
      const marcas = tarjetasMarcadas();
      marcas[pila[actual].id] = valor;
      memoria.guardar('tarjetas', marcas);
      actual += 1;
      pintar();
    };

    caja.addEventListener('click', (evento) => {
      const accion = evento.target.closest('[data-accion]')?.dataset.accion;
      if (accion === 'voltear') {
        $('.reverso', caja).hidden = false;
        evento.target.hidden = true;
        $$('[data-accion="repasar"], [data-accion="sabida"]', caja).forEach((b) => { b.hidden = false; });
      } else if (accion === 'repasar') marcar(1);
      else if (accion === 'sabida') marcar(2);
      else if (accion === 'otra') armar();
    });
    $('#filtroProblema').addEventListener('change', armar);
    $('#filtroRepasar').addEventListener('change', armar);
    armar();
  }

  // ------------------------------------------------------------ búsqueda
  let indice = null;
  function construirIndice() {
    indice = [];
    for (const ex of D.examenes.filter((e) => e.estado === 'listo')) {
      for (const p of ex.problemas) {
        const base = { enlace: `#/e/${ex.id}/p/${p.n}`, donde: `Problema ${p.n}` };
        const agregar = (html, seccion, extra = {}) => {
          const texto = textoPlano(html);
          indice.push({ ...base, ...extra, seccion, texto, llano: normal(texto) });
        };
        agregar(`${p.titulo}. ${p.tema}. ${p.resumen}`, 'De qué trata');
        agregar(p.enunciado, 'Enunciado');
        p.reconocer.forEach((r) => agregar(r, 'Cómo reconocerlo'));
        p.antecedentes.forEach((a) => agregar(a, 'Antecedentes'));
        for (const i of incisosDe(p)) {
          const extra = { enlace: `#/e/${ex.id}/p/${p.n}/${i.clave}`, donde: `Problema ${p.n} ${i.id}` };
          agregar(`${i.titulo}. ${i.pregunta}`, 'Pregunta', extra);
          agregar(i.resultado, 'Resultado', extra);
          i.idea.forEach((t) => agregar(t, 'Plan de ataque', extra));
          i.trampas.forEach((t) => agregar(t, 'Errores', extra));
          i.preguntas.forEach((par) => agregar(`${par.q} ${par.a}`, 'Si te preguntan', extra));
          i.pasos.forEach((paso) => agregar(paso.html, 'Demostración', extra));
        }
      }
    }
  }

  function vistaBusqueda(consulta) {
    if (!indice) construirIndice();
    const q = normal(consulta.trim());
    const hallados = indice.filter((e) => e.llano.includes(q)).slice(0, 60);
    const filas = hallados.map((e) => {
      const pos = e.llano.indexOf(q);
      const desde = Math.max(0, pos - 60);
      const trozo = `${desde > 0 ? '…' : ''}${e.texto.slice(desde, pos + q.length + 90)}…`;
      return `<li><a href="${e.enlace}"><span class="donde">${e.donde} · ${e.seccion}</span><span class="trozo">${escapar(trozo)}</span></a></li>`;
    }).join('');
    return `<h1>Búsqueda</h1><p class="nota">${hallados.length ? `${hallados.length} coincidencias de «${escapar(consulta)}»` : `Sin coincidencias de «${escapar(consulta)}»`}</p><ul class="hallazgos">${filas}</ul>`;
  }

  // ------------------------------------------------------------ menú y rutas
  function pintarMenu(ruta) {
    const bloques = D.examenes.map((ex) => {
      if (ex.estado !== 'listo') {
        return `<div class="menu-examen inactivo"><p class="menu-titulo">${escapar(ex.sinodal)}</p><p class="nota">Próximamente</p></div>`;
      }
      const problemas = ex.problemas.map((p) => {
        const { dominados, total } = avance(ex, p);
        const activo = ruta.ex === ex.id && ruta.vista === 'p' && ruta.n === p.n;
        return `<li><a href="#/e/${ex.id}/p/${p.n}"${activo ? ' aria-current="page"' : ''}><span class="n">${p.n}</span><span class="t">${p.titulo}</span><span class="av${dominados === total ? ' completo' : ''}">${dominados}/${total}</span></a></li>`;
      }).join('');
      const enlace = (vista, texto) => `<li><a href="#/e/${ex.id}/${vista}"${ruta.ex === ex.id && ruta.vista === vista ? ' aria-current="page"' : ''}>${texto}</a></li>`;
      return `<div class="menu-examen">
        <p class="menu-titulo">${escapar(ex.sinodal)}</p>
        <p class="nota">${escapar(ex.materia)}</p>
        <ul class="menu-problemas">${problemas}</ul>
        <ul class="menu-extras">${enlace('reconocer', 'Cómo reconocer cada problema')}${enlace('repaso', 'Repaso con tarjetas')}${enlace('bib', 'Bibliografía')}</ul>
      </div>`;
    }).join('');
    $('#menu').innerHTML = bloques;
  }

  function leerRuta() {
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (partes[0] !== 'e' || !examen(partes[1])) return { vista: 'inicio' };
    const ruta = { ex: partes[1], vista: partes[2] || 'p' };
    if (ruta.vista === 'p') { ruta.n = Number(partes[3]) || 1; ruta.foco = partes[4]; }
    return ruta;
  }

  function cerrarMenu() {
    document.body.classList.remove('menu-abierto');
    $('#botonMenu').setAttribute('aria-expanded', 'false');
  }

  function pintar() {
    const consulta = $('#buscar').value;
    const ruta = leerRuta();
    const vista = $('#vista');
    perezosos.clear();
    const ex = ruta.ex ? examen(ruta.ex) : null;
    if (consulta.trim().length >= 2) vista.innerHTML = vistaBusqueda(consulta);
    else if (ruta.vista === 'p') vista.innerHTML = vistaProblema(ex, ruta.n);
    else if (ruta.vista === 'reconocer') vista.innerHTML = vistaReconocer(ex);
    else if (ruta.vista === 'repaso') vista.innerHTML = vistaRepaso(ex);
    else if (ruta.vista === 'bib') vista.innerHTML = vistaBibliografia(ex);
    else vista.innerHTML = vistaInicio();

    pintarMenu(ruta);
    activarPlegables(vista);
    componer(vista);
    if (ruta.vista === 'repaso' && consulta.trim().length < 2) activarRepaso(ex);
    cerrarMenu();
    const foco = ruta.foco && document.getElementById(ruta.foco);
    if (foco) cola.then(() => foco.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }

  function arrancar(datos) {
    D = datos;
    $('#app').hidden = false;

    const tema = memoria.leer('tema', null);
    if (tema) document.documentElement.dataset.tema = tema;
    $('#botonTema').addEventListener('click', () => {
      const oscuro = document.documentElement.dataset.tema
        ? document.documentElement.dataset.tema === 'oscuro'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      const nuevo = oscuro ? 'claro' : 'oscuro';
      document.documentElement.dataset.tema = nuevo;
      memoria.guardar('tema', nuevo);
    });

    $('#botonMenu').addEventListener('click', () => {
      const abierto = document.body.classList.toggle('menu-abierto');
      $('#botonMenu').setAttribute('aria-expanded', String(abierto));
    });

    let espera = null;
    $('#buscar').addEventListener('input', () => {
      clearTimeout(espera);
      espera = setTimeout(pintar, 200);
    });

    $('#vista').addEventListener('click', (evento) => {
      const boton = evento.target.closest('button');
      if (!boton) return;
      if (boton.dataset.estado) {
        const marcas = progreso();
        const valor = ((marcas[boton.dataset.estado] || 0) + 1) % 3;
        marcas[boton.dataset.estado] = valor;
        memoria.guardar('progreso', marcas);
        boton.className = `estado e${valor}`;
        boton.textContent = ESTADOS[valor];
        boton.setAttribute('aria-label', `Estado del inciso: ${ESTADOS[valor]}. Tocar para cambiar.`);
        pintarMenu(leerRuta());
      } else if (boton.dataset.accion === 'abrir' || boton.dataset.accion === 'cerrar') {
        $$('#vista details').forEach((d) => { d.open = boton.dataset.accion === 'abrir'; });
      }
    });

    // Al seguir un resultado de la búsqueda se limpia el buscador para mostrar la página destino.
    $('#vista').addEventListener('click', (evento) => {
      const enlace = evento.target.closest('a');
      if (!enlace || !$('#buscar').value) return;
      $('#buscar').value = '';
      if (enlace.hash === location.hash) pintar();
    });

    let esperaGiro = null;
    window.addEventListener('resize', () => {
      clearTimeout(esperaGiro);
      esperaGiro = setTimeout(() => ajustarAnchas($('#vista')), 250);
    });

    window.addEventListener('hashchange', pintar);
    pintar();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  abrir();
})();
