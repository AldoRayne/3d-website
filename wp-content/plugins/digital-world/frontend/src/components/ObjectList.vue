<script setup lang="ts">
import { ref } from 'vue'
import type { WorldObject } from '@/types'
import { buildingKind } from '@/labels'
import { currentUser } from '@/auth'
import { STAND_COLOR, STAND_SLUG, STAND_TITLE } from '@/world/stand'

defineProps<{
  objects: WorldObject[]
  active: string | null
  staticMode: boolean
  visiting?: boolean
}>()

const emit = defineEmits<{
  select: [slug: string]
  overview: []
}>()

const open = ref(window.innerWidth > 900)

function choose(slug: string) {
  emit('select', slug)
  if (window.innerWidth <= 900) {
    open.value = false
  }
}
</script>

<template>
  <nav class="dw-list" :class="{ 'is-open': open || staticMode, 'is-static': staticMode }" aria-label="Розділи сайту">
    <button
      v-if="!staticMode"
      type="button"
      class="dw-list__toggle"
      :aria-expanded="open"
      aria-controls="dw-list-items"
      @click="open = !open"
    >
      <span>Розділи</span>
      <span class="dw-list__count">{{ objects.length }}</span>
    </button>

    <div v-show="open || staticMode" id="dw-list-items" class="dw-list__body">
      <ul class="dw-list__items">
        <li v-for="object in objects" :key="object.slug">
          <a
            v-if="staticMode && object.url"
            class="dw-list__item"
            :href="object.url"
            :style="{ '--dw-accent': object.color }"
          >
            <span class="dw-list__swatch" aria-hidden="true" />
            <span class="dw-list__text">
              <span class="dw-list__title">{{ object.title }}</span>
              <span class="dw-list__desc">{{ object.description }}</span>
            </span>
          </a>
          <button
            v-else
            type="button"
            class="dw-list__item"
            :class="{ 'is-active': active === object.slug }"
            :aria-current="active === object.slug ? 'location' : undefined"
            :style="{ '--dw-accent': object.color }"
            @click="choose(object.slug)"
          >
            <span class="dw-list__swatch" aria-hidden="true" />
            <span class="dw-list__text">
              <span class="dw-list__title">{{ object.title }}</span>
              <span class="dw-list__type">{{ buildingKind(object.seed) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <button
        v-if="!staticMode"
        type="button"
        class="dw-list__item dw-list__item--stand"
        :class="{ 'is-active': active === STAND_SLUG }"
        :aria-current="active === STAND_SLUG ? 'location' : undefined"
        :style="{ '--dw-accent': STAND_COLOR }"
        @click="choose(STAND_SLUG)"
      >
        <span class="dw-list__swatch" aria-hidden="true" />
        <span class="dw-list__text">
          <span class="dw-list__title">{{ STAND_TITLE }}</span>
          <span class="dw-list__type">{{ visiting ? 'Гостьовий перегляд' : currentUser ? `Ви увійшли як ${currentUser.name}` : 'Реєстрація та вхід' }}</span>
        </span>
      </button>
      <button v-if="!staticMode" type="button" class="dw-list__overview" @click="emit('overview')">
        Огляд усього світу
      </button>
    </div>
  </nav>
</template>
