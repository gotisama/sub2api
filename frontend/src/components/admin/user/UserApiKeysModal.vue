<template>
  <BaseDialog :show="show" :title="t('admin.users.userApiKeys')" width="wide" @close="handleClose">
    <div v-if="user" class="space-y-4">
      <div class="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-dark-700">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
          <span class="text-lg font-medium text-primary-700 dark:text-primary-300">{{ user.email.charAt(0).toUpperCase() }}</span>
        </div>
        <div><p class="font-medium text-gray-900 dark:text-white">{{ user.email }}</p><p class="text-sm text-gray-500 dark:text-dark-400">{{ user.username }}</p></div>
      </div>
      <div class="flex justify-end">
        <button class="btn btn-primary" data-testid="open-create-key" :disabled="creating" @click="showCreate = !showCreate">{{ t('userKeyIssuance.create') }}</button>
      </div>
      <form v-if="showCreate" class="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-dark-600" data-testid="create-key-form" @submit.prevent="createKey">
        <p class="text-sm text-gray-500">{{ t('userKeyIssuance.hint') }}</p>
        <label class="block"><span class="input-label">{{ t('userKeyIssuance.name') }}</span><input v-model="createForm.name" data-testid="key-name" class="input" required maxlength="100" :disabled="creating" /></label>
        <label class="block"><span class="input-label">{{ t('admin.users.group') }}</span>
          <select v-model="createForm.groupId" data-testid="key-group" class="input" required :disabled="creating">
            <option value="" disabled>{{ t('userKeyIssuance.selectGroup') }}</option>
            <option v-for="group in allGroups.filter(g => g.status === 'active')" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
        </label>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label><span class="input-label">{{ t('userKeyIssuance.quota') }}</span><input v-model.number="createForm.quota" data-testid="key-quota" class="input" type="number" min="0" step="0.01" :disabled="creating" /></label>
          <label><span class="input-label">{{ t('userKeyIssuance.dailyLimit') }}</span><input v-model.number="createForm.dailyLimit" class="input" type="number" min="0" step="0.01" :disabled="creating" /></label>
          <label><span class="input-label">{{ t('userKeyIssuance.expiry') }}</span><input v-model="createForm.days" class="input" type="number" min="1" max="36500" step="1" :disabled="creating" :placeholder="t('userKeyIssuance.noExpiry')" /></label>
        </div>
        <p class="text-xs text-gray-500">{{ t('userKeyIssuance.limitsHint') }}</p>
        <button type="submit" class="btn btn-primary" :disabled="creating || !createForm.name.trim() || !createForm.groupId">{{ t(creating ? 'userKeyIssuance.creating' : 'userKeyIssuance.create') }}</button>
      </form>
      <p v-if="creationError" role="alert" class="rounded-xl bg-red-50 p-3 text-red-700" data-testid="creation-error">{{ creationError }}</p>
      <div v-if="createdKey" ref="createdKeyPanel" role="status" aria-live="polite" class="space-y-2 rounded-xl bg-green-50 p-4 dark:bg-green-900/20" data-testid="created-key">
        <p class="text-sm">{{ t('userKeyIssuance.created') }}</p>
        <input :value="createdKey" readonly class="input font-mono" aria-label="API Key" />
        <button class="btn btn-primary" @click="copyKey(createdKey)">{{ t('userKeyIssuance.copy') }}</button>
      </div>
      <div v-if="loading" class="flex justify-center py-8"><svg class="h-8 w-8 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
      <div v-else-if="apiKeys.length === 0" class="py-8 text-center"><p class="text-sm text-gray-500">{{ t('admin.users.noApiKeys') }}</p></div>
      <div v-else ref="scrollContainerRef" class="max-h-96 space-y-3 overflow-y-auto" @scroll="closeGroupSelector">
        <div v-for="key in apiKeys" :key="key.id" class="rounded-xl border border-gray-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800">
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center gap-2"><span class="font-medium text-gray-900 dark:text-white">{{ key.name }}</span><span :class="['badge text-xs', key.status === 'active' ? 'badge-success' : 'badge-danger']">{{ key.status }}</span></div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <input :type="visibleKeyIds.has(key.id) ? 'text' : 'password'" :value="key.key" readonly class="input min-w-0 flex-1 font-mono" :aria-label="t('userKeyIssuance.name')" :data-testid="`stored-key-${key.id}`" @click="($event.target as HTMLInputElement).select()" />
                <button type="button" class="btn btn-secondary" :data-testid="`reveal-key-${key.id}`" :aria-pressed="visibleKeyIds.has(key.id)" @click="toggleKey(key.id)">{{ t(visibleKeyIds.has(key.id) ? 'userKeyIssuance.hide' : 'userKeyIssuance.show') }}</button>
                <button type="button" class="btn btn-primary" :data-testid="`copy-key-${key.id}`" @click="copyKey(key.key, key.id)">{{ t('userKeyIssuance.copy') }}</button>
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            <div class="flex items-center gap-1">
              <span>{{ t('admin.users.group') }}:</span>
              <button
                :ref="(el) => setGroupButtonRef(key.id, el)"
                @click="openGroupSelector(key)"
                class="-mx-1 -my-0.5 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-dark-700"
                :disabled="updatingKeyIds.has(key.id)"
              >
                <GroupBadge
                  v-if="key.group_id && key.group"
                  :name="key.group.name"
                  :platform="key.group.platform"
                  :subscription-type="key.group.subscription_type"
                  :rate-multiplier="key.group.rate_multiplier"
                  :peak-rate-enabled="key.group.peak_rate_enabled"
                  :peak-start="key.group.peak_start"
                  :peak-end="key.group.peak_end"
                  :peak-rate-multiplier="key.group.peak_rate_multiplier"
                />
                <span v-else class="text-gray-400 italic">{{ t('admin.users.none') }}</span>
                <svg v-if="updatingKeyIds.has(key.id)" class="h-3 w-3 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <svg v-else class="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
              </button>
            </div>
            <div class="flex items-center gap-1"><span>{{ t('admin.users.columns.created') }}: {{ formatDateTime(key.created_at) }}</span></div>
          </div>
        </div>
      </div>
    </div>
  </BaseDialog>

  <!-- Group Selector Dropdown -->
  <Teleport to="body">
    <div
      v-if="groupSelectorKeyId !== null && dropdownPosition"
      ref="dropdownRef"
      class="animate-in fade-in slide-in-from-top-2 fixed z-[100000020] w-64 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 duration-200 dark:bg-dark-800 dark:ring-white/10"
      :style="{ top: dropdownPosition.top + 'px', left: dropdownPosition.left + 'px' }"
    >
      <div class="max-h-64 overflow-y-auto p-1.5">
        <!-- Unbind option -->
        <button
          @click="changeGroup(selectedKeyForGroup!, null)"
          :class="[
            'flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors',
            !selectedKeyForGroup?.group_id
              ? 'bg-primary-50 dark:bg-primary-900/20'
              : 'hover:bg-gray-100 dark:hover:bg-dark-700'
          ]"
        >
          <span class="text-gray-500 italic">{{ t('admin.users.none') }}</span>
          <svg
            v-if="!selectedKeyForGroup?.group_id"
            class="ml-auto h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
            fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
          ><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
        </button>
        <!-- Group options -->
        <button
          v-for="group in allGroups"
          :key="group.id"
          @click="changeGroup(selectedKeyForGroup!, group.id)"
          :class="[
            'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
            selectedKeyForGroup?.group_id === group.id
              ? 'bg-primary-50 dark:bg-primary-900/20'
              : 'hover:bg-gray-100 dark:hover:bg-dark-700'
          ]"
        >
          <GroupOptionItem
            :name="group.name"
            :platform="group.platform"
            :subscription-type="group.subscription_type"
            :rate-multiplier="group.rate_multiplier"
            :peak-rate-enabled="group.peak_rate_enabled"
            :peak-start="group.peak_start"
            :peak-end="group.peak_end"
            :peak-rate-multiplier="group.peak_rate_multiplier"
            :description="group.description"
            :selected="selectedKeyForGroup?.group_id === group.id"
          />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { adminAPI } from '@/api/admin'
import { formatDateTime } from '@/utils/format'
import type { AdminUser, AdminGroup, ApiKey } from '@/types'
import BaseDialog from '@/components/common/BaseDialog.vue'
import GroupBadge from '@/components/common/GroupBadge.vue'
import GroupOptionItem from '@/components/common/GroupOptionItem.vue'

const props = defineProps<{ show: boolean; user: AdminUser | null }>()
const emit = defineEmits(['close'])
const { t } = useI18n()
const appStore = useAppStore()

const apiKeys = ref<ApiKey[]>([])
const allGroups = ref<AdminGroup[]>([])
const loading = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const createdKey = ref('')
const createdKeyPanel = ref<HTMLElement | null>(null)
const creationError = ref('')
const visibleKeyIds = ref(new Set<number>())
const createForm = reactive({ name: '', groupId: '' as number | string, quota: 0, dailyLimit: 0, days: '' })
let pendingCreation: { signature: string; key: string } | null = null
let requestVersion = 0
const updatingKeyIds = ref(new Set<number>())
const groupSelectorKeyId = ref<number | null>(null)
const dropdownPosition = ref<{ top: number; left: number } | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const scrollContainerRef = ref<HTMLElement | null>(null)
const groupButtonRefs = ref<Map<number, HTMLElement>>(new Map())

const selectedKeyForGroup = computed(() => {
  if (groupSelectorKeyId.value === null) return null
  return apiKeys.value.find((k) => k.id === groupSelectorKeyId.value) || null
})

const setGroupButtonRef = (keyId: number, el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLElement) {
    groupButtonRefs.value.set(keyId, el)
  } else {
    groupButtonRefs.value.delete(keyId)
  }
}

watch(() => [props.show, props.user?.id] as const, ([show], _, onCleanup) => {
  onCleanup(() => { requestVersion++ })
  closeGroupSelector()
  showCreate.value = false
  createdKey.value = ''
  visibleKeyIds.value.clear()
  creationError.value = ''
  pendingCreation = null
  Object.assign(createForm, { name: '', groupId: '', quota: 0, dailyLimit: 0, days: '' })
  if (show && props.user) {
    load()
    loadGroups()
  }
})

const load = async () => {
  if (!props.user) return
  const version = ++requestVersion
  apiKeys.value = []
  loading.value = true
  groupButtonRefs.value.clear()
  try {
    const res = await adminAPI.users.getUserApiKeys(props.user.id)
    if (version === requestVersion) apiKeys.value = res.items || []
  } catch (error) {
    if (version !== requestVersion) return
    console.error('Failed to load API keys:', error)
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

const loadGroups = async () => {
  try {
    const groups = await adminAPI.groups.getAll()
    allGroups.value = groups
  } catch (error) {
    console.error('Failed to load groups:', error)
  }
}

const createKey = async () => {
  if (!props.user || creating.value || !createForm.name.trim() || !createForm.groupId) return
  const userId = props.user.id
  const payload = {
    name: createForm.name.trim(), group_id: Number(createForm.groupId),
    quota: Number(createForm.quota), rate_limit_1d: Number(createForm.dailyLimit),
    ...(createForm.days ? { expires_in_days: Number(createForm.days) } : {})
  }
  const signature = JSON.stringify({ userId, payload })
  creating.value = true
  createdKey.value = ''
  creationError.value = ''
  try {
    if (pendingCreation?.signature !== signature) pendingCreation = { signature, key: crypto.randomUUID() }
    const key = await adminAPI.apiKeys.createUserApiKey(userId, payload, pendingCreation.key)
    if (!props.show || props.user?.id !== userId) return
    if (!key?.key) throw new Error(t('userKeyIssuance.missingKey'))
    createdKey.value = key.key
    showCreate.value = false
    pendingCreation = null
    appStore.showSuccess(t('userKeyIssuance.created'))
    await nextTick()
    createdKeyPanel.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    await load()
  } catch (error: any) {
    if (props.show && props.user?.id === userId) {
      creationError.value = error?.message || t('userKeyIssuance.failed')
      appStore.showError(creationError.value)
    }
  } finally {
    creating.value = false
  }
}

const toggleKey = (id: number) => {
  if (visibleKeyIds.value.has(id)) visibleKeyIds.value.delete(id)
  else visibleKeyIds.value.add(id)
}

const copyKey = async (value: string, id?: number) => {
  try {
    if (!value) throw new Error('Empty key')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(value)
    } catch {
      const previousFocus = document.activeElement as HTMLElement | null
      const field = document.createElement('textarea')
      field.value = value
      field.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
      ;(previousFocus?.parentElement || document.body).appendChild(field)
      try {
        field.focus()
        field.select()
        if (!document.execCommand('copy')) throw new Error('Copy rejected')
      } finally {
        field.remove()
        previousFocus?.focus()
      }
    }
    appStore.showSuccess(t('userKeyIssuance.copied'))
  } catch {
    if (id !== undefined) visibleKeyIds.value.add(id)
    appStore.showError(t('userKeyIssuance.copyFailed'))
  }
}

const DROPDOWN_HEIGHT = 272 // max-h-64 = 16rem = 256px + padding
const DROPDOWN_GAP = 4

const openGroupSelector = (key: ApiKey) => {
  if (groupSelectorKeyId.value === key.id) {
    closeGroupSelector()
  } else {
    const buttonEl = groupButtonRefs.value.get(key.id)
    if (buttonEl) {
      const rect = buttonEl.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const openUpward = spaceBelow < DROPDOWN_HEIGHT && rect.top > spaceBelow
      dropdownPosition.value = {
        top: openUpward ? rect.top - DROPDOWN_HEIGHT - DROPDOWN_GAP : rect.bottom + DROPDOWN_GAP,
        left: rect.left
      }
    }
    groupSelectorKeyId.value = key.id
  }
}

const closeGroupSelector = () => {
  groupSelectorKeyId.value = null
  dropdownPosition.value = null
}

const changeGroup = async (key: ApiKey, newGroupId: number | null) => {
  closeGroupSelector()
  if (key.group_id === newGroupId || (!key.group_id && newGroupId === null)) return

  updatingKeyIds.value.add(key.id)
  try {
    const result = await adminAPI.apiKeys.updateApiKeyGroup(key.id, newGroupId)
    // Update local data
    const idx = apiKeys.value.findIndex((k) => k.id === key.id)
    if (idx !== -1) {
      apiKeys.value[idx] = result.api_key
    }
    if (result.auto_granted_group_access && result.granted_group_name) {
      appStore.showSuccess(t('admin.users.groupChangedWithGrant', { group: result.granted_group_name }))
    } else {
      appStore.showSuccess(t('admin.users.groupChangedSuccess'))
    }
  } catch (error: any) {
    appStore.showError(error?.message || t('admin.users.groupChangeFailed'))
  } finally {
    updatingKeyIds.value.delete(key.id)
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && groupSelectorKeyId.value !== null) {
    event.stopPropagation()
    closeGroupSelector()
  }
}

const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (dropdownRef.value && !dropdownRef.value.contains(target)) {
    // Check if the click is on one of the group trigger buttons
    for (const el of groupButtonRefs.value.values()) {
      if (el.contains(target)) return
    }
    closeGroupSelector()
  }
}

const handleClose = () => {
  if (creating.value) return
  createdKey.value = ''
  visibleKeyIds.value.clear()
  closeGroupSelector()
  emit('close')
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeyDown, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown, true)
})
</script>
