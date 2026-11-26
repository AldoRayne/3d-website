<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AvatarEditor from '@/components/AvatarEditor.vue'
import { AvatarPortrait } from '@/world/portrait'
import { DEFAULT_AVATAR, avatarDiff, resolveAvatar, sameAvatar, type Avatar, type AvatarPatch } from '@/world/avatar'

const props = defineProps<{
  initial: Avatar
  canEdit: boolean
  restUrl: string
  nonce: string
  userId: number
}>()
const emit = defineEmits<{ preview: [Avatar] }>()

const saved = ref<Avatar>({ ...props.initial })
const avatar = ref<Avatar>({ ...props.initial })
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const error = ref('')
const stage = ref<HTMLElement>()
let portrait: AvatarPortrait | null = null

const dirty = computed(() => !sameAvatar(avatar.value, saved.value))
const savedIsDefault = computed(() => sameAvatar(saved.value, DEFAULT_AVATAR))
const caption = computed(() => (savedIsDefault.value ? 'Стандартний персонаж' : 'Власний персонаж'))

function show(next: Avatar) {
  avatar.value = next
  portrait?.setAvatar(next)
  emit('preview', next)
  if (status.value !== 'saving') {
    status.value = 'idle'
  }
}

async function send(method: 'PUT' | 'DELETE') {
  status.value = 'saving'
  error.value = ''
  try {
    const response = await fetch(`${props.restUrl}/members/${props.userId}/avatar`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-WP-Nonce': props.nonce,
        ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'PUT' ? JSON.stringify({ avatar: avatarDiff(avatar.value) }) : undefined,
    })
    const data = (await response.json().catch(() => null)) as { avatar?: AvatarPatch | []; message?: string } | null
    if (!response.ok) {
      throw new Error(data?.message ?? `HTTP ${response.status}`)
    }
    const next = resolveAvatar(data?.avatar)
    saved.value = next
    show(next)
    status.value = 'saved'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не вдалося зберегти.'
    status.value = 'error'
  }
}

function revert() {
  show({ ...saved.value })
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
  }
}

onMounted(() => {
  if (stage.value) {
    portrait = new AvatarPortrait(stage.value, avatar.value)
  }
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  portrait?.dispose()
})
</script>

<template>
  <div class="dw-avatar-admin">
    <figure class="dw-avatar-admin__preview">
      <div ref="stage" class="dw-avatar-admin__stage"></div>
      <figcaption>{{ caption }}<template v-if="dirty"> · незбережені зміни</template></figcaption>
    </figure>
    <template v-if="canEdit">
      <AvatarEditor :avatar="avatar" embedded @change="show" />
      <div class="dw-avatar-admin__actions">
        <button type="button" class="button button-primary" :disabled="!dirty || status === 'saving'" @click="send('PUT')">
          {{ status === 'saving' ? 'Збереження…' : 'Зберегти' }}
        </button>
        <button type="button" class="button" :disabled="!dirty || status === 'saving'" @click="revert">Скасувати</button>
        <button type="button" class="button-link dw-avatar-admin__reset" :disabled="savedIsDefault || status === 'saving'" @click="send('DELETE')">
          Скинути до стандартного
        </button>
      </div>
      <p v-if="status === 'saved'" class="dw-avatar-admin__status is-saved" role="status">Збережено. Користувач побачить зміни після оновлення сторінки світу.</p>
      <p v-else-if="status === 'error'" class="dw-avatar-admin__status is-error" role="alert">{{ error }}</p>
    </template>
    <p v-else class="description">У вас немає прав змінювати цього користувача.</p>
  </div>
</template>
