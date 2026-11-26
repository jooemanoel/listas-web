// Datas para exibir: "hoje às 14:32", "ontem às 09:10", "18/11 às 20:05", "18/11/2025 às 20:05".
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const diaMesAno = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function formatarData(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const dias = Math.round((inicioDoDia(new Date()) - inicioDoDia(data)) / 86400000);
  const dia =
    dias === 0 ? "hoje" : dias === 1 ? "ontem" : data.getFullYear() === new Date().getFullYear() ? diaMes.format(data) : diaMesAno.format(data);
  return `${dia} às ${hora.format(data)}`;
}

// Texto da lista para colar no WhatsApp: título em *negrito* e um item por linha ("- ",
// que o WhatsApp mostra como lista). Lembretes (várias linhas) vão inteiros, separados por uma linha.
export function listaParaTexto(nome, itens, formato = "itens") {
  if (formato === "lembretes") return [`*${nome}*`, itens.map((i) => i.nome).join("\n\n———\n\n")].join("\n\n");
  return [`*${nome}*`, "", ...itens.map((i) => `- ${i.nome}`)].join("\n");
}

/** "1 item", "3 itens", "2 lembretes". */
export function contagem(n, lembretes = false) {
  if (lembretes) return `${n} ${n === 1 ? "lembrete" : "lembretes"}`;
  return `${n} ${n === 1 ? "item" : "itens"}`;
}
