// Estado das listas do usuário, com modo offline.
//
// O aparelho guarda (no localStorage, por usuário):
//   servidor  as listas como o servidor as devolveu da última vez, cada uma com o seu
//             atualizadoEm (a hora da última alteração gravada no Firestore);
//   fila      as alterações feitas aqui que o servidor ainda não recebeu, em ordem.
//             É o histórico: cada uma tem a hora local (`em`), um texto para exibir
//             (`rotulo`) e o atualizadoEm da lista que este aparelho conhecia (`base`).
//
// O que aparece na tela é sempre `servidor` com a `fila` aplicada por cima. Assim toda
// ação responde na hora, com ou sem internet.
//
// Toda alteração entra na fila e a fila é enviada a POST /listas/sincronizar. Online,
// isso acontece logo em seguida; offline, quando a conexão voltar. O servidor compara a
// `base` com o atualizadoEm do Firestore: se o Firestore for mais novo, a lista também
// mudou em outro aparelho, e o usuário é avisado (as alterações daqui são aplicadas
// mesmo assim, item a item).
import { computed, ref } from "vue";
import * as api from "../services/api.js";
import { avisar, avisarErro } from "./useAviso.js";

const TAMANHO_LOTE = 200; // operações por requisição
const NOVA_TENTATIVA = 30000; // ms entre tentativas de reconexão

/** Listas como o servidor as conhece (null = ainda não carregadas). */
const servidor = ref(null);
/** Alterações pendentes, da mais antiga para a mais nova. */
const fila = ref([]);
/** "online" | "offline" | "sincronizando" */
const conexao = ref("online");
/** Hora (ISO) da última sincronização bem-sucedida. */
const sincronizadoEm = ref(null);

let usuarioId = null;
let sincronizando = false;
let temporizador = null;

// ---------- armazenamento no aparelho ----------

const chave = (id) => `listas:${id}`;

function ler(id) {
  try {
    return JSON.parse(localStorage.getItem(chave(id))) ?? null;
  } catch {
    return null;
  }
}

function salvar() {
  if (!usuarioId) return;
  try {
    localStorage.setItem(
      chave(usuarioId),
      JSON.stringify({ servidor: servidor.value, fila: fila.value, sincronizadoEm: sincronizadoEm.value })
    );
  } catch {
    // Armazenamento cheio ou bloqueado: o app segue funcionando só na memória.
  }
}

// ---------- utilitários ----------

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Id aleatório de 20 caracteres (mesmo formato dos ids do Firestore). */
function novoId() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

/** Igual à API: espaços aparados e em maiúsculas. */
export const normalizar = (texto) => String(texto ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Igual à API: texto de um lembrete mantém linhas, maiúsculas e emojis; só padroniza
 * quebras de linha, espaços no fim das linhas e linhas em branco repetidas.
 */
export const normalizarLembrete = (texto) =>
  String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t\u00A0]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Nome de um item novo conforme o formato da lista ("itens" ou "lembretes"). */
export const nomeDoItem = (formato, texto) => (formato === "lembretes" ? normalizarLembrete(texto) : normalizar(texto));

/** Primeira linha, curta: para o histórico e as mensagens (lembretes podem ser longos). */
export function resumir(texto) {
  const linha = String(texto ?? "").split("\n")[0];
  return linha.length > 40 ? `${linha.slice(0, 40)}…` : linha;
}

export const LIMITE_LEMBRETE = 3000; // caracteres, igual à API

const ordenar = (listas) => [...listas].sort((a, b) => a.nome.localeCompare(b.nome));

// ---------- aplicar a fila sobre as listas do servidor ----------

/** Mesmas regras da API (routes/listas.js): o que ela recusaria, aqui também é ignorado. */
function aplicar(listas, op) {
  const i = listas.findIndex((l) => l.id === op.listaId);

  if (op.tipo === "criarLista") {
    if (i < 0) listas.push({ id: op.listaId, nome: op.nome, formato: op.formato ?? "itens", itens: [], criadoEm: op.em, atualizadoEm: op.em, pendente: true });
    return;
  }
  if (i < 0) return;
  if (op.tipo === "excluirLista") {
    listas.splice(i, 1);
    return;
  }

  const lista = listas[i];
  let itens = lista.itens;
  if (op.tipo === "adicionarItem") {
    if (itens.some((it) => it.id === op.itemId || it.nome === op.nome)) return;
    itens = [...itens, { id: op.itemId, nome: op.nome, marcado: false }];
  } else if (op.tipo === "marcarItem") {
    // A marcação saiu do app, mas a fila guardada no aparelho pode ter operações antigas.
    if (!itens.some((it) => it.id === op.itemId)) return;
    itens = itens.map((it) => (it.id === op.itemId ? { ...it, marcado: op.marcado } : it));
  } else if (op.tipo === "removerItem") {
    itens = itens.filter((it) => it.id !== op.itemId);
  }
  listas[i] = { ...lista, itens, atualizadoEm: op.em, pendente: true };
}

/** Listas exibidas: as do servidor com as alterações pendentes por cima. */
const listas = computed(() => {
  if (!servidor.value) return null;
  const copia = servidor.value.map((l) => ({ ...l }));
  fila.value.forEach((op) => aplicar(copia, op));
  return ordenar(copia);
});

function encontrar(id) {
  return listas.value?.find((l) => l.id === id) ?? null;
}

// ---------- conexão ----------

function entrarOffline() {
  if (conexao.value !== "offline") {
    conexao.value = "offline";
    avisar("Sem conexão. Modo offline: as alterações ficam guardadas neste aparelho.", "erro");
  }
  clearTimeout(temporizador);
  temporizador = setTimeout(atualizar, NOVA_TENTATIVA);
}

function ficarOnline() {
  clearTimeout(temporizador);
  if (conexao.value === "offline") avisar("Conexão restabelecida.");
  conexao.value = "online";
}

/** Trata a falha de uma chamada. Devolve true se foi falta de conexão. */
function falhou(erro) {
  if (erro?.status === 0) {
    entrarOffline();
    return true;
  }
  if (erro?.status !== 401) avisarErro(erro); // 401: a sessão já foi encerrada
  if (conexao.value === "sincronizando") conexao.value = "online";
  return false;
}

// ---------- sincronização ----------

/** Incorpora a resposta de POST /listas/sincronizar e tira da fila o que foi enviado. */
function incorporar(lote, resposta) {
  const excluidas = new Set(resposta.excluidas);
  const novas = new Map(resposta.listas.map((l) => [l.id, l]));

  const base = (servidor.value ?? []).filter((l) => !excluidas.has(l.id) && !novas.has(l.id));
  servidor.value = [...base, ...novas.values()];

  // As alterações feitas durante o envio partem do estado que acabou de ser gravado:
  // a base delas passa a ser o novo atualizadoEm (senão pareceriam um conflito).
  const enviadas = new Set(lote.map((op) => op.id));
  fila.value = fila.value
    .filter((op) => !enviadas.has(op.id))
    .map((op) => (novas.has(op.listaId) ? { ...op, base: novas.get(op.listaId).atualizadoEm } : op));

  sincronizadoEm.value = new Date().toISOString();
  salvar();

  // Devolve true se mostrou um aviso (para não ser coberto por "Conexão restabelecida").
  if (resposta.conflitos.length) {
    const nomes = [...new Set(resposta.conflitos.map((id) => lote.find((op) => op.listaId === id)?.rotuloLista))].filter(Boolean);
    avisar(
      `Atenção: ${nomes.length ? nomes.join(", ") : "uma lista"} também foi alterada em outro aparelho. ` +
        "Suas alterações foram aplicadas por cima; confira a lista.",
      "erro",
      10000
    );
    return true;
  }
  if (resposta.ignoradas.length) {
    const n = resposta.ignoradas.length;
    avisar(
      `${n} ${n === 1 ? "alteração não pôde ser aplicada" : "alterações não puderam ser aplicadas"}: ${resposta.ignoradas[0].motivo}`,
      "erro",
      8000
    );
    return true;
  }
  return false;
}

/** Envia a fila em lotes. Se a conexão cair no meio, o que falta continua na fila. */
async function sincronizar() {
  if (sincronizando || !usuarioId || !fila.value.length) return;
  const dono = usuarioId;
  const estavaOffline = conexao.value === "offline";
  sincronizando = true;
  conexao.value = "sincronizando";
  try {
    let avisou = false;
    while (fila.value.length && usuarioId === dono) {
      const lote = fila.value.slice(0, TAMANHO_LOTE);
      const resposta = await api.sincronizar(lote);
      if (usuarioId !== dono) return; // saiu durante o envio
      avisou = incorporar(lote, resposta) || avisou;
    }
    if (estavaOffline && !avisou) avisar("Conexão restabelecida. Alterações sincronizadas.");
    clearTimeout(temporizador);
    conexao.value = "online";
  } catch (erro) {
    falhou(erro); // sem conexão: modo offline, com nova tentativa agendada
  } finally {
    sincronizando = false;
  }
}

/** Envia o que estiver pendente e busca as listas atualizadas do servidor. */
async function atualizar() {
  if (!usuarioId) return;
  if (fila.value.length) {
    await sincronizar();
    if (conexao.value === "offline" || fila.value.length) return;
  }
  const dono = usuarioId;
  try {
    const recebidas = await api.buscarListas();
    if (usuarioId !== dono) return;
    servidor.value = recebidas;
    sincronizadoEm.value = new Date().toISOString();
    salvar();
    ficarOnline();
  } catch (erro) {
    falhou(erro);
  }
}

/** Registra uma alteração: aparece na tela na hora e vai para a fila. */
function registrar(op, rotulo) {
  const lista = servidor.value?.find((l) => l.id === op.listaId);
  const rotuloLista = encontrar(op.listaId)?.nome ?? op.nome;
  fila.value = [
    ...fila.value,
    { id: novoId(), em: new Date().toISOString(), base: lista?.atualizadoEm ?? null, rotulo, rotuloLista, ...op },
  ];
  salvar();
  // Offline, espera a próxima tentativa (ou o evento "online") para não insistir a cada toque.
  if (conexao.value !== "offline") sincronizar();
}

// O navegador avisa quando a rede volta; e ao voltar para o app, tenta de novo.
window.addEventListener("online", () => conexao.value === "offline" && atualizar());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && conexao.value === "offline") atualizar();
});

export function useListas() {
  return {
    listas,
    fila,
    conexao,
    sincronizadoEm,
    encontrar,
    atualizar,

    /** Ao entrar: mostra a cópia guardada no aparelho na hora e depois sincroniza. */
    async carregar(id) {
      usuarioId = id;
      const salvo = ler(id);
      servidor.value = salvo?.servidor ?? null;
      fila.value = salvo?.fila ?? [];
      sincronizadoEm.value = salvo?.sincronizadoEm ?? null;
      await atualizar();
    },

    /** Ao abrir uma lista: busca a versão do servidor (pode ter mudado em outro aparelho). */
    async abrir(id) {
      if (!usuarioId || conexao.value === "offline" || fila.value.length) return;
      const dono = usuarioId;
      try {
        const lista = await api.buscarLista(id);
        if (usuarioId !== dono || fila.value.length || !servidor.value) return;
        servidor.value = [...servidor.value.filter((l) => l.id !== id), lista];
        salvar();
      } catch (erro) {
        if (erro.status === 404 && servidor.value) {
          servidor.value = servidor.value.filter((l) => l.id !== id);
          salvar();
        } else {
          falhou(erro);
        }
      }
    },

    /** formato: "itens" (compras, tarefas) ou "lembretes" (textos guardados como foram escritos). */
    criar(nome, formato = "itens") {
      const id = novoId();
      const nomeFinal = normalizar(nome);
      registrar({ tipo: "criarLista", listaId: id, nome: nomeFinal, formato }, `Criou a lista ${nomeFinal}`);
      return id;
    },

    excluir(id) {
      const lista = encontrar(id);
      registrar({ tipo: "excluirLista", listaId: id }, `Excluiu a lista ${lista?.nome ?? ""}`);
    },

    /** Devolve false (com aviso) se o item já estiver na lista. */
    adicionarItem(listaId, nome) {
      const lista = encontrar(listaId);
      const nomeFinal = nomeDoItem(lista?.formato, nome);
      if (!nomeFinal) return false;
      if (lista?.itens.some((i) => i.nome === nomeFinal)) {
        avisar(`"${resumir(nomeFinal)}" já está na lista`, "erro");
        return false;
      }
      registrar(
        { tipo: "adicionarItem", listaId, itemId: novoId(), nome: nomeFinal },
        `Adicionou ${resumir(nomeFinal)} em ${lista?.nome ?? ""}`
      );
      return true;
    },

    removerItem(listaId, item) {
      const lista = encontrar(listaId);
      registrar({ tipo: "removerItem", listaId, itemId: item.id }, `Removeu ${resumir(item.nome)} de ${lista?.nome ?? ""}`);
    },

    descarregar,

    /** Sair: apaga também a cópia guardada no aparelho (inclusive alterações não enviadas). */
    apagarDoAparelho() {
      if (usuarioId) {
        try {
          localStorage.removeItem(chave(usuarioId));
        } catch {}
      }
      descarregar();
    },
  };
}

/** Troca de usuário ou sessão expirada: esquece da memória, mas mantém o que está no aparelho. */
function descarregar() {
  usuarioId = null;
  servidor.value = null;
  fila.value = [];
  sincronizadoEm.value = null;
  conexao.value = "online";
  clearTimeout(temporizador);
}
