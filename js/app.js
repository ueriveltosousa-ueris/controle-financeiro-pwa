// js/app.js — substitui a camada HTTP da versão servidor: a mesma função
// api(rota, opcoes) que a tela (index.html) já chama, mas em vez de fazer
// fetch(), despacha direto pra js/dados.js (banco local no navegador).
// Também cuida do backup manual (exportar/importar) e do registro do
// service worker (PWA instalável/offline).

async function api(rota, opcoes) {
  opcoes = opcoes || {};
  const metodo = (opcoes.method || 'GET').toUpperCase();
  const [caminho, querystring] = rota.split('?');
  const params = new URLSearchParams(querystring || '');
  let corpo = {};
  if (opcoes.body) {
    try { corpo = JSON.parse(opcoes.body); } catch (e) { corpo = {}; }
  }
  const resultado = await despachar(metodo, caminho, params, corpo);
  return resultado === undefined ? {} : resultado;
}

async function despachar(metodo, caminho, params, corpo) {
  const partes = caminho.split('/').filter(Boolean);

  if (partes[0] === 'referencias') {
    if (partes[1] === 'cartoes') {
      if (partes.length === 2 && metodo === 'GET') return Dados.listarCartoes();
      if (partes.length === 2 && metodo === 'POST') return Dados.criarCartao(corpo);
      if (partes.length === 3 && metodo === 'PUT') return Dados.atualizarCartao(partes[2], corpo);
      if (partes.length === 3 && metodo === 'DELETE') return Dados.excluirCartao(partes[2]);
    }
    if (partes[1] === 'categorias' && partes.length === 2 && metodo === 'GET') return Dados.listarCategorias();
    if (partes[1] === 'grupos-despesa') {
      if (partes.length === 2 && metodo === 'GET') return Dados.listarGruposDespesa();
      if (partes.length === 2 && metodo === 'POST') return Dados.criarGrupoDespesa(corpo);
      if (partes.length === 3 && metodo === 'PUT') return Dados.atualizarGrupoDespesa(partes[2], corpo);
      if (partes.length === 3 && metodo === 'DELETE') return Dados.excluirGrupoDespesa(partes[2]);
    }
    if (partes[1] === 'tipos-despesa') {
      if (partes.length === 2 && metodo === 'GET') return Dados.listarCategorias();
      if (partes.length === 2 && metodo === 'POST') return Dados.criarTipoDespesa(corpo);
      if (partes.length === 3 && metodo === 'PUT') return Dados.atualizarTipoDespesa(partes[2], corpo);
      if (partes.length === 3 && metodo === 'DELETE') return Dados.excluirTipoDespesa(partes[2]);
    }
  }

  if (partes[0] === 'orcamento') {
    if (partes.length === 1 && metodo === 'GET') return Dados.listarItensOrcamento(params.get('mes'));
    if (partes.length === 1 && metodo === 'POST') return Dados.criarItemOrcamento(corpo);
    if (partes.length === 2 && partes[1] === 'totais' && metodo === 'GET') return Dados.totaisOrcamento();
    if (partes.length === 2 && metodo === 'PUT') return Dados.atualizarItemOrcamento(partes[1], corpo);
    if (partes.length === 2 && metodo === 'DELETE') return Dados.excluirItemOrcamento(partes[1]);
  }

  if (partes[0] === 'dashboard') {
    if (partes[1] === 'kpis') return Dados.dashboardKpis();
    if (partes[1] === 'saldo-por-cartao') return Dados.dashboardSaldoPorCartao();
    if (partes[1] === 'saldo-por-categoria') return Dados.dashboardSaldoPorCategoria();
    if (partes[1] === 'resumo-por-compra') return Dados.dashboardResumoPorCompra();
    if (partes[1] === 'projecao') return Dados.dashboardProjecao();
    if (partes[1] === 'parcelas') return Dados.dashboardParcelas({ status: params.get('status'), mes: params.get('mes') });
  }

  if (partes[0] === 'compras') {
    if (partes.length === 1 && metodo === 'GET') return Dados.listarComprasResumo();
    if (partes.length === 1 && metodo === 'POST') return Dados.criarCompra(corpo);
    if (partes[1] === 'orfas') {
      if (partes.length === 2 && metodo === 'GET') return Dados.listarParcelasOrfas();
      if (partes.length === 3 && metodo === 'DELETE') return Dados.excluirParcelaOrfa(partes[2]);
    }
    if (partes[1] === 'parcelas' && partes.length === 4) {
      const id = partes[2], acao = partes[3];
      if (acao === 'pagar') return Dados.marcarParcelaPaga(id, corpo.data_pagamento);
      if (acao === 'despagar') return Dados.desfazerPagamento(id);
      if (acao === 'vencimento') return Dados.corrigirVencimentoParcela(id, corpo.data_vencimento);
    }
    if (partes.length === 2 && metodo === 'GET') return Dados.obterCompra(partes[1]);
    if (partes.length === 2 && metodo === 'PUT') return Dados.atualizarCompra(partes[1], corpo);
    if (partes.length === 2 && metodo === 'DELETE') return Dados.excluirCompra(partes[1]);
    if (partes.length === 3 && partes[2] === 'data-compra' && metodo === 'PATCH') return Dados.corrigirDataCompra(partes[1], corpo.data_compra);
  }

  throw new Error('Rota não implementada: ' + metodo + ' ' + caminho);
}

// ---------------------------------------------------------------------
// Backup manual (exportar/importar) — a rede de segurança contra o iOS
// (ou qualquer navegador) apagar o armazenamento local sob pressão de
// espaço. Ver decisão registrada na conversa: isso não é opcional.
// ---------------------------------------------------------------------
function nomeArquivoBackup() {
  const hoje = new Date().toISOString().slice(0, 10);
  return `controle-financeiro-backup-${hoje}.sqlite`;
}

function exportarBackup() {
  const bytes = exportarBytes();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoBackup();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  salvarMetadados({ ultimoBackupExportadoEm: new Date().toISOString() });
}

function importarBackup(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = async () => {
      try {
        await importarBytes(new Uint8Array(leitor.result));
        resolve();
      } catch (e) { reject(e); }
    };
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsArrayBuffer(arquivo);
  });
}

// ---------------------------------------------------------------------
// Registro do service worker (funciona offline, fica instalável)
// ---------------------------------------------------------------------
function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Sem service worker o app ainda funciona online normalmente — só
      // não fica instalável/offline. Não trava o carregamento por isso.
    });
  }
}
