<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    type="button"
    class="toggle"
    :class="{ on: model }"
    role="switch"
    :aria-checked="model"
    @click="model = !model"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.toggle {
  position: relative;
  flex: 0 0 auto;
  width: 38px;
  height: 22px;
  border-radius: 11px;
  background: #d5d5d5;
  transition: background-color 0.15s ease;
}

.toggle.on {
  background: var(--accent);
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
  transition: transform 0.15s ease;
}

.toggle.on .knob {
  transform: translateX(16px);
}
</style>
