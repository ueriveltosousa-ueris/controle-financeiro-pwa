// js/mapeamentos.js — converte linhas do banco (valores em CENTAVOS, como
// INTEGER) para o formato em reais que a tela (script da index.html, já
// validado) espera.

function mapKpis(r) {
  return {
    total_em_aberto: paraReais(r.total_em_aberto_centavos),
    total_pago: paraReais(r.total_pago_centavos),
    total_aberto_nao_vencido: paraReais(r.total_aberto_nao_vencido_centavos),
    a_vencer_proximo_mes: paraReais(r.a_vencer_proximo_mes_centavos),
    a_vencer_proximo_mes_parcelado: paraReais(r.a_vencer_proximo_mes_parcelado_centavos),
    a_vencer_proximo_mes_avista: paraReais(r.a_vencer_proximo_mes_avista_centavos),
  };
}

function mapSaldoPorCartao(r) {
  const parcelado_pendente = paraReais(r.parcelado_pendente_centavos);
  return {
    cartao: r.cartao,
    parcelado_pendente,
    parcelas_atraso: paraReais(r.parcelas_atraso_centavos),
    compromisso_total: parcelado_pendente,
  };
}

function mapSaldoPorCategoria(r) {
  const parcelado_pendente = paraReais(r.parcelado_pendente_centavos);
  return { categoria: r.categoria, parcelado_pendente, total: parcelado_pendente };
}

function mapProjecaoMensal(r) {
  const total_mes = paraReais(r.parcelas_total_centavos);
  return { mes: r.mes, total_mes, acumulado: paraReais(r.acumulado_centavos) };
}

function mapResumoCompra(r) {
  return {
    compra_id: r.compra_id,
    descricao: r.descricao,
    data_compra: r.data_compra,
    proximo_vencimento: r.proximo_vencimento,
    cartao: r.cartao,
    categoria: r.categoria,
    valor_total: paraReais(r.valor_total_centavos),
    qtd_parcelas: r.qtd_parcelas,
    qtd_parcelas_pagas: r.qtd_parcelas_pagas,
    total_pago: paraReais(r.total_pago_centavos),
    saldo_aberto: paraReais(r.saldo_aberto_centavos),
    pct_concluido: r.pct_concluido,
    situacao: r.situacao,
  };
}

function mapParcela(p) {
  return {
    id: p.id,
    compra_id: p.compra_id,
    num_parcela: p.num_parcela,
    valor: paraReais(p.valor_centavos),
    data_vencimento: p.data_vencimento,
    status: p.status,
    data_pagamento: p.data_pagamento,
  };
}
