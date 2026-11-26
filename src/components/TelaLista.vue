<script setup>
// Itens de uma lista: adicionar, marcar/desmarcar e remover.
// Listas de lembretes usam um campo de várias linhas e mostram o texto como foi colado.
// Tudo responde na hora (também offline); o servidor recebe na sincronização.
import { computed, nextTick, ref, watch } from "vue";
import Icone from "./Icone.vue";
import { ir } from "../composables/useRota.js";
import { LIMITE_LEMBRETE, resumir, useListas } from "../composables/useListas.js";
import { avisar } from "../composables/useAviso.js";
import { formatarData, listaParaTexto } from "../formatar.js";

const props = defineProps({ id: { type: String, required: true } });
const emit = defineEmits(["titulo"]);

const { listas, encontrar, abrir, adicionarItem, marcarItem, removerItem, conexao } = useListas();

const lista = computed(() => encontrar(props.id));
const lembretes = computed(() => lista.value?.formato === "lembretes");
const novo = ref("");
const campo = ref(null);
/** Ids dos lembretes longos abertos por inteiro. */
const abertos = ref(new Set());
const podeColar = typeof navigator.clipboard?.readText === "function";

// Lembretes com mais de 6 linhas (ou muito texto) aparecem recolhidos.
const longo = (texto) => texto.split("\n").length > 6 || texto.length > 320;

function alternar(id) {
  const novos = new Set(abertos.value);
  novos.has(id) ? novos.delete(id) : novos.add(id);
  abertos.value = novos;
}

// Não marcados primeiro; marcados vão para o fim (ordem de inclusão mantida em cada grupo).
const itens = computed(() => {
  const todos = lista.value?.itens ?? [];
  return [...todos.filter((i) => !i.marcado), ...todos.filter((i) => i.marcado)];
});
const totalMarcados = computed(() => itens.value.filter((i) => i.marcado).length);

watch(lista, (l) => emit("titulo", l?.nome ?? ""), { immediate: true });

// Ao abrir, busca a versão do servidor (pode ter mudado em outro aparelho).
watch(() => props.id, (id) => abrir(id), { immediate: true });

// Listas carregadas e esta não está entre elas: foi excluída (aqui ou em outro aparelho).
watch(
  [listas, lista],
  ([todas, atual]) => {
    if (todas && !atual) {
      avisar("Esta lista não existe mais.", "erro");
      ir("/");
    }
  },
  { immediate: true }
);

async function copiar(texto = listaParaTexto(lista.value.nome, itens.value, lista.value.formato), mensagem) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Sem a API de área de transferência (ex.: página fora de HTTPS): recurso antigo.
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) return avisar("Não foi possível copiar.", "erro");
  }
  avisar(mensagem ?? "Lista copiada. É só colar no WhatsApp.");
}

async function colar() {
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto.trim()) return avisar("A área de transferência está vazia.", "erro");
    novo.value = novo.value.trim() ? `${novo.value.trimEnd()}\n${texto}` : texto;
    await nextTick();
    ajustarAltura();
  } catch {
    avisar("Sem permissão para colar. Toque e segure no campo e escolha Colar.", "erro");
  }
}

// O campo de lembrete cresce com o texto (até um limite; depois rola).
function ajustarAltura() {
  const el = campo.value;
  if (!el || el.tagName !== "TEXTAREA") return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 4}px`;
}

function remover(item) {
  if (lembretes.value && !confirm(`Remover o lembrete "${resumir(item.nome)}"?`)) return;
  removerItem(props.id, item);
}

async function adicionar() {
  const nome = novo.value.trim();
  if (!nome) return;
  if (adicionarItem(props.id, novo.value)) novo.value = "";
  await nextTick();
  ajustarAltura();
  // Lembretes: o teclado fecha (normalmente é um texto só). Itens: pronto para o próximo.
  if (lembretes.value) campo.value?.blur();
  else campo.value?.focus();
}
</script>

<template>
  <p v-if="!lista" class="vazio">
    {{ conexao === "offline" ? "Lista não disponível offline neste aparelho." : "Carregando lista…" }}
  </p>

  <template v-else>
    <form v-if="lembretes" class="adicionar-item adicionar-lembrete" @submit.prevent="adicionar">
      <label class="oculto" for="novo-item">Novo lembrete</label>
      <textarea
        id="novo-item"
        ref="campo"
        v-model="novo"
        rows="2"
        placeholder="Cole ou escreva um lembrete"
        :maxlength="LIMITE_LEMBRETE"
        @input="ajustarAltura"
        @keydown.enter.ctrl.prevent="adicionar"
        @keydown.enter.meta.prevent="adicionar"
      ></textarea>
      <div class="acoes-lembrete">
        <button v-if="podeColar" type="button" class="botao-icone" title="Colar" aria-label="Colar da área de transferência" @click="colar">
          <Icone nome="colar" />
        </button>
        <button type="submit" class="botao-icone destaque" aria-label="Adicionar lembrete" :disabled="!novo.trim()">
          <Icone nome="adicionar" />
        </button>
      </div>
    </form>

    <form v-else class="adicionar-item" @submit.prevent="adicionar">
      <label class="oculto" for="novo-item">Novo item</label>
      <input
        id="novo-item"
        ref="campo"
        v-model="novo"
        type="text"
        placeholder="Adicionar item"
        maxlength="100"
        autocapitalize="characters"
        enterkeyhint="done"
      />
      <button type="submit" class="botao-icone destaque" aria-label="Adicionar item" :disabled="!novo.trim()">
        <Icone nome="adicionar" />
      </button>
    </form>

    <!-- Contagem e o atualizadoEm da lista (no servidor, ou a hora da última alteração feita aqui). -->
    <div class="resumo">
      <p>
        <template v-if="itens.length && lembretes">
          {{ itens.length }} {{ itens.length === 1 ? "lembrete" : "lembretes" }}
          <template v-if="totalMarcados">({{ totalMarcados }} {{ totalMarcados === 1 ? "feito" : "feitos" }})</template> ·
        </template>
        <template v-else-if="itens.length">{{ totalMarcados }} de {{ itens.length }} marcados · </template>
        <template v-if="lista.pendente">
          alterada {{ formatarData(lista.atualizadoEm) }} · <span class="pendente">não sincronizada</span>
        </template>
        <template v-else>atualizada {{ formatarData(lista.atualizadoEm) }}</template>
      </p>
      <button
        v-if="itens.length"
        class="botao-icone"
        title="Copiar lista"
        aria-label="Copiar lista para colar no WhatsApp"
        @click="copiar()"
      >
        <Icone nome="copiar" />
      </button>
    </div>

    <section v-if="!itens.length" class="cartao vazio">
      <Icone :nome="lembretes ? 'lembrete' : 'logo'" class="icone-grande" />
      <p v-if="lembretes">
        Nenhum lembrete. Cole um texto (a mensagem da consulta, um endereço…) no campo acima e toque em
        <strong>+</strong>. O texto fica guardado exatamente como foi colado.
      </p>
      <p v-else>Lista vazia. Digite o nome de um item no campo acima e toque em <strong>+</strong> (ou Enter).</p>
    </section>

    <TransitionGroup v-else-if="lembretes" tag="ul" name="item" class="lembretes">
      <li v-for="item in itens" :key="item.id" class="cartao lembrete" :class="{ feito: item.marcado }">
        <p class="texto-lembrete" :class="{ recolhido: longo(item.nome) && !abertos.has(item.id) }">{{ item.nome }}</p>
        <div class="rodape-lembrete">
          <label class="marcar-lembrete">
            <input
              type="checkbox"
              class="oculto"
              :checked="item.marcado"
              @change="marcarItem(id, item, $event.target.checked)"
            />
            <Icone :nome="item.marcado ? 'marcado' : 'desmarcado'" class="caixa" />
            <span>Feito</span>
          </label>
          <button v-if="longo(item.nome)" class="botao-texto" @click="alternar(item.id)">
            {{ abertos.has(item.id) ? "Mostrar menos" : "Mostrar tudo" }}
          </button>
          <button
            class="botao-icone"
            title="Copiar lembrete"
            :aria-label="`Copiar o lembrete ${resumir(item.nome)}`"
            @click="copiar(item.nome, 'Lembrete copiado.')"
          >
            <Icone nome="copiar" />
          </button>
          <button
            class="botao-icone"
            title="Remover lembrete"
            :aria-label="`Remover o lembrete ${resumir(item.nome)}`"
            @click="remover(item)"
          >
            <Icone nome="excluir" />
          </button>
        </div>
      </li>
    </TransitionGroup>

    <template v-else>
      <TransitionGroup tag="ul" name="item" class="linhas">
        <li v-for="item in itens" :key="item.id" class="linha" :class="{ feito: item.marcado }">
          <label class="linha-principal">
            <input
              type="checkbox"
              class="oculto"
              :checked="item.marcado"
              @change="marcarItem(id, item, $event.target.checked)"
            />
            <Icone :nome="item.marcado ? 'marcado' : 'desmarcado'" class="caixa" />
            <span class="nome-item">{{ item.nome }}</span>
          </label>
          <button
            class="botao-icone"
            :aria-label="`Remover ${item.nome}`"
            title="Remover item"
            @click="remover(item)"
          >
            <Icone nome="excluir" />
          </button>
        </li>
      </TransitionGroup>
    </template>
  </template>
</template>
