<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api'
import { authConfig, login, register } from '@/auth'
import { loadTurnstile } from '@/turnstile'

const props = withDefaults(defineProps<{ mode: 'login' | 'register'; autofocus?: boolean; titled?: boolean }>(), { titled: true })

const isRegister = computed(() => props.mode === 'register')
const id = (field: string) => `dw-${props.mode}-${field}`

const form = reactive({ name: '', email: '', password: '', remember: true, consent: false })
const errors = ref<Record<string, string>>({})
const general = ref('')
const adminLogin = ref(false)
const busy = ref(false)
const showPassword = ref(false)
const root = ref<HTMLFormElement | null>(null)

const captcha = ref<HTMLElement | null>(null)
const token = ref('')
const checking = ref(false)
let widget = ''
let tokenWaiters: Array<(value: string) => void> = []

function setToken(value: string) {
  token.value = value
  if (value) {
    tokenWaiters.forEach((resolve) => resolve(value))
    tokenWaiters = []
  }
}

function waitForToken(timeout = 10000) {
  if (token.value) {
    return Promise.resolve(token.value)
  }
  return new Promise<string>((resolve) => {
    tokenWaiters.push(resolve)
    window.setTimeout(() => resolve(token.value), timeout)
  })
}

const needsCaptcha = Boolean(authConfig.turnstileSiteKey)

onMounted(async () => {
  if (props.autofocus) {
    root.value?.querySelector('input')?.focus({ preventScroll: true })
  }
  if (!needsCaptcha || !captcha.value) {
    return
  }
  try {
    const turnstile = await loadTurnstile()
    if (!captcha.value) {
      return
    }
    widget = turnstile.render(captcha.value, {
      sitekey: authConfig.turnstileSiteKey,
      theme: 'light',
      language: 'uk',
      appearance: 'interaction-only',
      callback: (value: string) => setToken(value),
      'expired-callback': () => setToken(''),
      'error-callback': () => setToken(''),
    })
  } catch {
    general.value = 'Не вдалося завантажити захист від ботів. Оновіть сторінку.'
  }
})

onBeforeUnmount(() => {
  if (widget) {
    window.turnstile?.remove(widget)
  }
})

function resetCaptcha() {
  token.value = ''
  if (widget) {
    window.turnstile?.reset(widget)
  }
}

function validate() {
  const next: Record<string, string> = {}
  if (isRegister.value && !form.name.trim()) {
    next.name = 'Вкажіть імʼя.'
  }
  if (!form.email.trim()) {
    next.email = 'Вкажіть email.'
  }
  if (!form.password) {
    next.password = 'Вкажіть пароль.'
  } else if (isRegister.value && form.password.length < authConfig.minPassword) {
    next.password = `Пароль має містити щонайменше ${authConfig.minPassword} символів.`
  }
  if (isRegister.value && !form.consent) {
    next.consent = 'Потрібна згода з умовами.'
  }
  errors.value = next
  return !Object.keys(next).length
}

function focusInvalid() {
  void nextTick(() => root.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
}

async function submit() {
  general.value = ''
  adminLogin.value = false
  if (busy.value) {
    return
  }
  if (!validate()) {
    focusInvalid()
    return
  }
  busy.value = true
  try {
    if (needsCaptcha && !token.value) {
      checking.value = true
      const ready = await waitForToken()
      checking.value = false
      if (!ready) {
        general.value = 'Перевірка, що ви не робот, не завершилася. Спробуйте ще раз.'
        resetCaptcha()
        return
      }
    }
    const base = { email: form.email.trim(), password: form.password, remember: form.remember, turnstile: token.value }
    await (isRegister.value ? register({ ...base, name: form.name.trim(), consent: form.consent }) : login(base))
  } catch (error) {
    if (error instanceof ApiError) {
      errors.value = error.fields
      general.value = Object.keys(error.fields).length ? '' : error.message
      adminLogin.value = error.code === 'digital_world_use_admin_login'
      focusInvalid()
    } else {
      general.value = 'Немає звʼязку із сервером. Спробуйте ще раз.'
    }
    resetCaptcha()
  } finally {
    checking.value = false
    busy.value = false
  }
}
</script>

<template>
  <form ref="root" class="dw-auth" novalidate :aria-busy="busy" @submit.prevent="submit">
    <h2 v-if="titled" class="dw-auth__title">{{ isRegister ? 'Реєстрація' : 'Вхід' }}</h2>

    <div v-if="isRegister" class="dw-auth__field">
      <label :for="id('name')">Імʼя</label>
      <input
        :id="id('name')"
        v-model="form.name"
        type="text"
        autocomplete="name"
        maxlength="60"
        :aria-invalid="!!errors.name"
        :aria-describedby="errors.name ? id('name-error') : undefined"
      />
      <p v-if="errors.name" :id="id('name-error')" class="dw-auth__error">{{ errors.name }}</p>
    </div>

    <div class="dw-auth__field">
      <label :for="id('email')">Email</label>
      <input
        :id="id('email')"
        v-model="form.email"
        type="email"
        autocomplete="email"
        inputmode="email"
        maxlength="100"
        :aria-invalid="!!errors.email"
        :aria-describedby="errors.email ? id('email-error') : undefined"
      />
      <p v-if="errors.email" :id="id('email-error')" class="dw-auth__error">{{ errors.email }}</p>
    </div>

    <div class="dw-auth__field">
      <label :for="id('password')">Пароль</label>
      <div class="dw-auth__password">
        <input
          :id="id('password')"
          v-model="form.password"
          :type="showPassword ? 'text' : 'password'"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          maxlength="128"
          :aria-invalid="!!errors.password"
          :aria-describedby="errors.password ? id('password-error') : isRegister ? id('password-hint') : undefined"
        />
        <button
          type="button"
          class="dw-auth__reveal"
          :aria-pressed="showPassword"
          :aria-label="showPassword ? 'Сховати пароль' : 'Показати пароль'"
          @click="showPassword = !showPassword"
        >
          {{ showPassword ? 'Сховати' : 'Показати' }}
        </button>
      </div>
      <p v-if="errors.password" :id="id('password-error')" class="dw-auth__error">{{ errors.password }}</p>
      <p v-else-if="isRegister" :id="id('password-hint')" class="dw-auth__note">
        Щонайменше {{ authConfig.minPassword }} символів.
      </p>
    </div>

    <label v-if="isRegister" class="dw-auth__check">
      <input v-model="form.consent" type="checkbox" :aria-invalid="!!errors.consent" />
      <span>
        Погоджуюсь з
        <a v-if="authConfig.privacyUrl" :href="authConfig.privacyUrl" target="_blank" rel="noopener">умовами обробки даних</a>
        <template v-else>умовами обробки даних</template>
      </span>
    </label>
    <p v-if="errors.consent" class="dw-auth__error">{{ errors.consent }}</p>

    <label class="dw-auth__check">
      <input v-model="form.remember" type="checkbox" />
      <span>Запамʼятати мене</span>
    </label>

    <div v-if="needsCaptcha" ref="captcha" class="dw-auth__captcha" />

    <p v-if="general" class="dw-auth__error dw-auth__error--general" role="alert">
      {{ general }}
      <a v-if="adminLogin && authConfig.adminLoginUrl" :href="authConfig.adminLoginUrl">Перейти до входу</a>
    </p>

    <button type="submit" class="dw-auth__submit" :disabled="busy">
      {{ checking ? 'Перевіряємо…' : busy ? 'Зачекайте…' : isRegister ? 'Зареєструватися' : 'Увійти' }}
    </button>

    <a v-if="!isRegister && authConfig.lostPasswordUrl" class="dw-auth__link" :href="authConfig.lostPasswordUrl" target="_blank" rel="noopener">
      Забули пароль?
    </a>
  </form>
</template>
