// js/dados.js — camada de acesso a dados: substitui as rotas Express da
// versão servidor (routes/*.js) por funções chamadas direto no navegador,
// sobre o banco SQLite local (ver db.js). Mesmas regras de negócio, mesmo
// formato de retorno (em reais) que a tela já espera.
//
// Tudo aqui dentro fica namespaced em `Dados` (IIFE) de propósito: o
// index.html tem funções de UI com nomes iguais aos da camada de dados
// (ex.: excluirCompra, desfazerPagamento, excluirItemOrcamento — a de UI
// confirma com o usuário e chama api(), a de dados só mexe no banco). Como
// scripts clássicos compartilham o mesmo escopo global, declarar essas
// funções soltas aqui SOBRESCREVIA a versão de UI pela de dados (carregada
// antes) — e como app.js chama essas funções pelo nome global esperando a
// versão de dados, acabava chamando a de UI de novo, que chama api(), que
// chama despachar(), que chama a função de novo... recursão infinita
// ("Maximum call stack size exceeded") até estourar a pilha. Foi assim que
// "excluir compra" (e desfazer pagamento, e excluir item de orçamento)
// paravam de completar. O namespace evita essa classe inteira de bug.
const Dados = (function () {

// ---------------------------------------------------------------------
// Referências: cartões (categorias de despesa) e categorias de gasto
// ---------------------------------------------------------------------
function listarCartoes() {
  return todasLinhas('SELECT id, nome, dia_vencimento, ativo FROM formas_pagamento ORDER BY nome');
}

async function criarCartao({ nome, dia_vencimento }) {
  nome = (nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório');
  if (dia_vencimento !== null && dia_vencimento !== undefined && dia_vencimento !== '' && (dia_vencimento < 1 || dia_vencimento > 31)) {
    throw new Error('dia_vencimento deve ser entre 1 e 31 (ou vazio)');
  }
  const diaFinal = (dia_vencimento === undefined || dia_vencimento === null || dia_vencimento === '') ? null : Number(dia_vencimento);
  try {
    executar('INSERT INTO formas_pagamento (nome, dia_vencimento) VALUES (?, ?)', [nome, diaFinal]);
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new Error('Já existe uma forma de pagamento com esse nome.');
    throw e;
  }
  const id = ultimoIdInserido();
  await salvarBanco();
  return { id, mensagem: 'Forma de pagamento criada' };
}

async function atualizarCartao(id, { nome, dia_vencimento }) {
  id = Number(id);
  const nomeInformado = nome !== undefined;
  const nomeFinal = nomeInformado ? String(nome).trim() : undefined;
  if (dia_vencimento !== null && dia_vencimento !== undefined && dia_vencimento !== '' && (dia_vencimento < 1 || dia_vencimento > 31)) {
    throw new Error('dia_vencimento deve ser entre 1 e 31 (ou vazio)');
  }
  if (nomeInformado && !nomeFinal) throw new Error('Nome não pode ficar vazio');
  const diaFinal = (dia_vencimento === undefined || dia_vencimento === null || dia_vencimento === '') ? null : Number(dia_vencimento);

  const existe = primeiraLinha('SELECT COUNT(*) AS n FROM formas_pagamento WHERE id = ?', [id]);
  if (!existe || existe.n === 0) throw new Error('Forma de pagamento não encontrada');

  let parcelasRecalculadas = 0;
  try {
    transacao(() => {
      if (nomeInformado) executar('UPDATE formas_pagamento SET nome = ?, dia_vencimento = ? WHERE id = ?', [nomeFinal, diaFinal, id]);
      else executar('UPDATE formas_pagamento SET dia_vencimento = ? WHERE id = ?', [diaFinal, id]);

      // Recalcula, em JS (ver datas.js — SQLite não faz o ajuste de mês
      // curto sozinho), o vencimento de cada parcela PENDENTE dessa forma de pagamento.
      const pendentes = todasLinhas(`
        SELECT p.id, p.num_parcela, c.data_compra
        FROM parcelas p JOIN compras c ON c.id = p.compra_id
        WHERE c.cartao_id = ? AND p.status = 'Pendente'`, [id]);

      for (const p of pendentes) {
        const primeiroVencimento = calcularPrimeiroVencimento(p.data_compra, diaFinal);
        const novoVencimento = addMonths(primeiroVencimento, p.num_parcela - 1);
        executar('UPDATE parcelas SET data_vencimento = ? WHERE id = ?', [novoVencimento, p.id]);
      }
      parcelasRecalculadas = pendentes.length;
    });
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new Error('Já existe uma forma de pagamento com esse nome.');
    throw e;
  }

  await salvarBanco();
  return { mensagem: 'Forma de pagamento atualizada', parcelas_recalculadas: parcelasRecalculadas };
}

async function excluirCartao(id) {
  try {
    const r = executar('DELETE FROM formas_pagamento WHERE id = ?', [Number(id)]);
    if (r.changes === 0) throw new Error('Forma de pagamento não encontrada');
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message || '')) {
      throw new Error('Não é possível excluir: existem despesas cadastradas nesta forma de pagamento. Renomeie-a se precisar corrigir o nome, em vez de excluir.');
    }
    throw e;
  }
  await salvarBanco();
  return { mensagem: 'Forma de pagamento removida' };
}

// ---------------------------------------------------------------------
// Grupo de Despesa (ex.: Alimentação, Transporte, Moradia, Saúde)
// ---------------------------------------------------------------------
function listarGruposDespesa() {
  return todasLinhas('SELECT id, nome FROM grupos_despesa ORDER BY nome');
}

async function criarGrupoDespesa({ nome }) {
  nome = (nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório');
  try {
    executar('INSERT INTO grupos_despesa (nome) VALUES (?)', [nome]);
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new Error('Já existe um grupo de despesa com esse nome.');
    throw e;
  }
  const id = ultimoIdInserido();
  await salvarBanco();
  return { id, mensagem: 'Grupo de despesa criado' };
}

async function atualizarGrupoDespesa(id, { nome }) {
  nome = (nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório');
  try {
    const r = executar('UPDATE grupos_despesa SET nome = ? WHERE id = ?', [nome, Number(id)]);
    if (r.changes === 0) throw new Error('Grupo de despesa não encontrado');
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new Error('Já existe um grupo de despesa com esse nome.');
    throw e;
  }
  await salvarBanco();
  return { mensagem: 'Grupo de despesa atualizado' };
}

async function excluirGrupoDespesa(id) {
  try {
    const r = executar('DELETE FROM grupos_despesa WHERE id = ?', [Number(id)]);
    if (r.changes === 0) throw new Error('Grupo de despesa não encontrado');
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message || '')) {
      throw new Error('Não é possível excluir: existem despesas lançadas com esse grupo. Altere o grupo dessas despesas antes de excluir.');
    }
    throw e;
  }
  await salvarBanco();
  return { mensagem: 'Grupo de despesa removido' };
}

// ---------------------------------------------------------------------
// Tipo de Despesa (ex.: Supermercado, Combustível, Medicamentos) — sempre
// dentro de um Grupo de Despesa.
// ---------------------------------------------------------------------
function listarCategorias() {
  // LEFT JOIN: Tipo de Despesa não exige mais um Grupo fixo (grupo_id pode
  // ser NULO) — com INNER JOIN, todo tipo sem grupo desapareceria da lista.
  return todasLinhas(`
    SELECT t.id, t.nome, t.grupo_id, g.nome AS grupo
    FROM tipos_despesa t LEFT JOIN grupos_despesa g ON g.id = t.grupo_id
    ORDER BY t.nome`);
}

// Tipo de Despesa não pertence mais a um Grupo fixo — o grupo de cada
// despesa é escolhido à parte, no momento do lançamento (ver criarCompra).
async function criarTipoDespesa({ nome }) {
  nome = (nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório');
  try {
    executar('INSERT INTO tipos_despesa (nome) VALUES (?)', [nome]);
  } catch (e) {
    if (/NOT NULL/i.test(e.message || '')) {
      // Banco de antes do grupo virar opcional: a coluna ainda exige um
      // valor. Preenche com "Outros" nos bastidores, sem pedir isso na tela.
      executar("INSERT OR IGNORE INTO grupos_despesa (nome) VALUES ('Outros')");
      const outros = primeiraLinha("SELECT id FROM grupos_despesa WHERE nome = 'Outros'").id;
      try {
        executar('INSERT INTO tipos_despesa (grupo_id, nome) VALUES (?, ?)', [outros, nome]);
      } catch (e2) {
        if (/UNIQUE/i.test(e2.message || '')) throw new Error('Já existe um tipo de despesa com esse nome.');
        throw e2;
      }
    } else if (/UNIQUE/i.test(e.message || '')) {
      throw new Error('Já existe um tipo de despesa com esse nome.');
    } else {
      throw e;
    }
  }
  const id = ultimoIdInserido();
  await salvarBanco();
  return { id, mensagem: 'Tipo de despesa criado' };
}

async function atualizarTipoDespesa(id, { nome }) {
  nome = (nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório');
  try {
    const r = executar('UPDATE tipos_despesa SET nome = ? WHERE id = ?', [nome, Number(id)]);
    if (r.changes === 0) throw new Error('Tipo de despesa não encontrado');
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new Error('Já existe um tipo de despesa com esse nome.');
    throw e;
  }
  await salvarBanco();
  return { mensagem: 'Tipo de despesa atualizado' };
}

async function excluirTipoDespesa(id) {
  try {
    const r = executar('DELETE FROM tipos_despesa WHERE id = ?', [Number(id)]);
    if (r.changes === 0) throw new Error('Tipo de despesa não encontrado');
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message || '')) {
      throw new Error('Não é possível excluir: existem despesas cadastradas nesse tipo. Renomeie-o se precisar corrigir, em vez de excluir.');
    }
    throw e;
  }
  await salvarBanco();
  return { mensagem: 'Tipo de despesa removido' };
}

// ---------------------------------------------------------------------
// Compras e parcelas
// ---------------------------------------------------------------------
function listarComprasResumo() {
  return todasLinhas('SELECT * FROM vw_resumo_por_compra ORDER BY situacao, descricao').map(mapResumoCompra);
}

function obterCompra(id) {
  id = Number(id);
  const compra = primeiraLinha(`
    SELECT c.*, ca.nome AS cartao, ca.dia_vencimento AS cartao_dia_vencimento, cat.nome AS categoria, gr.nome AS grupo
    FROM compras c
    LEFT JOIN formas_pagamento ca ON ca.id = c.cartao_id
    LEFT JOIN tipos_despesa cat ON cat.id = c.categoria_id
    LEFT JOIN grupos_despesa gr ON gr.id = c.grupo_despesa_id
    WHERE c.id = ?`, [id]);
  if (!compra) throw new Error('Compra não encontrada');

  const parcelas = todasLinhas('SELECT * FROM parcelas WHERE compra_id = ? ORDER BY num_parcela', [id]);

  return {
    id: compra.id,
    descricao: compra.descricao,
    cartao_id: compra.cartao_id,
    categoria_id: compra.categoria_id,
    grupo_despesa_id: compra.grupo_despesa_id,
    valor_total: paraReais(compra.valor_total_centavos),
    qtd_parcelas: compra.qtd_parcelas,
    data_compra: compra.data_compra,
    observacoes: compra.observacoes,
    cartao: compra.cartao,
    cartao_dia_vencimento: compra.cartao_dia_vencimento,
    categoria: compra.categoria,
    grupo: compra.grupo,
    parcelas: parcelas.map(mapParcela),
  };
}

// Gera as N parcelas de uma compra (mesma regra de divisão de centavos e de
// vencimento usada na criação e na recriação por edição).
function gerarParcelas(compraId, valorTotalCentavos, qtdParcelas, primeiroVencimento) {
  const base = Math.floor(valorTotalCentavos / qtdParcelas);
  for (let i = 1; i <= qtdParcelas; i++) {
    const valorParcela = (i === qtdParcelas) ? valorTotalCentavos - base * (qtdParcelas - 1) : base;
    executar(`INSERT INTO parcelas (compra_id, num_parcela, valor_centavos, data_vencimento, status)
        VALUES (?, ?, ?, ?, 'Pendente')`, [compraId, i, valorParcela, addMonths(primeiroVencimento, i - 1)]);
  }
}

async function criarCompra({ descricao, cartao_id, categoria_id, grupo_despesa_id, valor_total, qtd_parcelas, data_primeira_parcela, observacoes }) {
  if (!descricao || !cartao_id || !valor_total || !qtd_parcelas || !data_primeira_parcela) {
    throw new Error('Campos obrigatórios: descricao, cartao_id, valor_total, qtd_parcelas, data_primeira_parcela');
  }

  const resultado = transacao(() => {
    const cartao = primeiraLinha('SELECT dia_vencimento FROM formas_pagamento WHERE id = ?', [cartao_id]);
    const diaVencimentoCartao = cartao ? cartao.dia_vencimento : null;
    const primeiroVencimento = calcularPrimeiroVencimento(data_primeira_parcela, diaVencimentoCartao);
    const valorTotalCentavos = paraCentavos(valor_total);

    executar(`INSERT INTO compras (descricao, cartao_id, categoria_id, grupo_despesa_id, valor_total_centavos, qtd_parcelas, data_compra, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [descricao, cartao_id, categoria_id || null, grupo_despesa_id || null, valorTotalCentavos, qtd_parcelas, data_primeira_parcela, observacoes || null]);
    const compraId = ultimoIdInserido();

    gerarParcelas(compraId, valorTotalCentavos, qtd_parcelas, primeiroVencimento);
    return { compraId, primeiroVencimento };
  });

  await salvarBanco();
  return {
    id: resultado.compraId,
    mensagem: `Compra criada com ${qtd_parcelas} parcela(s) gerada(s). 1ª parcela vence em ${resultado.primeiroVencimento}.`,
  };
}

async function atualizarCompra(id, { descricao, cartao_id, categoria_id, grupo_despesa_id, valor_total, qtd_parcelas, data_primeira_parcela, observacoes }) {
  id = Number(id);
  if (!descricao || !cartao_id || !valor_total || !qtd_parcelas || !data_primeira_parcela) {
    throw new Error('Campos obrigatórios: descricao, cartao_id, valor_total, qtd_parcelas, data_primeira_parcela');
  }

  const atual = primeiraLinha('SELECT valor_total_centavos, qtd_parcelas, cartao_id, data_compra FROM compras WHERE id = ?', [id]);
  if (!atual) throw new Error('Compra não encontrada');

  const valorTotalCentavos = paraCentavos(valor_total);
  const precisaRecriar =
    atual.valor_total_centavos !== valorTotalCentavos ||
    Number(atual.qtd_parcelas) !== Number(qtd_parcelas) ||
    Number(atual.cartao_id) !== Number(cartao_id) ||
    atual.data_compra !== data_primeira_parcela;

  transacao(() => {
    executar(`UPDATE compras SET descricao = ?, cartao_id = ?, categoria_id = ?, grupo_despesa_id = ?, valor_total_centavos = ?,
                 qtd_parcelas = ?, data_compra = ?, observacoes = ? WHERE id = ?`,
      [descricao, cartao_id, categoria_id || null, grupo_despesa_id || null, valorTotalCentavos, qtd_parcelas, data_primeira_parcela, observacoes || null, id]);

    if (precisaRecriar) {
      const cartao = primeiraLinha('SELECT dia_vencimento FROM formas_pagamento WHERE id = ?', [cartao_id]);
      const diaVencimentoCartao = cartao ? cartao.dia_vencimento : null;
      const primeiroVencimento = calcularPrimeiroVencimento(data_primeira_parcela, diaVencimentoCartao);

      executar('DELETE FROM parcelas WHERE compra_id = ?', [id]);
      gerarParcelas(id, valorTotalCentavos, qtd_parcelas, primeiroVencimento);
    }
  });

  await salvarBanco();
  return { mensagem: precisaRecriar ? 'Compra atualizada e parcelas recriadas.' : 'Compra atualizada.' };
}

async function marcarParcelaPaga(id, dataPagamento) {
  const dataPag = dataPagamento || new Date().toISOString().slice(0, 10);
  const r = executar("UPDATE parcelas SET status = 'Pago', data_pagamento = ? WHERE id = ?", [dataPag, Number(id)]);
  if (r.changes === 0) throw new Error('Parcela não encontrada');
  await salvarBanco();
  return { mensagem: 'Parcela marcada como paga' };
}

async function desfazerPagamento(id) {
  const r = executar("UPDATE parcelas SET status = 'Pendente', data_pagamento = NULL WHERE id = ?", [Number(id)]);
  if (r.changes === 0) throw new Error('Parcela não encontrada');
  await salvarBanco();
  return { mensagem: 'Pagamento desfeito' };
}

// Baixa rápida usada pelas tabelas por COMPRA (uma linha = a compra inteira,
// não uma parcela específica): dá baixa na parcela pendente mais antiga dessa
// compra. Numa compra parcelada isso paga uma parcela de cada vez, na ordem
// certa; numa compra à vista só existe uma parcela mesmo.
async function pagarProximaParcela(compraId, dataPagamento) {
  const proxima = primeiraLinha(
    "SELECT id FROM parcelas WHERE compra_id = ? AND status = 'Pendente' ORDER BY data_vencimento ASC, num_parcela ASC LIMIT 1",
    [Number(compraId)]
  );
  if (!proxima) throw new Error('Não há parcela pendente nesta compra');
  return marcarParcelaPaga(proxima.id, dataPagamento);
}

// Desfaz o "irmão" da baixa acima: volta a parcela paga mais recente (a
// última que teria sido paga, na mesma ordem que pagarProximaParcela usa pra
// avançar) pra pendente de novo. É o que o ícone "✔" chama quando o usuário
// clica de novo numa compra já quitada, pra deixá-la pendente outra vez.
async function desfazerUltimaParcelaPaga(compraId) {
  const ultima = primeiraLinha(
    "SELECT id FROM parcelas WHERE compra_id = ? AND status = 'Pago' ORDER BY data_vencimento DESC, num_parcela DESC LIMIT 1",
    [Number(compraId)]
  );
  if (!ultima) throw new Error('Não há parcela paga nesta compra');
  return desfazerPagamento(ultima.id);
}

async function corrigirVencimentoParcela(id, dataVencimento) {
  if (!dataVencimento) throw new Error('Campo obrigatório: data_vencimento');
  const r = executar('UPDATE parcelas SET data_vencimento = ? WHERE id = ?', [dataVencimento, Number(id)]);
  if (r.changes === 0) throw new Error('Parcela não encontrada');
  await salvarBanco();
  return { mensagem: 'Data de vencimento corrigida' };
}

async function corrigirDataCompra(id, dataCompra) {
  if (!dataCompra) throw new Error('Campo obrigatório: data_compra');
  const r = executar('UPDATE compras SET data_compra = ? WHERE id = ?', [dataCompra, Number(id)]);
  if (r.changes === 0) throw new Error('Compra não encontrada');
  await salvarBanco();
  return { mensagem: 'Data da compra corrigida' };
}

async function excluirCompra(id) {
  // Apaga as parcelas primeiro, explicitamente -- não dá pra confiar só no
  // ON DELETE CASCADE da FK aqui: essa build do sql.js não estava fazendo a
  // cascata de verdade, o que deixava as parcelas da compra excluída órfãs
  // (sem compra_id válido) e ainda contando em todos os totais do sistema
  // (KPIs, gráficos, tabelas) -- o valor "excluído" nunca saía da conta.
  executar('DELETE FROM parcelas WHERE compra_id = ?', [Number(id)]);
  const r = executar('DELETE FROM compras WHERE id = ?', [Number(id)]);
  if (r.changes === 0) throw new Error('Compra não encontrada');
  await salvarBanco();
  return { mensagem: 'Compra e parcelas removidas' };
}

// ---------------------------------------------------------------------
// Dashboard: views + listagem de parcelas com filtro
// ---------------------------------------------------------------------
function dashboardKpis() {
  // A tela espera um array (herança do "SELECT * FROM view" da versão
  // servidor, que sempre devolve lista) e lê o primeiro item: r[0][0].
  return [mapKpis(primeiraLinha('SELECT * FROM vw_kpis'))];
}
function dashboardSaldoPorCartao() {
  return todasLinhas('SELECT * FROM vw_saldo_por_cartao ORDER BY parcelado_pendente_centavos DESC').map(mapSaldoPorCartao);
}
function dashboardSaldoPorCategoria() {
  return todasLinhas('SELECT * FROM vw_saldo_por_categoria ORDER BY parcelado_pendente_centavos DESC').map(mapSaldoPorCategoria);
}
function dashboardResumoPorCompra() {
  return listarComprasResumo();
}
function dashboardProjecao() {
  return todasLinhas('SELECT * FROM vw_projecao_mensal ORDER BY mes').map(mapProjecaoMensal);
}

function dashboardParcelas({ status, mes }) {
  const condicoes = ['1 = 1'];
  const params = [];
  if (status) { condicoes.push('p.status = ?'); params.push(status); }
  if (mes) {
    condicoes.push("p.data_vencimento >= ? AND p.data_vencimento < date(?, '+1 month')");
    params.push(mes + '-01', mes + '-01');
  }
  const linhas = todasLinhas(`
    SELECT p.id AS parcela_id, p.compra_id, p.num_parcela, p.valor_centavos, p.data_vencimento, p.status,
           c.descricao, c.qtd_parcelas, c.data_compra, c.valor_total_centavos, ca.nome AS cartao, ca.dia_vencimento AS cartao_dia_vencimento, cat.nome AS categoria, gr.nome AS grupo,
           (SELECT COUNT(*) FROM parcelas p2 WHERE p2.compra_id = p.compra_id AND p2.status = 'Pago') AS qtd_parcelas_pagas,
           (SELECT IFNULL(SUM(valor_centavos),0) FROM parcelas p3 WHERE p3.compra_id = p.compra_id AND p3.status = 'Pendente') AS saldo_aberto_centavos
    FROM parcelas p
    LEFT JOIN compras c  ON c.id  = p.compra_id
    LEFT JOIN formas_pagamento ca ON ca.id = c.cartao_id
    LEFT JOIN tipos_despesa cat ON cat.id = c.categoria_id
    LEFT JOIN grupos_despesa gr ON gr.id = c.grupo_despesa_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY p.data_vencimento`, params);

  return linhas.map((l) => ({
    parcela_id: l.parcela_id,
    compra_id: l.compra_id,
    num_parcela: l.num_parcela,
    valor: paraReais(l.valor_centavos),
    data_vencimento: l.data_vencimento,
    status: l.status,
    descricao: l.descricao || '(compra não encontrada)',
    qtd_parcelas: l.qtd_parcelas,
    data_compra: l.data_compra,
    valor_total: paraReais(l.valor_total_centavos),
    cartao: l.cartao,
    cartao_dia_vencimento: l.cartao_dia_vencimento,
    categoria: l.categoria,
    grupo: l.grupo,
    qtd_parcelas_pagas: l.qtd_parcelas_pagas,
    saldo_aberto: paraReais(l.saldo_aberto_centavos),
  }));
}

// ---------------------------------------------------------------------
// Orçamento mensal (itens identificados)
// ---------------------------------------------------------------------
function listarItensOrcamento(mes) {
  const linhas = mes
    ? todasLinhas('SELECT id, ano_mes, descricao, valor_centavos FROM orcamento_itens WHERE ano_mes = ? ORDER BY id', [mes + '-01'])
    : todasLinhas('SELECT id, ano_mes, descricao, valor_centavos FROM orcamento_itens ORDER BY ano_mes, id');
  return linhas.map((r) => ({ id: r.id, ano_mes: r.ano_mes, descricao: r.descricao, valor: paraReais(r.valor_centavos) }));
}

function totaisOrcamento() {
  const linhas = todasLinhas('SELECT ano_mes, SUM(valor_centavos) AS total_centavos FROM orcamento_itens GROUP BY ano_mes ORDER BY ano_mes');
  return linhas.map((l) => ({ ano_mes: l.ano_mes, total: paraReais(l.total_centavos) }));
}

async function criarItemOrcamento({ ano_mes, descricao, valor }) {
  if (!ano_mes || !descricao || valor === undefined || isNaN(Number(valor)) || Number(valor) < 0) {
    throw new Error('Campos obrigatórios: ano_mes, descricao, valor (0 ou maior)');
  }
  executar('INSERT INTO orcamento_itens (ano_mes, descricao, valor_centavos) VALUES (?, ?, ?)', [ano_mes + '-01', descricao, paraCentavos(valor)]);
  const id = ultimoIdInserido();
  await salvarBanco();
  return { id, mensagem: 'Orçamento incluído' };
}

async function atualizarItemOrcamento(id, { descricao, valor }) {
  if (!descricao || valor === undefined || isNaN(Number(valor)) || Number(valor) < 0) {
    throw new Error('Campos obrigatórios: descricao, valor (0 ou maior)');
  }
  const r = executar('UPDATE orcamento_itens SET descricao = ?, valor_centavos = ? WHERE id = ?', [descricao, paraCentavos(valor), Number(id)]);
  if (r.changes === 0) throw new Error('Item de orçamento não encontrado');
  await salvarBanco();
  return { mensagem: 'Orçamento atualizado' };
}

async function excluirItemOrcamento(id) {
  const r = executar('DELETE FROM orcamento_itens WHERE id = ?', [Number(id)]);
  if (r.changes === 0) throw new Error('Item de orçamento não encontrado');
  await salvarBanco();
  return { mensagem: 'Orçamento removido' };
}

// ---------------------------------------------------------------------
// Parcelas órfãs: registros de "parcelas" cujo compra_id não bate com
// nenhuma linha de "compras" (dado antigo/migrado, ou sobra de algum bug já
// corrigido — não tem como "editar" porque não existe descrição/forma de
// pagamento/data de compra pra elas, só dá pra revisar e excluir).
// ---------------------------------------------------------------------
function listarParcelasOrfas() {
  const linhas = todasLinhas(`
    SELECT p.id, p.compra_id, p.num_parcela, p.valor_centavos, p.data_vencimento, p.status
    FROM parcelas p
    WHERE NOT EXISTS (SELECT 1 FROM compras c WHERE c.id = p.compra_id)
    ORDER BY p.data_vencimento`);
  return linhas.map((l) => ({
    id: l.id,
    compra_id: l.compra_id,
    num_parcela: l.num_parcela,
    valor: paraReais(l.valor_centavos),
    data_vencimento: l.data_vencimento,
    status: l.status,
  }));
}

async function excluirParcelaOrfa(id) {
  const r = executar(
    'DELETE FROM parcelas WHERE id = ? AND NOT EXISTS (SELECT 1 FROM compras c WHERE c.id = parcelas.compra_id)',
    [Number(id)]
  );
  if (r.changes === 0) throw new Error('Parcela não encontrada (ou não é órfã)');
  await salvarBanco();
  return { mensagem: 'Parcela removida' };
}

return {
  listarCartoes, criarCartao, atualizarCartao, excluirCartao, listarCategorias,
  listarGruposDespesa, criarGrupoDespesa, atualizarGrupoDespesa, excluirGrupoDespesa,
  criarTipoDespesa, atualizarTipoDespesa, excluirTipoDespesa,
  listarComprasResumo, obterCompra, criarCompra, atualizarCompra,
  marcarParcelaPaga, desfazerPagamento, pagarProximaParcela, desfazerUltimaParcelaPaga, corrigirVencimentoParcela, corrigirDataCompra, excluirCompra,
  dashboardKpis, dashboardSaldoPorCartao, dashboardSaldoPorCategoria, dashboardResumoPorCompra, dashboardProjecao, dashboardParcelas,
  listarItensOrcamento, totaisOrcamento, criarItemOrcamento, atualizarItemOrcamento, excluirItemOrcamento,
  listarParcelasOrfas, excluirParcelaOrfa,
};
})();
