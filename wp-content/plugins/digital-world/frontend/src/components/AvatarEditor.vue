<script setup lang="ts">
import { computed, ref } from 'vue'
import { AVATAR_OPTIONS, type Avatar, type AvatarKey } from '@/world/avatar'
import { currentUser } from '@/auth'

const props = defineProps<{ avatar: Avatar; compact?: boolean }>()
const emit = defineEmits<{ change: [Avatar] }>()

interface Section {
  key: AvatarKey
  title: string
  names?: Record<string, string>
}

interface Group {
  id: string
  title: string
  sections: Section[]
}

const GROUPS: Group[] = [
  {
    id: 'face',
    title: 'Обличчя',
    sections: [
      { key: 'skin', title: 'Шкіра' },
      { key: 'face', title: 'Обличчя', names: { calm: 'Спокійне', smile: 'Усмішка', freckles: 'Веснянки', beard: 'Борода' } },
    ],
  },
  {
    id: 'hair',
    title: 'Волосся',
    sections: [
      { key: 'hair', title: 'Волосся' },
      { key: 'hairStyle', title: 'Зачіска', names: { short: 'Коротка', long: 'Довга', bun: 'Гулька', buzz: 'Їжачок' } },
    ],
  },
  {
    id: 'clothes',
    title: 'Одяг',
    sections: [
      { key: 'jacket', title: 'Куртка' },
      { key: 'pants', title: 'Штани' },
      { key: 'pack', title: 'Рюкзак', names: { none: 'Без рюкзака' } },
    ],
  },
  {
    id: 'extras',
    title: 'Аксесуари',
    sections: [
      { key: 'hat', title: 'Убір', names: { none: 'Без', cap: 'Кепка', beanie: 'Шапка' } },
      { key: 'glasses', title: 'Окуляри', names: { none: 'Без', round: 'Круглі', shades: 'Темні' } },
    ],
  },
]

const activeGroup = ref(GROUPS[0].id)
const visibleGroups = computed(() => (props.compact ? GROUPS.filter((group) => group.id === activeGroup.value) : GROUPS))

const isColor = (value: string) => value.startsWith('#')

function choose(key: AvatarKey, value: string) {
  if (props.avatar[key] !== value) {
    emit('change', { ...props.avatar, [key]: value })
  }
}

function label(section: Section, value: string, index: number) {
  return section.names?.[value] ?? `${section.title}: відтінок ${index + 1}`
}
</script>

<template>
  <div class="dw-avatar-editor" :class="compact ? 'is-compact' : 'dw-bookpage'">
    <template v-if="!compact">
      <h2 class="dw-auth__title">Мій персонаж</h2>
      <p class="dw-auth__note">{{ currentUser?.name }}, оберіть, яким вас бачать у світі. Персонажа на сторінці можна крутити.</p>
    </template>
    <div v-else class="dw-avatar-editor__groups" role="tablist" aria-label="Частини персонажа">
      <button
        v-for="group in GROUPS"
        :key="group.id"
        type="button"
        role="tab"
        class="dw-avatar-editor__group"
        :class="{ 'is-active': activeGroup === group.id }"
        :aria-selected="activeGroup === group.id"
        @click="activeGroup = group.id"
      >
        {{ group.title }}
      </button>
    </div>
    <div class="dw-avatar-editor__sections">
      <template v-for="group in visibleGroups" :key="group.id">
        <div v-for="section in group.sections" :key="section.key" class="dw-avatar-editor__row">
          <span :id="`dw-avatar-${section.key}`" class="dw-avatar-editor__label">{{ section.title }}</span>
          <div class="dw-avatar-editor__options" role="radiogroup" :aria-labelledby="`dw-avatar-${section.key}`">
            <button
              v-for="(value, index) in AVATAR_OPTIONS[section.key]"
              :key="value"
              type="button"
              role="radio"
              :aria-checked="avatar[section.key] === value"
              :aria-label="label(section, value, index)"
              :title="label(section, value, index)"
              :class="[
                isColor(value) ? 'dw-avatar-editor__swatch' : 'dw-avatar-editor__chip',
                { 'is-active': avatar[section.key] === value },
              ]"
              :style="isColor(value) ? { '--dw-swatch': value } : undefined"
              @click="choose(section.key, value)"
            >
              <template v-if="!isColor(value)">{{ label(section, value, index) }}</template>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
