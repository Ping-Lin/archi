const { nextTick } = Vue;
export const analysisTabs = [
  ['graph', 'Service graph'], ['evidence', 'Connections & evidence'],
  ['resources', 'Resource inventory'], ['compare', 'Compare environments'],
  ['traffic', 'Traffic evidence'], ['runtime', 'Runtime inventory'],
];
export default {
  props: ['modelValue'], emits: ['update:modelValue'],
  setup(props, { emit }) {
    async function keys(event) {
      const button = event.target.closest('[role=tab]');
      if (!button) return;
      const items = [...event.currentTarget.querySelectorAll('[role=tab]')];
      const index = items.indexOf(button);
      const next = { ArrowRight: (index + 1) % items.length, ArrowLeft: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); emit('update:modelValue', analysisTabs[next][0]);
      await nextTick(); items[next].focus();
    }
    return { tabs: analysisTabs, keys };
  },
  template: `<div class="analysis-tabs" role="tablist" aria-label="Analysis views" @keydown="keys"><button v-for="[id,label] in tabs" :key="id" :id="'analysis-tab-'+id" role="tab" aria-controls="analysis-view-panel" :tabindex="modelValue===id?0:-1" :aria-selected="modelValue===id" :class="{active:modelValue===id}" @click="$emit('update:modelValue',id)">{{label}}</button></div>`,
};
