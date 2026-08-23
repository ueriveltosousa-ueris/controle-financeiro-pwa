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
      if (partes.length === 2 && metodo === 'GET') return listarCartoes();
      if (partes.length === 2 && metodo === 'POST') return criarCartao(corpo);
      if (partes.length === 3 && metodo === 'PUT') return atualizarCartao(partes[2], corpo);
      if (partes.length === 3 && metodo === 'DELETE') return excluirCartao(partes[2]);
    }
    if (partes[1] === 'categorias' && partes.length === 2 && metodo === 'GET') return listarCategorias();
  }

  if (partes[0] === 'orcamento') {
    if (partes.length === 1 && metodo === 'GET') return listarItensOrcamento(params.get('mes'));
    if (partes.length === 1 && metodo === 'POST') return criarItemOrcamento(corpo);
    if (partes.length === 2 && partes[1] === 'totais' && metodo === 'GET') return totaisOrcamento();
    if (partes.length === 2 && metodo === 'PUT') return atualizarItemOrcamento(partes[1], corpo);
    if (partes.length === 2 && metodo === 'DELETE') return excluirItemOrcamento(partes[1]);
  }

  if (partes[0] === 'dashboard') {
    if (partes[1] === 'kpis') return dashboardKpis();
    if (partes[1] === 'saldo-por-cartao') return dashboardSaldoPorCartao();
    if (partes[1] === 'saldo-por-categoria') return dashboardSaldoPorCategoria();
    if (partes[1] === 'resumo-por-compra') return dashboardResumoPorCompra();
    if (partes[1] === 'projecao') return dashboardProjecao();
    if (partes[1] === 'parcelas') return dashboardParcelas({ status: params.get('status'), mes: params.get('mes') });
  }

  if (partes[0] === 'compras') {
    if (partes.length === 1 && metodo === 'GET') return listarComprasResumo();
    if (partes.length === 1 && metodo === 'POST') return criarCompra(corpo);
    if (partes[1] === 'parcelas' && partes.length === 4) {
      const id = partes[2], acao = partes[3];
      if (acao === 'pagar') return marcarParcelaPaga(id, corpo.data_pagamento);
      if (acao === 'despagar') return desfazerPagamento(id);
      if (acao === 'vencimento') return corrigirVencimentoParcela(id, corpo.data_vencimento);
    }
    if (partes.length === 2 && metodo === 'GET') return obterCompra(partes[1]);
    if (partes.length === 2 && metodo === 'PUT') return atualizarCompra(partes[1], corpo);
    if (partes.length === 2 && metodo === 'DELETE') return excluirCompra(partes[1]);
    if (partes.length === 3 && partes[2] === 'data-compra' && metodo === 'PATCH') return corrigirDataCompra(partes[1], corpo.data_compra);
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
