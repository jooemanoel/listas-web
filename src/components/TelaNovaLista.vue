<script setup>
import { ref } from "vue";
import Icone from "./Icone.vue";
import { substituir } from "../composables/useRota.js";
import { useListas } from "../composables/useListas.js";

const { criar } = useListas();
const nome = ref("");
const formato = ref("itens");

const FORMATOS = [
  { valor: "itens", icone: "logo", titulo: "Itens", descricao: "Compras, tarefas: uma linha curta por item." },
  {
    valor: "lembretes",
    icone: "lembrete",
    titulo: "Lembretes",
    descricao: "Textos guardados como foram colados: mensagens de consulta, endereços, recados.",
  },
];

function enviar() {
  if (!nome.value.trim()) return;
  // Criada na hora (também offline); o servidor recebe na sincronização.
  const id = criar(nome.value, formato.value);
  // Abre a lista criada (já pronta para receber itens), sem empilhar no histórico.
  substituir(`/lista/${encodeURIComponent(id)}`);
}
</script>

<template>
  <section class="cartao">
    <h2 class="titulo-cartao">Nova lista</h2>
    <form class="formulario" @submit.prevent="enviar">
      <label class="campo">
        <span>Nome da lista</span>
        <input v-model="nome" type="text" maxlength="60" autocapitalize="characters" autofocus required />
      </label>
      <fieldset class="formatos">
        <legend>Tipo</legend>
        <label v-for="f in FORMATOS" :key="f.valor" class="formato" :class="{ escolhido: formato === f.valor }">
          <input v-model="formato" type="radio" name="formato" :value="f.valor" class="oculto" />
          <Icone :nome="f.icone" />
          <span>
            <strong>{{ f.titulo }}</strong>
            <small>{{ f.descricao }}</small>
          </span>
        </label>
      </fieldset>
      <button type="submit" class="botao-principal" :disabled="!nome.trim()">Criar lista</button>
    </form>
  </section>
</template>
