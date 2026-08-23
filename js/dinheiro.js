// js/dinheiro.js — conversão entre reais (o que a tela usa) e centavos
// (o que fica guardado no banco, como INTEGER, para evitar erro de
// arredondamento — ver BRIEFING_PROJETO_SQLITE.md).
function paraCentavos(reais) {
  return Math.round(Number(reais) * 100);
}
function paraReais(centavos) {
  return Number(centavos) / 100;
}
