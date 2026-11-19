(() => {
  'use strict';

  // ------------------------------------------------------------ utilidades
  const $ = (selector, raiz = document) => raiz.querySelector(selector);
  const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];
  const normal = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const textoPlano = (html) => html
    .replace(/<span class="fm"[^>]*data-tex="([^"]*)"[^>]*><\/span>/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
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
  // ------------------------------------------------------------ fórmulas
  // Cada fórmula llega como <span class="fm" data-m="i|d|a" data-tex="...">. Se compone y, si no cabe
  // en el ancho disponible, se vuelve a componer partida: primero en los espacios largos (\qquad),
  // después en cada signo de relación, que pasa al renglón siguiente. Sólo si aún no cabe se reduce
  // de tamaño, y como último recurso queda deslizable.
  const RELACIONES = new Set(['=', '<', '>', '\\iff', '\\Rightarrow', '\\approx', '\\le', '\\ge', '\\leq', '\\geq',
    '\\dto', '\\pto', '\\cseg', '\\to', '\\sim', '\\equiv', '\\propto', '\\subseteq']);
  const ESCALA_MINIMA = 0.72;
  const LARGO_TROZO = 34;

  // Parte el LaTeX en cortes que no caen dentro de llaves, \left...\right ni entornos. El criterio recibe
  // la ficha y su contexto: cuántos paréntesis abiertos hay, el texto acumulado y lo que sigue.
  function partir(tex, esCorte) {
    const partes = [{ sep: '', texto: '' }];
    let llaves = 0;
    let pares = 0;
    let izqder = 0;
    let entornos = 0;
    let i = 0;
    while (i < tex.length) {
      let ficha = tex[i];
      if (ficha === '\\') {
        ficha = /^\\(?:[a-zA-Z]+|[\s\S])/.exec(tex.slice(i))?.[0] || '\\';
        if (ficha === '\\left') izqder += 1;
        else if (ficha === '\\right') izqder = Math.max(0, izqder - 1);
        else if (ficha === '\\begin') entornos += 1;
        else if (ficha === '\\end') entornos = Math.max(0, entornos - 1);
        else if (ficha === '\\{') pares += 1;
        else if (ficha === '\\}') pares = Math.max(0, pares - 1);
      } else if (ficha === '{') llaves += 1;
      else if (ficha === '}') llaves = Math.max(0, llaves - 1);
      else if (ficha === '(' || ficha === '[') pares += 1;
      else if (ficha === ')' || ficha === ']') pares = Math.max(0, pares - 1);

      const actual = partes[partes.length - 1];
      const libre = !llaves && !izqder && !entornos;
      if (libre && esCorte(ficha, { pares, texto: actual.texto, resto: tex.slice(i + ficha.length) })) partes.push({ sep: ficha, texto: '' });
      else actual.texto += ficha;
      i += ficha.length;
    }
    return partes;
  }

  const arriba = (prueba) => (ficha, contexto) => contexto.pares === 0 && prueba(ficha);
  const esRelacion = arriba((t) => RELACIONES.has(t));
  const esEspacioLargo = arriba((t) => t === '\\qquad');
  const esMarca = arriba((t) => t === '&');
  const esSalto = arriba((t) => t === '\\\\');

  // Sumas y restas de nivel superior (no el signo de un término) y comas seguidas de un espacio explícito.
  const SIGNO_DE_TERMINO = /(?:^|[=(\[{,+\-&]|\\(?:le|ge|leq|geq|iff|cdot|times|Bigl|bigl|Bigr|bigr|left|quad|qquad|[;,!{]))\s*$/;
  const esOperador = (ficha, contexto) => {
    if ((ficha === '+' || ficha === '-') && contexto.pares === 0) return !SIGNO_DE_TERMINO.test(contexto.texto);
    if (ficha === ',' && contexto.pares <= 1) return /^\s*(?:\\ |\\q?quad|\\dots)/.test(contexto.resto);
    return false;
  };

  // Renglones de una cadena «a = b = c»: la primera relación se queda arriba y las demás bajan.
  function renglonesDeCadena(cabeza, texto) {
    const p = partir(texto, esRelacion);
    const primero = `${cabeza}${p[0].texto}${p[1] ? `${p[1].sep}${p[1].texto}` : ''}`;
    return [primero, ...p.slice(2).map((x) => `& ${x.sep}${x.texto}`)];
  }

  // Trozos de un término largo, cortado en sumas, restas y comas; la coma se queda al final de su renglón.
  function trozosDe(texto, fino) {
    if (!fino || texto.trim().length <= LARGO_TROZO) return [{ sep: '', texto }];
    const trozos = partir(texto, esOperador);
    for (let k = 1; k < trozos.length; k++) {
      if (trozos[k].sep === ',') { trozos[k - 1].texto += ','; trozos[k].sep = ''; }
    }
    return trozos;
  }

  function partirEnRenglon(tex, fino) {
    const piezas = [];
    partir(tex, esRelacion).forEach((x, k) => {
      if (k === 0 && !x.texto.trim()) return;
      trozosDe(x.texto, fino).forEach((t, j) => {
        const signo = j === 0 ? x.sep : t.sep;
        piezas.push(`${signo ? `{}${signo} ` : ''}${t.texto}`);
      });
    });
    return piezas.length > 1 ? piezas.map((p) => `\\(${p}\\)`).join('​') : null;
  }

  function partirDesplegada(tex, nivel) {
    const segmentos = partir(tex, esEspacioLargo).map((s) => s.texto.trim()).filter(Boolean);
    if (nivel === 1) {
      return segmentos.length > 1 ? `\\[\\begin{gathered}${segmentos.join(' \\\\ ')}\\end{gathered}\\]` : null;
    }
    const renglones = [];
    let cambia = segmentos.length > 1;
    for (const segmento of segmentos) {
      const p = partir(segmento, esRelacion);
      if (p.length < 2) { renglones.push(`& ${segmento}`); continue; }
      if (p.length > 2) cambia = true;
      renglones.push(`${p[0].texto} & ${p[1].sep}${p[1].texto}`, ...p.slice(2).map((x) => `& ${x.sep}${x.texto}`));
    }
    return cambia ? `\\[\\begin{aligned}${renglones.join(' \\\\ ')}\\end{aligned}\\]` : null;
  }

  const ENTORNO = /^\\begin\{([a-z]+\*?)\}([\s\S]*)\\end\{\1\}$/;

  function partirAlineada(tex, nivel) {
    const m = ENTORNO.exec(tex.trim());
    if (!m) return null;
    const renglones = [];
    for (const fila of partir(m[2], esSalto)) {
      const texto = fila.texto.replace(/^\s*\[[^\]]*\]/, '').trim();
      if (!texto) continue;
      partir(texto, esEspacioLargo).map((s) => s.texto.trim()).filter(Boolean).forEach((segmento, k) => {
        const conMarca = partir(segmento, esMarca).length > 1;
        const base = k === 0 || conMarca ? segmento : `& ${segmento}`;
        if (nivel === 1) { renglones.push(base); return; }
        const corte = base.indexOf('&');
        if (corte < 0) renglones.push(...renglonesDeCadena('', base));
        else renglones.push(...renglonesDeCadena(base.slice(0, corte + 1), base.slice(corte + 1)));
      });
    }
    return `\\begin{${m[1]}}${renglones.join(' \\\\\n')}\\end{${m[1]}}`;
  }

  // Cadenas de una fórmula desplegada o alineada, sin marcas de alineación.
  function segmentosDe(tex, modo) {
    const limpiar = (texto) => partir(texto, esEspacioLargo).map((s) => s.texto.trim()).filter(Boolean);
    if (modo === 'd') return limpiar(tex);
    const m = ENTORNO.exec(tex.trim());
    if (!m) return [tex];
    return partir(m[2], esSalto).flatMap((fila) => {
      const texto = partir(fila.texto.replace(/^\s*\[[^\]]*\]/, ''), esMarca).map((x) => x.texto).join('');
      return limpiar(texto);
    });
  }

  // Formato compacto para pantallas angostas: el lado izquierdo en su renglón y cada relación debajo,
  // con poca sangría; con «fino», los términos largos se cortan además en sumas, restas y comas.
  function compacta(tex, modo, fino) {
    const filas = [];
    for (const segmento of segmentosDe(tex, modo)) {
      const p = partir(segmento, esRelacion);
      if (p[0].texto.trim()) {
        const cabeza = trozosDe(p[0].texto, fino);
        filas.push(`& ${cabeza[0].texto}`, ...cabeza.slice(1).map((t) => `&\\quad {}${t.sep} ${t.texto}`));
      }
      for (const x of p.slice(1)) {
        const t = trozosDe(x.texto, fino);
        filas.push(`&\\quad {}${x.sep} ${t[0].texto}`, ...t.slice(1).map((y) => `&\\qquad {}${y.sep} ${y.texto}`));
      }
    }
    return filas.length > 1 ? `\\[\\begin{aligned}${filas.join(' \\\\\n')}\\end{aligned}\\]` : null;
  }

  // Niveles: 0 original; 1 corta en \qquad; 2 corta en relaciones; 3 formato compacto; 4 compacto y fino.
  const NIVELES = [1, 2, 3, 4];
  function fuenteDe(formula, nivel) {
    const { tex, m: modo } = formula.dataset;
    if (nivel === 0) return modo === 'i' ? `\\(${tex}\\)` : modo === 'd' ? `\\[${tex}\\]` : tex;
    if (modo === 'i') return nivel === 2 ? partirEnRenglon(tex, false) : nivel === 4 ? partirEnRenglon(tex, true) : null;
    if (nivel >= 3) return compacta(tex, modo, nivel === 4);
    return modo === 'd' ? partirDesplegada(tex, nivel) : partirAlineada(tex, nivel);
  }

  function anchoDisponible(formula) {
    let bloque = formula.parentElement;
    while (bloque && getComputedStyle(bloque).display.startsWith('inline')) bloque = bloque.parentElement;
    if (!bloque) return Infinity;
    const estilo = getComputedStyle(bloque);
    const sangria = bloque.tagName === 'SUMMARY' ? 22 : 0;
    return bloque.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight) - sangria;
  }

  const dibujos = (formula) => $$('mjx-container > svg', formula);
  const anchoDe = (formula) => Math.max(0, ...dibujos(formula).map((s) => s.getBoundingClientRect().width));

  function desborda(formula) {
    if (formula.closest('table')) return false;
    return anchoDe(formula) > anchoDisponible(formula) + 1;
  }

  // Reduce lo que todavía no cabe, hasta un mínimo legible; por debajo de eso queda deslizable.
  function encoger(formula) {
    if (formula.closest('table')) return;
    const disponible = anchoDisponible(formula);
    for (const svg of dibujos(formula)) {
      const ancho = svg.getBoundingClientRect().width;
      const caja = svg.parentElement;
      if (ancho <= disponible + 1) continue;
      const escala = Math.max(disponible / ancho, ESCALA_MINIMA);
      const alineacion = parseFloat(svg.style.verticalAlign);
      svg.style.width = `${ancho * escala}px`;
      svg.style.height = 'auto';
      if (!Number.isNaN(alineacion)) svg.style.verticalAlign = `${alineacion * escala}ex`;
      caja.classList.toggle('ancha', ancho * escala > disponible + 1);
    }
  }

  function prepararFormulas(raiz) {
    $$('.fm:not([data-n])', raiz).forEach((formula) => {
      formula.dataset.n = '0';
      formula.textContent = fuenteDe(formula, 0);
    });
  }

  async function ajustarFormulas(raiz) {
    for (const nivel of NIVELES) {
      const cambiadas = [];
      for (const formula of $$('.fm', raiz)) {
        if (Number(formula.dataset.n) >= nivel || !desborda(formula)) continue;
        formula.dataset.n = String(nivel);
        const fuente = fuenteDe(formula, nivel);
        if (!fuente) continue;
        MathJax.typesetClear([formula]);
        formula.textContent = fuente;
        cambiadas.push(formula);
      }
      if (cambiadas.length) await MathJax.typesetPromise(cambiadas);
    }
    $$('.fm', raiz).forEach(encoger);
  }

  let cola = Promise.resolve();
  function componer(nodo) {
    if (!window.MathJax || !MathJax.startup) return;
    cola = cola
      .then(() => MathJax.startup.promise)
      .then(() => { prepararFormulas(nodo); return MathJax.typesetPromise([nodo]); })
      .then(() => ajustarFormulas(nodo))
      .catch((error) => console.error(error));
  }

  // Al girar el teléfono cambia el ancho: se parte de nuevo desde la fórmula original.
  function recomponer(raiz) {
    cola = cola.then(() => {
      MathJax.typesetClear([raiz]);
      $$('.fm', raiz).forEach((formula) => { delete formula.dataset.n; });
    }).catch(() => {});
    componer(raiz);
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
    return `<details class="plegable ${clase}" data-pz="${guardarPerezoso(cuerpo)}"><summary><span class="titulo">${titulo}</span></summary><div class="plegable-cuerpo"></div></details>`;
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
      ${inciso.oral ? plegable('Cómo decirlo en voz alta', `<p>${inciso.oral}</p>`, 'oral') : ''}
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

  const teoremaHtml = (t) => `${t.enunciado}
    <h4 class="rotulo">Demostración</h4>${lista(t.demostracion, 'ol')}
    ${t.donde ? `<p class="nota"><strong>Dónde se usa:</strong> ${t.donde}</p>` : ''}`;

  function vistaTeoremas(ex) {
    return `<p class="migas"><a href="#/">Inicio</a> › ${escapar(ex.sinodal)}</p>
      <h1>Teoremas clave</h1>
      <p class="entrada">Los resultados en que se apoyan las soluciones, con su enunciado preciso y la demostración en pasos. Intenta enunciarlos antes de abrirlos.</p>
      <div class="herramientas">
        <button type="button" data-accion="abrir">Abrir todo</button>
        <button type="button" data-accion="cerrar">Cerrar todo</button>
      </div>
      ${ex.teoremas.map((t) => plegable(t.nombre, teoremaHtml(t), 'teorema')).join('')}`;
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
    for (const t of ex.teoremas || []) {
      tarjetas.push({ id: `${ex.id}.${t.clave}`, n: -1, etiqueta: 'Teoremas clave', enlace: `#/e/${ex.id}/teoremas`, frente: `<p class="mini">Enuncia y demuestra</p><p>${t.nombre}</p>`, reverso: teoremaHtml(t) });
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
        <label>Tarjetas de <select id="filtroProblema"><option value="0">Todo</option>${opciones}${(ex.teoremas || []).length ? '<option value="-1">Teoremas clave</option>' : ''}</select></label>
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
      for (const t of ex.teoremas || []) {
        const texto = textoPlano(`${t.nombre}. ${t.enunciado} ${t.demostracion.join(' ')}`);
        indice.push({ enlace: `#/e/${ex.id}/teoremas`, donde: ex.sinodal, seccion: 'Teoremas clave', texto, llano: normal(texto) });
      }
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
        <ul class="menu-extras">${enlace('reconocer', 'Cómo reconocer cada problema')}${(ex.teoremas || []).length ? enlace('teoremas', 'Teoremas clave') : ''}${enlace('repaso', 'Repaso con tarjetas')}${enlace('bib', 'Bibliografía')}</ul>
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
    else if (ruta.vista === 'teoremas' && (ex.teoremas || []).length) vista.innerHTML = vistaTeoremas(ex);
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

    // En iPhone «resize» también se dispara al ocultarse la barra del navegador; sólo importa el ancho.
    let esperaGiro = null;
    let anchoPrevio = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === anchoPrevio) return;
      anchoPrevio = window.innerWidth;
      clearTimeout(esperaGiro);
      esperaGiro = setTimeout(() => recomponer($('#vista')), 300);
    });

    window.addEventListener('hashchange', pintar);
    pintar();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  abrir();
})();
