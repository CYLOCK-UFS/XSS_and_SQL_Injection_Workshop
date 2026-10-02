import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buscarCliente,
  buscarExtrato,
  buscarNoticia,
  listarAgencias,
  listarComunicados,
} from '../../src/repositories/bancoRepository.js';
import { LAB_MODE_SAFE, LAB_MODE_VULN } from '../../src/middleware/mode.js';

/**
 * Testes de unidade dos repositories, sem MySQL.
 *
 * A suite de aceitacao sobe a aplicacao de verdade e so descobre a
 * diferenca entre os dois modos pela RESPOSTA HTTP: um 200 no vuln e um 400 no
 * safe. Isso prova o efeito, mas nao a causa. Se alguem reescrevesse o caminho
 * seguro trocando `execute()` por `query()` e ainda assim parametrirasse
 * certo -- ou, ao contrario, adicionasse uma interpolacao que a suite nao
 * exercita -- nada acusaria.
 *
 * Aqui o executor e um duble que registra o que recebeu. O teste passa a
 * verificar a instrucao exata: modo vuln tem que concatenar, modo safe tem que
 * enviar placeholder. E o tipo de verificacao que sobrevive a refatoracao sem
 * depender de banco, de rede e de tempo de consulta.
 */

/** Chamadas registradas pelo duble. */
function executorFalso(resposta = []) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql) {
      chamadas.push({ metodo: 'query', sql, params: undefined });
      return [resposta];
    },
    async execute(sql, params) {
      chamadas.push({ metodo: 'execute', sql, params });
      return [resposta];
    },
  };
}

describe('modo vulneravel: concatena a entrada na instrucao', () => {
  it('buscarNoticia interpola o id direto no texto da query', async () => {
    const executor = executorFalso([{ titulo: 'X', conteudo: 'Y' }]);

    await buscarNoticia(`1' OR 1=1 -- `, {
      labMode: LAB_MODE_VULN,
      executor,
    });

    assert.equal(executor.chamadas.length, 1);
    const [chamada] = executor.chamadas;
    // `query()` e nao `execute()`: e o protocolo de texto, sem placeholder.
    assert.equal(chamada.metodo, 'query');
    assert.match(chamada.sql, /WHERE id = '1' OR 1=1 -- '/);
    assert.equal(chamada.params, undefined);
  });

  it('buscarExtrato interpola a conta e expoe o erro do MySQL', async () => {
    const executor = executorFalso([]);
    const erro = Object.assign(new Error('You have an error in your SQL syntax'), {
      code: 'ER_PARSE_ERROR',
      sqlMessage: "near ''' at line 1",
    });
    executor.query = async () => {
      throw erro;
    };

    await assert.rejects(
      () => buscarExtrato(`98765' AND EXTRACTVALUE(1, CONCAT(0x7e, 1)) -- `, {
        labMode: LAB_MODE_VULN,
        executor,
      }),
      (recebido) => {
        // A rejeicao e propagada crua, e isso e o que permite ao errorHandler
        // montar o corpo de detalhes no modo vuln. Se o repository engolisse o
        // erro, o cenario 2 do DAS deixaria de ter o que mostrar.
        assert.equal(recebido.sqlMessage, "near ''' at line 1");
        return true;
      },
    );
  });

  it('listarAgencias interpola a cidade e ordena', async () => {
    const executor = executorFalso([]);

    await listarAgencias(`Sao Paulo' UNION SELECT 1,2,3,4 -- `, {
      labMode: LAB_MODE_VULN,
      executor,
    });

    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'query');
    assert.match(chamada.sql, /WHERE cidade = 'Sao Paulo' UNION SELECT 1,2,3,4 -- '/);
  });
});

describe('modo seguro: a entrada viaja fora do texto da query', () => {
  /**
   * Aqui o id precisa ser numerico, e nao um payload.
   *
   * No modo seguro `buscarNoticia` tem DUAS defesas, e a segunda (o filtro de
   * formato) intercepta o payload antes de ele chegar a qualquer consulta --
   * ver o teste "id nao numerico nao chega a ser consultado". Entao o que este
   * caso prova e a primeira: quando a entrada passa, ela viaja como parametro,
   * fora do texto da query. A demonstracao de que o payload viaja como valor
   * em vez de sintaxe fica nos cenarios sem validacao de formato, `buscarExtrato`
   * e `listarAgencias`.
   */
  it('buscarNoticia envia placeholder e o id como parametro', async () => {
    const executor = executorFalso([{ titulo: 'X', conteudo: 'Y' }]);

    await buscarNoticia('7', {
      labMode: LAB_MODE_SAFE,
      executor,
    });

    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'execute');
    assert.match(chamada.sql, /WHERE id = \?/);
    assert.deepEqual(chamada.params, ['7']);
  });

  it('buscarExtrato envia a conta como parametro', async () => {
    const executor = executorFalso([]);

    await buscarExtrato(`98765' OR 1=1 -- `, {
      labMode: LAB_MODE_SAFE,
      executor,
    });

    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'execute');
    // O ponto central do modo seguro: o payload nao aparece no texto da query.
    // Ele viaja como valor, e o MySQL nunca o interpreta como sintaxe -- e por
    // isso que a entrada nao consegue alterar a estrutura da consulta.
    assert.equal(chamada.sql.includes('OR 1=1'), false);
    assert.match(chamada.sql, /WHERE id_conta = \?/);
    assert.deepEqual(chamada.params, [`98765' OR 1=1 -- `]);
  });

  it('listarAgencias envia a cidade como parametro', async () => {
    const executor = executorFalso([]);

    await listarAgencias(`Sao Paulo' UNION SELECT 1,2,3,4 -- `, {
      labMode: LAB_MODE_SAFE,
      executor,
    });

    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'execute');
    assert.equal(chamada.sql.includes('UNION'), false);
    assert.match(chamada.sql, /WHERE cidade = \?/);
    assert.deepEqual(chamada.params, [`Sao Paulo' UNION SELECT 1,2,3,4 -- `]);
  });
});

describe('modo seguro: validacao complementar antes de tocar no banco', () => {
  /**
   * A validacao de `buscarNoticia` e a segunda camada do cenario 3, e ela
   * acontece ANTES da consulta. O teste importa porque um id nao numerico nem
   * chega a ser enviado: o executor nao registra nenhuma chamada, o que prova
   * que o filtro esta no caminho certo e nao depois dele.
   */
  it('id nao numerico nao chega a ser consultado', async () => {
    const executor = executorFalso([]);

    const resultado = await buscarNoticia(`1' OR 1=1 -- `, {
      labMode: LAB_MODE_SAFE,
      executor,
    });

    assert.equal(resultado, null);
    assert.equal(executor.chamadas.length, 0);
  });

  it('id numerico valido e aceito', async () => {
    const executor = executorFalso([{ titulo: 'X' }]);

    const resultado = await buscarNoticia('7', {
      labMode: LAB_MODE_SAFE,
      executor,
    });

    assert.deepEqual(resultado, { titulo: 'X' });
    assert.equal(executor.chamadas.length, 1);
  });

  it('no modo vuln o mesmo id nao numerico passa direto para a query', async () => {
    const executor = executorFalso([]);

    await buscarNoticia(`abc`, { labMode: LAB_MODE_VULN, executor });

    // A diferenca entre os dois modos fica explicita aqui: o filtro de formato
    // e uma propriedade do modo seguro, nao do endpoint.
    assert.equal(executor.chamadas.length, 1);
    assert.equal(executor.chamadas[0].metodo, 'query');
  });
});

describe('consulta sem filtro: ignora o parametro de qualquer modo', () => {
  it('cidade ausente traz a lista inteira via execute nos dois modos', async () => {
    for (const labMode of [LAB_MODE_VULN, LAB_MODE_SAFE]) {
      const executor = executorFalso([{ nome_agencia: 'X' }]);

      await listarAgencias('', { labMode, executor });

      const [chamada] = executor.chamadas;
      // Sem `WHERE` nao ha parametro a interpolar, entao os dois modos usam
      // o caminho seguro. Isso e proposital: nao existe entrada do usuario
      // para virar sintaxe.
      assert.equal(chamada.metodo, 'execute');
      assert.equal(chamada.sql.includes('WHERE'), false);
    }
  });
});

describe('leituras de apoio do autoatendimento: so existe caminho seguro', () => {
  /**
   * As duas leituras novas nao recebem `labMode`, e nao por esquecimento: nao ha
   * cenario de injecao em nenhuma das duas. A prova e o executor falso -- se
   * alguem reintroduzisse uma interpolacao, ela apareceria em `query()` ou em
   * uma string SQL com o valor colado dentro.
   */
  it('buscarCliente envia o id como parametro, nunca no texto', async () => {
    const executor = executorFalso([{ id_cliente: 'CLI001' }]);

    await buscarCliente("CLI001' OR '1'='1", { executor });

    assert.equal(executor.chamadas.length, 1);
    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'execute');
    assert.deepEqual(chamada.params, ["CLI001' OR '1'='1"]);
    assert.equal(chamada.sql.includes('CLI001'), false);
  });

  it('buscarCliente devolve a primeira linha, ou null', async () => {
    const comCliente = executorFalso([{ id_cliente: 'CLI001' }]);
    assert.equal((await buscarCliente('CLI001', { executor: comCliente })).id_cliente, 'CLI001');

    const semCliente = executorFalso([]);
    assert.equal(await buscarCliente('CLI999', { executor: semCliente }), null);
  });

  it('listarComunicados consulta sem filtro e sem parametro', async () => {
    const executor = executorFalso([{ id: '8', titulo: 'X' }]);

    await listarComunicados({ executor });

    const [chamada] = executor.chamadas;
    assert.equal(chamada.metodo, 'execute');
    assert.equal(chamada.sql.includes('WHERE'), false);
    assert.equal(chamada.params, undefined);
  });

  /**
   * O mural nao pode devolver `conteudo`. Nao e_fifo de estilo: o cenario 3 usa
   * a rota /banco/noticia para comparar o corpo, e um mural com o texto inteiro
   * daria o mesmo dado por um caminho que nao esta no roteiro.
   */
  it('listarComunicados pede so id, titulo e data', async () => {
    const executor = executorFalso([]);

    await listarComunicados({ executor });

    const { sql } = executor.chamadas[0];
    assert.match(sql, /SELECT id, titulo, data_publicacao FROM noticias/);
    assert.equal(sql.includes('conteudo'), false);
  });
});
