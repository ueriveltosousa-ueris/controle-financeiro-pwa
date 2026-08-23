// js/datas.js — cálculo de vencimento de parcelas.
// Cópia exata da lógica já validada (ver BRIEFING_PROJETO_SQLITE.md e
// ..\datas.js da versão servidor). Script clássico (sem módulos) — as
// funções ficam no escopo global, como o resto da tela.

// Calcula o vencimento da 1ª parcela: SEMPRE no mês seguinte ao da compra
// (nunca no mesmo mês, mesmo que o dia de vencimento do cartão ainda não
// tenha passado). Se o cartão não tem vencimento configurado, usa a
// própria data da compra.
function calcularPrimeiroVencimento(dataCompraStr, diaVencimentoCartao) {
  if (!diaVencimentoCartao) return dataCompraStr;
  const d = new Date(dataCompraStr + 'T00:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + 1); // sempre avança um mês
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(diaVencimentoCartao, ultimoDia));
  return d.toISOString().slice(0, 10);
}

// Soma "months" meses a uma data "YYYY-MM-DD", tratando fim de mês
// (ex.: 31/01 + 1 mês vira 28/02, não 03/03 — o SQLite sozinho não faz
// esse ajuste, por isso essa conta sempre passa por aqui).
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const ultimoDiaDoMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDiaDoMes));
  return d.toISOString().slice(0, 10);
}
