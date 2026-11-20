<script setup lang="ts">
import { ref } from 'vue'
import { authConfig, currentUser, logout } from '@/auth'
import { STAND_TITLE } from '@/world/stand'
import AuthForm from '@/components/AuthForm.vue'

const props = defineProps<{ side: 'left' | 'right' | 'single'; autofocus: boolean }>()

const tab = ref<'login' | 'register'>('login')
const leaving = ref(false)
const logoutError = ref('')

async function signOut() {
  leaving.value = true
  logoutError.value = ''
  try {
    await logout()
  } catch {
    logoutError.value = 'Не вдалося вийти. Спробуйте ще раз.'
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div class="dw-bookpage">
    <template v-if="currentUser">
      <div v-if="props.side === 'left'" class="dw-bookpage__cover">
        <span class="dw-bookpage__rule" aria-hidden="true" />
        <h2 class="dw-auth__title">{{ STAND_TITLE }}</h2>
      </div>
      <div v-else class="dw-bookpage__welcome" role="status">
        <h2 class="dw-auth__title">Вітаємо, {{ currentUser.name }}!</h2>
        <p class="dw-auth__note">Ви увійшли до світу.</p>
        <a v-if="currentUser.canAdmin && authConfig.adminUrl" class="dw-auth__link dw-bookpage__admin" :href="authConfig.adminUrl">
          Перейти в адмінку →
        </a>
        <p v-if="logoutError" class="dw-auth__error" role="alert">{{ logoutError }}</p>
        <button type="button" class="dw-auth__submit dw-auth__submit--quiet" :disabled="leaving" @click="signOut">
          {{ leaving ? 'Виходимо…' : 'Вийти' }}
        </button>
      </div>
    </template>

    <AuthForm v-else-if="props.side === 'left'" mode="login" :autofocus="autofocus" />

    <template v-else-if="props.side === 'right'">
      <AuthForm v-if="authConfig.registrationOpen" mode="register" />
      <div v-else class="dw-bookpage__welcome">
        <h2 class="dw-auth__title">Реєстрація</h2>
        <p class="dw-auth__note">Реєстрацію зараз закрито.</p>
      </div>
    </template>

    <template v-else>
      <div v-if="authConfig.registrationOpen" class="dw-bookpage__tabs" role="tablist" aria-label="Вхід або реєстрація">
        <button
          v-for="option in (['login', 'register'] as const)"
          :key="option"
          type="button"
          role="tab"
          class="dw-bookpage__tab"
          :class="{ 'is-active': tab === option }"
          :aria-selected="tab === option"
          @click="tab = option"
        >
          {{ option === 'login' ? 'Вхід' : 'Реєстрація' }}
        </button>
      </div>
      <Transition name="dw-bookpage-fade" mode="out-in">
        <AuthForm :key="tab" :mode="tab" :autofocus="autofocus" :titled="!authConfig.registrationOpen" />
      </Transition>
    </template>
  </div>
</template>
