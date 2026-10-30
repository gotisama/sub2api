import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserApiKeysModal from '../UserApiKeysModal.vue'
import type { AdminUser } from '@/types'

const { getKeys, createKey, getGroups, showSuccess } = vi.hoisted(() => ({ getKeys: vi.fn(), createKey: vi.fn(), getGroups: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  users: { getUserApiKeys: getKeys }, groups: { getAll: getGroups },
  apiKeys: { createUserApiKey: createKey },
} }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: vi.fn(), showSuccess }) }))
vi.mock('@/utils/format', () => ({ formatDateTime: (value: string) => value }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
enableAutoUnmount(afterEach)
beforeEach(() => { getKeys.mockReset(); createKey.mockReset(); getGroups.mockResolvedValue([{ id: 7, name: 'Official GPT', status: 'active' }]); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const user = (id: number) => ({ id, email: `user${id}@example.com`, username: `user${id}` }) as AdminUser
const keys = (id: number, name: string) => ({ items: [{ id, name, key: 'sk-example-key-value-for-tests', status: 'active', created_at: '2026-09-20', group_id: null }] })
async function open() {
  const wrapper = mount(UserApiKeysModal, {
    props: { show: false, user: user(1) },
    global: { stubs: {
      BaseDialog: { props: ['show'], template: '<div v-if="show"><slot /></div>' },
      GroupBadge: true, GroupOptionItem: true,
    } },
  })
  await wrapper.setProps({ show: true })
  return wrapper
}
async function switchUser(wrapper: Awaited<ReturnType<typeof open>>) {
  await wrapper.setProps({ show: false })
  await wrapper.setProps({ show: true, user: user(2) })
}

describe('user API key loading', () => {
  it('reveals and copies an existing key after reopening, then resets visibility', async () => {
    getKeys.mockResolvedValue(keys(1, 'existing-key'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = await open(); await flushPromises()
    expect(wrapper.get('[data-testid="stored-key-1"]').attributes('type')).toBe('password')
    await wrapper.get('[data-testid="reveal-key-1"]').trigger('click')
    expect(wrapper.get('[data-testid="stored-key-1"]').attributes('type')).toBe('text')
    await wrapper.get('[data-testid="copy-key-1"]').trigger('click'); await flushPromises()
    expect(writeText).toHaveBeenCalledWith('sk-example-key-value-for-tests')
    await wrapper.setProps({ show: false }); await wrapper.setProps({ show: true }); await flushPromises()
    expect(wrapper.get('[data-testid="stored-key-1"]').attributes('type')).toBe('password')
  })

  it('falls back when clipboard permission is denied and reveals for manual copy if both fail', async () => {
    getKeys.mockResolvedValue(keys(1, 'existing-key'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const fallback = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback })
    const wrapper = await open(); await flushPromises()
    await wrapper.get('[data-testid="copy-key-1"]').trigger('click'); await flushPromises()
    expect(fallback).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
    await wrapper.get('[data-testid="copy-key-1"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="stored-key-1"]').attributes('type')).toBe('text')
    expect(wrapper.get('[data-testid="stored-key-1"]').element).toHaveProperty('value', 'sk-example-key-value-for-tests')
  })

  async function fillCreate(wrapper: Awaited<ReturnType<typeof open>>) {
    await wrapper.get('[data-testid="open-create-key"]').trigger('click')
    await wrapper.get('[data-testid="key-name"]').setValue('Team client')
    await wrapper.get('[data-testid="key-group"]').setValue('7')
    await wrapper.get('[data-testid="key-quota"]').setValue('12')
  }

  it('creates a key for the selected user with limits and prevents double submission', async () => {
    getKeys.mockResolvedValue({ items: [] })
    const pending = deferred(); createKey.mockReturnValue(pending.promise)
    const wrapper = await open(); await flushPromises(); await fillCreate(wrapper)
    await wrapper.get('form').trigger('submit'); await wrapper.get('form').trigger('submit')
    expect(createKey).toHaveBeenCalledTimes(1)
    expect(createKey).toHaveBeenCalledWith(1, { name: 'Team client', group_id: 7, quota: 12, rate_limit_1d: 0 }, expect.any(String))
    pending.resolve({ key: 'sk-issued-to-user-one' }); await flushPromises()
    expect(showSuccess).toHaveBeenCalledWith('userKeyIssuance.created')
    expect(wrapper.get('[data-testid="created-key"] input').element).toHaveProperty('value', 'sk-issued-to-user-one')
    await switchUser(wrapper); await flushPromises()
    expect(wrapper.find('[data-testid="created-key"]').exists()).toBe(false)
  })

  it('reuses the idempotency key after an uncertain failure', async () => {
    getKeys.mockResolvedValue({ items: [] }); createKey.mockRejectedValue(new Error('timeout'))
    const wrapper = await open(); await flushPromises(); await fillCreate(wrapper)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(createKey).toHaveBeenCalledTimes(2)
    expect(createKey.mock.calls[0][2]).toBe(createKey.mock.calls[1][2])
  })

  it('shows a persistent error instead of silently hiding a missing creation result', async () => {
    getKeys.mockResolvedValue({ items: [] }); createKey.mockResolvedValue({ id: 1 })
    const wrapper = await open(); await flushPromises(); await fillCreate(wrapper)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[data-testid="creation-error"]').text()).toBe('userKeyIssuance.missingKey')
    expect(wrapper.find('[data-testid="created-key"]').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('does not reveal a late issued key after switching users', async () => {
    getKeys.mockResolvedValue({ items: [] }); const pending = deferred(); createKey.mockReturnValue(pending.promise)
    const wrapper = await open(); await flushPromises(); await fillCreate(wrapper)
    await wrapper.get('form').trigger('submit'); await switchUser(wrapper)
    pending.resolve({ key: 'sk-previous-user-secret' }); await flushPromises()
    expect(wrapper.find('[data-testid="created-key"]').exists()).toBe(false)
  })
  it('does not display the previous user keys when the next load fails', async () => {
    getKeys.mockResolvedValueOnce(keys(1, 'first-user-key')).mockRejectedValueOnce(new Error('unavailable'))
    const wrapper = await open(); await flushPromises()
    expect(wrapper.text()).toContain('first-user-key')
    await switchUser(wrapper); await flushPromises()
    expect(wrapper.text()).toContain('user2@example.com')
    expect(wrapper.text()).not.toContain('first-user-key')
  })

  it('does not replace current keys with a late previous response', async () => {
    const old = deferred()
    getKeys.mockReturnValueOnce(old.promise).mockResolvedValueOnce(keys(2, 'current-user-key'))
    const wrapper = await open()
    await switchUser(wrapper); await flushPromises()
    old.resolve(keys(1, 'old-user-key')); await flushPromises()
    expect(wrapper.text()).toContain('current-user-key')
    expect(wrapper.text()).not.toContain('old-user-key')
  })

  it('keeps the current request loading when an obsolete request fails', async () => {
    const old = deferred(); const current = deferred()
    getKeys.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = await open()
    await switchUser(wrapper)
    old.reject(new Error('obsolete')); await flushPromises()
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
    current.resolve(keys(2, 'current-user-key')); await flushPromises()
    expect(wrapper.text()).toContain('current-user-key')
    expect(wrapper.find('.animate-spin').exists()).toBe(false)
  })

  it('loads keys when the selected user changes while the dialog is open', async () => {
    getKeys.mockResolvedValueOnce(keys(1, 'first-user-key')).mockResolvedValueOnce(keys(2, 'second-user-key'))
    const wrapper = await open(); await flushPromises()
    await wrapper.setProps({ user: user(2) }); await flushPromises()
    expect(getKeys).toHaveBeenLastCalledWith(2)
    expect(wrapper.text()).toContain('second-user-key')
    expect(wrapper.text()).not.toContain('first-user-key')
  })
})
