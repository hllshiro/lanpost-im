<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, X } from '@lucide/vue'
import type { PeerInfo } from '../../../shared/domain'
import { initialOf } from '../utils/format'

const props = defineProps<{
  mode: 'create' | 'invite'
  title: string
  peers: PeerInfo[]
  excludeUserIds: string[]
}>()

const emit = defineEmits<{
  close: []
  confirm: [name: string, userIds: string[]]
}>()

const name = ref('')
const selected = ref<string[]>([])

const excluded = computed(() => new Set(props.excludeUserIds))

const candidates = computed(() =>
  props.peers.filter(
    (peer) =>
      (peer.privateUserId ?? '') !== '' &&
      peer.online &&
      !excluded.value.has(peer.privateUserId ?? '')
  )
)

const canConfirm = computed(
  () => selected.value.length > 0 && (props.mode === 'invite' || name.value.trim() !== '')
)

const heading = computed(() =>
  props.mode === 'create' ? '新建群聊' : `邀请成员加入「${props.title}」`
)

function toggle(peer: PeerInfo): void {
  const userId = peer.privateUserId ?? ''
  if (userId === '') return
  if (selected.value.includes(userId)) {
    selected.value = selected.value.filter((id) => id !== userId)
  } else {
    selected.value = [...selected.value, userId]
  }
}

function confirm(): void {
  if (!canConfirm.value) return
  emit('confirm', name.value.trim(), selected.value)
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" role="dialog" :aria-label="heading">
      <header class="dialog-head">
        <h3>{{ heading }}</h3>
        <button class="close" title="关闭" @click="emit('close')">
          <X :size="15" :stroke-width="2" />
        </button>
      </header>

      <label v-if="mode === 'create'" class="name-field">
        <span>群名称</span>
        <input v-model="name" type="text" maxlength="40" placeholder="给群起个名字" />
      </label>

      <div class="members">
        <div v-if="candidates.length === 0" class="empty">
          没有可选的在线成员，私有会话就绪后才能加进群。
        </div>
        <button
          v-for="peer in candidates"
          :key="peer.key"
          class="member"
          :class="{ picked: selected.includes(peer.privateUserId ?? '') }"
          @click="toggle(peer)"
        >
          <span class="avatar">{{ initialOf(peer.alias || peer.name || peer.ip) }}</span>
          <span class="member-text">
            <span class="member-name">{{ peer.alias || peer.name || peer.ip }}</span>
            <span class="member-host">{{ peer.ip }}</span>
          </span>
          <span class="check" :class="{ on: selected.includes(peer.privateUserId ?? '') }">
            <Check
              v-if="selected.includes(peer.privateUserId ?? '')"
              :size="12"
              :stroke-width="3"
            />
          </span>
        </button>
      </div>

      <footer class="dialog-foot">
        <span class="count">已选 {{ selected.length }} 人</span>
        <span class="spacer" />
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" :disabled="!canConfirm" @click="confirm">
          {{ mode === 'create' ? '创建' : '邀请' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.32);
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(420px, 88vw);
  max-height: min(560px, 82vh);
  border-radius: 12px;
  background: var(--page-bg);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.close:hover {
  background: var(--hover);
  color: var(--text);
}

.name-field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.name-field input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--divider);
  border-radius: 6px;
  background: var(--card-bg);
  color: var(--text);
  font-size: 13px;
}

.members {
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  padding: 4px 8px;
}

.member {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.member:hover {
  background: var(--hover);
}

.avatar {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--divider);
  color: var(--text-secondary);
  font-size: 13px;
}

.member-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.member-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.member-host {
  font-size: 11px;
  color: var(--text-muted);
}

.check {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--divider);
  border-radius: 5px;
  color: #ffffff;
}

.check.on {
  border-color: var(--accent);
  background: var(--accent);
}

.empty {
  padding: 24px 12px;
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: center;
}

.dialog-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 14px;
}

.count {
  font-size: 12px;
  color: var(--text-muted);
}

.spacer {
  flex: 1;
}

.ghost,
.primary {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
}

.ghost {
  border: 1px solid var(--divider);
  background: transparent;
  color: var(--text-secondary);
}

.primary {
  border: 0;
  background: var(--accent);
  color: #ffffff;
}

.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
