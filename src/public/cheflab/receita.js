/* =============================================================================
   ChefLab - XSS armazenado (DAS v2.2, secao 4.4)
   =============================================================================
   Divida deliberada em dois renderizadores no MESMO arquivo, porque o que muda
   entre os modos nao e a gravacao e a saida:

     modo vulneravel -> renderizarComInnerHTML   (executa a marcacao)
     modo seguro     -> renderizarComTextContent (exibe o mesmo texto como texto)

   O INSERT em src/repositories/receitasRepository.js e parametrizado nos dois
   modos: a entrada do usuario nunca altera a estrutura da query. Se o
   comentario fosse armazenado com a marcacao intacta e re-renderizado por
   innerHTML, o payload dispara a cada visita, sem nova interacao - e por isso
   que o cenario se chama XSS ARMAZENADO.

   Nao ha nesta pagina nenhum aviso dizendo em que modo ela esta. A pagina e a
   mesma nos dois modos de proposito: quem conduz troca o modo na barra e ve a
   lista mudar de comportamento sem que o site tenha|Se revelado. O roteiro que
   explica a diferenca mora em /palco.

   Os nomes das classes e dos ids exportados para o CSS e para os testes estao
   comments no inicio de cada bloco. .comentario, .comentario__autor e
   .comentario__texto sao contrato: sao o que o sink interpola e o que
   tests/e2e/cheflab.spec.js localiza.
   ============================================================================= */

import { iniciarChrome } from '../js/chrome.js';
import {
  formatarData,
  mostrarJson,
  paraDataTime,
  preencherTexto,
} from '../js/lab.js';

const modo = await iniciarChrome();

const formulario = document.querySelector('#formulario');

/**
 * As anotacoes abaixo existem so para o `tsc --checkJs`.
 *
 * `querySelector` devolve `Element`, que nao tem `value` nem `disabled` -- o
 * tipo real do autor e um `HTMLInputElement`, o do texto e um
 * `HTMLTextAreaElement`, e o do botao e um `HTMLButtonElement`. Como o
 * JavaScript nao tem anotacao de tipo, o `querySelector` erra para o tipo mais
 * generico e o typecheck acusaria propriedade inexistente.
 *
 * A alternativa seria trocar `querySelector` por `getElementById`, que ja
 * devolve o tipo certo -- mas o seletor por id e mais legivel para quem esta
 * lendo o laboratorio, e trocar o estilo do codigo para agradar ao typecheck
 * seria o tipo de cambio que atrapalha mais do que ajuda.
 *
 * Nenhuma dessas anotacoes altera o runtime.
 */
const campoAutor = /** @type {HTMLInputElement} */ (
  document.querySelector('#campo-autor')
);
const campoTexto = /** @type {HTMLTextAreaElement} */ (
  document.querySelector('#campo-texto')
);

/* Contrato com cheflab.css e com o E2E: nao renomear. */
const lista = document.querySelector('#lista-comentarios');
const vazio = document.querySelector('#lista-vazia');
const resumo = document.querySelector('#resumo');
const json = document.querySelector('#json-resposta');

formulario.addEventListener('submit', publicar);

await carregar();

/* -------------------------------------------------------------------------- */
/* Gravacao: identica nos dois modos                                          */
/* -------------------------------------------------------------------------- */

/**
 * Publica o comentario e recarrega a lista.
 *
 * Identico nos dois modos, porque o risco nao esta em gravar: o INSERT e
 * parametrizado e a marcacao volta intacta do banco. O que acontece com ela
 * depois esta no bloco de saida, la embaixo.
 */
async function publicar(evento) {
  evento.preventDefault();

  const botao = /** @type {HTMLButtonElement} */ (
    formulario.querySelector('button[type="submit"]')
  );
  botao.disabled = true;

  const aviso = document.querySelector('#aviso-envio');
  preencherTexto(aviso, 'publicando...');

  try {
    const resposta = await fetch('/receitas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_autor: campoAutor.value,
        texto_comentario: campoTexto.value,
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      window.alert(dados.erro ?? 'Falha ao gravar o comentario.');
      return;
    }

    campoAutor.value = '';
    campoTexto.value = '';
    await carregar();
  } finally {
    botao.disabled = false;
    preencherTexto(aviso, '');
  }
}

async function carregar() {
  const resposta = await fetch('/receitas', {
    headers: { Accept: 'application/json' },
  });
  const dados = await resposta.json();

  mostrarJson(json, dados);
  desenhar(dados.comentarios ?? []);
  preencherTexto(resumo, `${dados.total} comentario(s).`);
}

/* -------------------------------------------------------------------------- */
/* Saida: o unico ponto que muda entre os modos                               */
/* -------------------------------------------------------------------------- */

function desenhar(comentarios) {
  const fragmento = document.createDocumentFragment();

  for (const comentario of comentarios) {
    fragmento.append(
      modo === 'vuln'
        ? renderizarComInnerHTML(comentario)
        : renderizarComTextContent(comentario),
    );
  }

  lista.replaceChildren(fragmento);
  vazio.classList.toggle('oculto', comentarios.length > 0);
}

/* -------------------------------------------------------------------------- */
/* PONTO VULNERAVEL                                                           */
/* -------------------------------------------------------------------------- */
/**
 * SINK DE XSS - ESTE E O TRECHO QUE O LAB ENSINA.
 *
 * A interpolacao das variaveis dentro de innerHTML faz o HTML ser analisado
 * pelo navegador. Se texto_comentario for
 *   <img src=x onerror=alert(document.domain)>
 * o atributo onerror vira um manipulador de evento executado pela pagina, e o
 * codigo roda com a origem do laboratorio. O mesmo vale para <script>, para
 * <iframe> e para qualquer elemento com atributo de evento.
 *
 * Trocar innerHTML por textContent (renderizarComTextContent, abaixo) e a
 * correcao: textContent nao interpreta markup, ele apenas insere texto.
 */
function renderizarComInnerHTML(comentario) {
  const item = document.createElement('li');
  item.className = 'comentario';

  // PONTO VULNERAVEL: innerHTML interpreta a marcacao vinda do banco.
  item.innerHTML = `
    <p class="comentario__autor">
      <strong>${comentario.nome_autor}</strong>
      <time datetime="${paraDataTime(comentario.data_postagem)}">${formatarData(
        comentario.data_postagem,
      )}</time>
    </p>
    <p class="comentario__texto">${comentario.texto_comentario}</p>
  `;

  return item;
}

/* -------------------------------------------------------------------------- */
/* MITIGACAO                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Saida segura: a mesma informacao, montada por nos de texto.
 *
 * Cada valor vai para textContent, que cria um no de texto e nunca interpreta
 * markup. Nao existe innerHTML neste caminho, entao nao existe ponto de
 * injecao, por mais que o comentario tente.
 */
function renderizarComTextContent(comentario) {
  const item = document.createElement('li');
  item.className = 'comentario';

  const cabecalho = document.createElement('p');
  cabecalho.className = 'comentario__autor';

  const autor = document.createElement('strong');
  autor.textContent = comentario.nome_autor;

  const tempo = document.createElement('time');
  tempo.dateTime = paraDataTime(comentario.data_postagem);
  tempo.textContent = formatarData(comentario.data_postagem);

  cabecalho.append(autor, ' ', tempo);

  const texto = document.createElement('p');
  texto.className = 'comentario__texto';
  texto.textContent = comentario.texto_comentario;

  item.append(cabecalho, texto);

  return item;
}
