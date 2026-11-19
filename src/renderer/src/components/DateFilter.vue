<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'

const props = defineProps<{
  // 选中的日期，YYYY-MM-DD；空串表示不筛
  value: string
  // 有消息的日期，YYYY-MM-DD，只有这些日期可以点
  days: string[]
}>()

const emit = defineEmits<{
  select: [day: string]
}>()

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const cursor = ref(new Date())

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

const daySet = computed(() => new Set(props.days))

function pad(value: number): string {
  return `${value}`.padStart(2, '0')
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const todayKey = computed(() => dayKey(new Date()))

const title = computed(() => `${cursor.value.getFullYear()} 年 ${cursor.value.getMonth() + 1} 月`)

const label = computed(() => {
  if (props.value === '') return '全部日期'
  const date = new Date(`${props.value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return props.value
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
})

interface CalendarCell {
  key: string
  label: string
  enabled: boolean
  selected: boolean
  today: boolean
}

const cells = computed<CalendarCell[]>(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  // 周一开头
  const leading = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const list: CalendarCell[] = []
  for (let index = 0; index < leading; index += 1) {
    list.push({ key: `blank-${index}`, label: '', enabled: false, selected: false, today: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`
    list.push({
      key,
      label: `${day}`,
      enabled: daySet.value.has(key),
      selected: key === props.value,
      today: key === todayKey.value
    })
  }
  return list
})

function toggle(): void {
  if (!open.value) {
    cursor.value = props.value === '' ? new Date() : new Date(`${props.value}T00:00:00`)
  }
  open.value = !open.value
}

function moveMonth(delta: number): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1)
}

function pick(day: string): void {
  open.value = false
  if (day !== props.value) emit('select', day)
}

onClickOutside(anchor, () => {
  open.value = false
})
</script>

<template>
  <div ref="anchor" class="date-filter">
    <button
      class="date-trigger"
      :class="{ active: value !== '' }"
      aria-label="按日期筛选"
      @click="toggle"
    >
      <CalendarDays :size="14" :stroke-width="1.8" />
      <span>{{ label }}</span>
    </button>

    <div v-if="open" class="date-panel" role="dialog" aria-label="选择日期">
      <header class="date-head">
        <button class="date-nav" title="上个月" @click="moveMonth(-1)">
          <ChevronLeft :size="14" :stroke-width="1.8" />
        </button>
        <span class="date-title">{{ title }}</span>
        <button class="date-nav" title="下个月" @click="moveMonth(1)">
          <ChevronRight :size="14" :stroke-width="1.8" />
        </button>
      </header>

      <div class="date-week">
        <span v-for="item in weekdays" :key="item">{{ item }}</span>
      </div>

      <div class="date-grid">
        <button
          v-for="cell in cells"
          :key="cell.key"
          class="date-cell"
          :data-day="cell.key"
          :class="{
            blank: !cell.enabled && cell.label === '',
            enabled: cell.enabled,
            selected: cell.selected,
            today: cell.today
          }"
          :disabled="!cell.enabled"
          :title="cell.enabled ? '' : '这一天没有消息'"
          @click="pick(cell.key)"
        >
          {{ cell.label }}
        </button>
      </div>

      <footer class="date-foot">
        <button class="date-all" :disabled="value === ''" @click="pick('')">查看全部日期</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.date-filter {
  position: relative;
}

.date-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.date-trigger:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.date-trigger.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.date-panel {
  position: absolute;
  top: 32px;
  right: 0;
  z-index: 90;
  width: 252px;
  padding: 10px;
  border: 1px solid var(--divider);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
}

.date-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.date-nav {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
}

.date-nav:hover {
  background: var(--hover);
  color: var(--text);
}

.date-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.date-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.date-week span {
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
}

.date-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.date-cell {
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: var(--text-muted);
}

.date-cell.blank {
  visibility: hidden;
}

.date-cell.enabled {
  background: #f1f7f3;
  color: #2f7a45;
  font-weight: 600;
  cursor: pointer;
}

.date-cell.enabled:hover {
  background: #dff0e6;
}

.date-cell.today {
  box-shadow: inset 0 0 0 1px rgba(7, 193, 96, 0.5);
}

.date-cell.selected {
  background: var(--accent);
  color: #ffffff;
  box-shadow: none;
}

.date-cell:disabled {
  cursor: default;
}

.date-foot {
  display: flex;
  justify-content: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--divider);
}

.date-all {
  height: 24px;
  padding: 0 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11.5px;
}

.date-all:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text);
}

.date-all:disabled {
  opacity: 0.5;
}
</style>
