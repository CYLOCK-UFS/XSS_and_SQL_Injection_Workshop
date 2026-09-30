![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0.46-4479A1?logo=mysql&logoColor=white)
![Testes](https://img.shields.io/badge/testes-58%20unit%20%2B%2017%20E2E-6e5494)

# FinBank & ChefLab

Laboratório didático de **SQL Injection** e **XSS armazenado** para palestras e
workshops. Uma aplicação monolítica modular em **Node.js + Express 5 + MySQL
8.0** que mostra o **mesmo cenário em dois modos, lado a lado**: um **vulnerável**
e um **seguro**.

> [!WARNING]
> **Ambiente acadêmico isolado.** Todos os dados são sintéticos — não há cartão,
> CPF, telefone ou credencial real. **Não publique este serviço fora da rede de
> treinamento**: as portas estão presas ao loopback justamente por isso.

## Sumário

- [Início rápido](#início-rápido)
- [Ficha técnica](#ficha-técnica)
- [Modo vulnerável e modo seguro](#modo-vulnerável-e-modo-seguro)
- [Os quatro cenários](#os-quatro-cenários)
- [Notas de implementação](#notas-de-implementação)
- [Roteiro de apresentação](#roteiro-de-apresentação)
- [API de laboratório](#api-de-laboratório)
- [Testes](#testes)
- [Estrutura](#estrutura)
- [O que este laboratório ensina](#o-que-este-laboratório-ensina)

---

## Início rápido

```bash
docker compose up --build
```

| Serviço | Endereço | Credenciais |
| --- | --- | --- |
| Aplicação | <http://127.0.0.1:3000> | — |
| MySQL | `127.0.0.1:3306` | `lab_user` / `lab_password` |

Base `lab_palestra`. Para derrubar: `docker compose down`. Para apagar **também**
o volume do banco e recomeçar do zero: `docker compose down -v`.

<details>
<summary><strong>Desenvolvimento local (sem o container da aplicação)</strong></summary>

<br>

Os testes rodam **no host**, não dentro da imagem. Suba só o banco e execute o
Node na sua máquina:

```bash
cp .env.example .env          # ajuste os valores se quiser
docker compose up -d db       # apenas o MySQL
npm install
npm run dev                   # node --watch src/server.js
```

O `Dockerfile` instala com `--omit=dev`, então o `supertest` não existe no
container — é por isso que a suíte sobe o banco separadamente.

</details>

## Ficha técnica

| Item | Escolha |
| --- | --- |
| Runtime | Node.js 24 (ESM, `engines: >=20`) |
| Framework | Express 5 |
| Banco | MySQL 8.0.46 (`mysql2`; prepared statements no modo seguro) |
| Front-end | HTML + JavaScript puro, **CSS próprio, sem CDN** |
| Testes | `node:test` + `supertest` + Playwright, `tsc --checkJs` sem emitir nada |

O front-end é escrito à mão de propósito: o laboratório roda em rede isolada e
precisa funcionar **sem internet no projetor**.

---

## Modo vulnerável e modo seguro

O modo vive num **cookie `lab_mode`**, nunca na URL — a query string é reservada
aos parâmetros do cenário. A barra no topo de cada página alterna o modo.

| Item | Vulnerável (`vuln`) | Seguro (`safe`) |
| --- | --- | --- |
| SQL | interpolação de texto | prepared statement (`execute`) |
| Erros | expõe `sqlMessage` do MySQL | log interno + mensagem genérica |
| XSS | `innerHTML` | `textContent` |
| Reset | `POST /api/reset` | mesma rotina |

> [!NOTE]
> Sem cookie — ou com valor inválido — o laboratório assume `vuln`. Essa é a
> **regra única**, sem exceção em nenhum ponto do código.

```
navegador
   │  cookie lab_mode (HttpOnly, fora da URL)
   ▼
Express  ──  src/app.js
   ├── /banco/…      cenários 1–3  (SQLi)
   ├── /receitas/…   cenário 4     (XSS)
   └── /api/…        modo, reset, health
   │
   ▼   vuln: SQL interpolado   │   safe: execute()
MySQL 8.0  (127.0.0.1:3306)
```

## Os quatro cenários

| # | Página | Vulnerabilidade | Entrada |
| --- | --- | --- | --- |
| 1 | `/banco/agencias.html` | SQLi UNION | `GET cidade` |
| 2 | `/banco/extrato.html` | SQLi baseada em erro | `GET id_conta` |
| 3 | `/banco/noticia.html` | SQLi inferencial (cega) | `GET id` |
| 4 | `/receitas/receitas.html` | XSS armazenado | `POST comentario` |

Cada página mostra o resultado **e** a resposta JSON bruta — é no JSON que o
aluno enxerga as linhas extras do UNION e o `~abcde` vazar.

### Cenário 1 — UNION

A consulta pública devolve **4 colunas** (`nome_agencia`, `endereco`, `telefone`,
`gerente`). Essa contagem é a assinatura do ataque: o payload precisa fornecer
exatamente 4 colunas.

```
' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito -- 
```

- **vuln** → 6 linhas de `cartoes_credito` aparecem na tabela de agências.
- **safe** → o payload vira um nome de cidade e a consulta volta **0 linhas**.

### Cenário 2 — erro (o mais didático)

```
98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- 
```

- **vuln** → HTTP 500 com `XPATH syntax error: '~abcde'`. O `EXTRACTVALUE` recebe
  um XPath inválido e o MySQL devolve o erro **contendo o resultado da subquery**:
  a senha sintética do administrador. Confirmado no MySQL 8.0.46 fixado no Docker.
- **safe** → o payload é enviado como **valor** de um placeholder, nunca vira SQL.
  A resposta é 200 com zero lançamentos, e nenhum detalhe do banco aparece.

> [!TIP]
> O espaço final depois de `--` é obrigatório. É por isso que o DAS escreve
> `--%20`: sem ele o MySQL não reconhece o comentário. Na query string o payload
> precisa estar URL-encoded — na interface use o botão **Usar no campo**, que já
> faz a codificação.

### Cenário 3 — cega (oráculo booleano)

Registro-base: `id = 5`.

```
5' AND 1=1 --     ->  HTTP 200 (notícia encontrada)
5' AND 1=2 --     ->  HTTP 404 (registro desapareceu)
```

Esses dois status são o único canal de resposta, e é isso que permite responder
perguntas sobre o banco byte a byte. No modo **safe** a validação numérica
complementar rejeita as duas entradas e o oráculo deixa de responder.

A supressão de erro da rota vale **só no modo vulnerável**, porque é lá que ela
serve ao oráculo: sem suprimir, um payload de sintaxe inválida responderia
`500`, e o aluno leria esse `500` como "acertei a condição". No modo seguro não
há o que suprimir — a entrada não vira sintaxe —, então uma falha ali é
infraestrutura e sobe como `500`. Se o MySQL cair durante a apresentação, a
página diz isso em vez de responder `404`, que é exatamente o sinal que o ataque
lê como "condição falsa".

### Cenário 4 — XSS armazenado

Payload:

```html
<img src=x onerror=alert(document.domain)>
```

O `INSERT` em `src/repositories/receitasRepository.js` é **parametrizado nos dois
modos** — a marcação é gravada exatamente como digitada. A diferença está inteira
na **saída**, em `src/public/receitas/receitas.js`:

- **vuln** → `renderizarComInnerHTML()`, que monta o item com `innerHTML`.
  O `onerror` dispara a cada visita, sem nova interação — daí "armazenado".
- **safe** → `renderizarComTextContent()`, que monta nós de texto. A mesma
  marcação aparece como texto literal. Não existe `innerHTML` nesse caminho.

Ative o payload com o botão **Usar no campo** e recarregue a página.

---

## Notas de implementação

Detalhes que só apareceram testando o laboratório de verdade e que continuam
valendo a pena conhecer antes de apresentar.

### O segundo sink do XSS, e não só um

O roteiro do Cenário 4 usa o campo **Comentário**, mas
`renderizarComInnerHTML()` interpola **dois** campos no mesmo `innerHTML`:

| Campo do formulário | Coluna | Onde entra no `innerHTML` |
| --- | --- | --- |
| Comentário | `texto_comentario` | `p.comentario__texto` |
| **Nome do autor** | `nome_autor` | `strong` dentro de `p.comentario__autor` |

O nome do autor é um ponto de injeção tão real quanto o texto, e nenhum ponto do
roteiro o aponta. Grave o payload no campo **Nome do autor** e o `onerror`
dispara do mesmo jeito:

```html
<img src=x onerror=alert(1)>
```

A correção é a mesma nos dois campos — `textContent` em vez de `innerHTML` —, mas
o primeiro passo de uma auditoria de sink é contar quantos existem. O
`tests/e2e/cheflab.spec.js` fixa os dois comportamentos, no modo vulnerável e no
modo seguro, justamente para o segundo sink não voltar a ser silencioso.

### O `maxlength` não mitiga nada

`nome_autor` é `VARCHAR(80)` e o formulário espelha isso com `maxlength="80"`;
`texto_comentario` é `TEXT` (até 65535 bytes) e a aplicação recorta em 2000. O
limite de 80 muda a natureza do payload, não a sua existência: um
`<img src=x onerror=...>` cabe folgadamente, e `onerror` precisa de poucos
caracteres. Payload mais longo é cortado no meio da tag — e tag cortada
continua sendo HTML analisada.

Some-se a isso que `maxlength` é validação de **cliente**: quem chamar
`POST /receitas` com `curl` envia o que quiser. A defesa que importa é na saída.

### As datas não passam por fuso horário

`data_postagem` é o único `DATETIME` do laboratório, e ele chega ao navegador
como **texto** — `dateStrings: true` no pool, em `src/config/database.js`. Não é
detalhe de implementação: se o mysql2 entregasse um objeto `Date`, a hora
exibida passaria a depender de dois fusos que o laboratório não controla. No
fluxo oficial os dois diferem: o container roda em UTC e o projetor da plateia
roda em UTC−3, então `2024-01-10 18:30:00` apareceria como **15:30**. O mesmo
seed aparecia com a hora certa quando o apresentador subia `npm start` na
máquina em vez de usar o container — a hora mudava conforme *como* o laboratório
foi iniciado.

Com o texto cru, `formatarData()` ancora os componentes em UTC e os lê de volta
em UTC: sem conversão, a página mostra exatamente o que está gravado. O
`cheflab.spec.js` fixa isso nos dois modos, porque os dois renderizadores
formatam a data por caminhos diferentes.

### Por que o cookie de modo é `HttpOnly`

O laboratório tem um XSS armazenado funcional, então o cookie `lab_mode` não
pode ser legível por JavaScript. Se fosse, o payload da página do ChefLab leria
o modo e o reescreveria, e o atacante escolheria o `vuln` sozinho. Por isso o
modo vive num cookie `HttpOnly` lido no servidor, e não numa global, num header
ou na query string. Não há `secure: true` porque o laboratório roda em
`http://127.0.0.1`; com TLS, `secure: true` faz parte do mesmo raciocínio.

---

## Roteiro de apresentação

1. Deixe o modo em **Vulnerável** (acento vermelho na barra).
2. **Cenário 1**: consulta normal, depois o payload UNION. A tabela troca
   agências por dados de cartão.
3. **Cenário 2**: o payload de erro. A senha aparece dentro da mensagem do MySQL.
4. **Cenário 3**: compare `200` e `404`.
5. **Cenário 4**: grave o comentário com HTML e recarregue.
6. Alterne para **Seguro** e repita os quatro. O payload passa a ser tratado como
   texto.
7. **Restaurar laboratório** para deixar o estado inicial para a próxima turma.

## API de laboratório

| Rota | Efeito |
| --- | --- |
| `GET /api/mode` | devolve o modo vigente |
| `POST /api/mode` | `{ "mode": "vuln" \| "safe" }` → `Set-Cookie: lab_mode=…` |
| `POST /api/reset` | restaura o estado **inteiro** reexecutando `database/init.sql` |
| `GET /api/health` | aplicação + banco + contagem de tabelas |

`POST /receitas/reset` existe como alias de laboratório; o contrato oficial é
`/api/reset`. O reset restaura os dois comentários originais **e** todos os
registros-base das demais tabelas, não só os comentários.

## Testes

O plano de aceite **T01–T09 do DAS** está implementado em
`tests/acceptance.test.js` (`node:test` + `supertest`), junto do bloco **T10**,
que não vem do DAS: são invariantes do próprio laboratório (reset serializado,
corrida entre reset e leitura, parâmetros de query lidos como texto) sem as
quais uma demonstração ao vivo quebra sem ninguém ter feito nada de errado.

```bash
docker compose up -d db   # os testes rodam no host, não no container
npm test
```

`npm test` roda com `--test-concurrency=1`. Não é paranoia: os arquivos de teste
compartilham o mesmo MySQL e chamam `POST /api/reset`, então em paralelo um
arquivo apagaria os dados que o outro está usando.

### Três camadas de teste

| Comando | O que cobre | Precisa de MySQL |
| --- | --- | --- |
| `npm test` | 58 testes: aceite T01–T09 do DAS + T10, unidade dos repositories, encaminhamento de erro | sim |
| `npm run test:e2e` | 17 testes: XSS **executando** no navegador, oráculo SQLi, extração caractere a caractere | sim |
| `npm run typecheck` | `tsc --checkJs` sobre os `.js`, sem emitir nada | não |

Para rodar as três de uma vez, na ordem certa e subindo o banco se ele ainda não
estiver de pé, use `npm run test:full`:

```bash
npm run test:full                 # typecheck -> banco -> npm test -> test:e2e
npm run test:full -- --down       # e derruba o compose no fim
npm run test:full -- --sem-e2e    # só typecheck + npm test
```

O script (`scripts/rodar-testes.mjs`) confere a porta do banco por socket, sobe
`docker compose up -d db` quando preciso e resume OK/FALHA por etapa no fim,
deixando o banco de pé para a próxima execução. Ele não substitui as camadas —
só evita ter que lembrar da ordem `docker compose up -d db` → `npm test` →
`npm run test:e2e`.

O E2E é a única camada que prova que o payload **chega a rodar**: a suíte de
aceite confere que o `innerHTML` continua no fonte, o que é condição necessária
e não suficiente — um `Content-Security-Policy` novo, ou um `innerHTML` que
deixasse de interpolar o comentário, passariam por ela e quebrariam a
demonstração ao vivo.

Duas decisões do `playwright.config.js` que só apareceram por causa de
problemas reais:

- **Porta 3100, não 3000.** O container de demonstração ocupa a 3000. Com
  `reuseExistingServer`, o Playwright encontraria o container, acharia que o
  servidor já estava de pé, e testaria a cópia do código assada na imagem em vez
  da árvore de trabalho — os testes ficariam verdes mesmo depois de uma mudança
  que quebrasse o laboratório.
- **Navegador do sistema como reserva.** O `npx playwright install` baixa o
  Chromium; em rede de treinamento isolada esse download falha. O config detecta
  a ausência do Chromium empacotado e cai para `msedge`/`chrome`.

```bash
npm run test:e2e                     # 17 testes
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e   # fixa o navegador do sistema
```

`npm run typecheck` não converte o projeto para TypeScript: não entra um único
`.ts` no repositório, e o que roda no container continua sendo o mesmo
JavaScript. Ele pega referência não definida, código morto e `await` esquecido —
este último só depois de os repositories declararem `@returns`, porque sem isso o
retorno do `mysql2` degrada para `any`.

## Estrutura

```
docker-compose.yml
Dockerfile                     build em dois estágios; npm ci --omit=dev
database/init.sql              contrato de schema e seeds (DAS §5)
database/00-grants.sql         privilégios para o /api/reset rodar como lab_user
scripts/rodar-testes.mjs       orquestrador do `npm run test:full`
src/server.js                  bootstrap, espera o MySQL, shutdown gracioso
src/app.js                     composição do Express
src/config/database.js         pool; multipleStatements só na conexão de reset
src/middleware/mode.js         contrato do cookie lab_mode
src/middleware/errorHandler.js erro didático (vuln) x genérico (safe)
src/routes/                    bancoRoutes, receitasRoutes, labRoutes
src/repositories/              SQL: interpolado (vuln) x parametrizado (safe)
src/public/banco/              cenários 1 a 3
src/public/receitas/           cenário 4 (sink XSS)
src/public/css/lab.css         CSS próprio, sem CDN — o lab roda offline
src/public/js/lab.js           modo, reset, roteiros clicáveis
src/types/                     .d.ts de apoio ao `tsc --checkJs` (não emitem nada)
tests/acceptance.test.js       T01–T10, `node:test` + supertest
tests/unit/                    repositories com executor falso; erro assíncrono
tests/e2e/                     Playwright: XSS executando e oráculo SQLi
tsconfig.json                  checkJs, noEmit
playwright.config.js           porta 3100; browser do sistema como reserva
DAS_v2_2_Revisado_FinBank_ChefLab.txt   documento de análise e especificação
```

## O que este laboratório ensina

| Vulnerabilidade | Mitigação aplicada no modo seguro |
| --- | --- |
| SQLi UNION | prepared statement — separa código de valor |
| SQLi por erro | prepared statement + log interno e mensagem genérica |
| SQLi cega | parametrização **e** validação de formato |
| XSS armazenado | `textContent` em vez de `innerHTML` |
| XSS no campo de autor | mesmo `textContent` — é o **segundo** sink da página |
| Roubo do modo pelo XSS | cookie `lab_mode` `HttpOnly`, lido só no servidor |
