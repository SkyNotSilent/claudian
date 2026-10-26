/** @jest-environment jsdom */
import '@/providers';
import '@test/helpers/ObsidianSettingsDOM';

import { deserialize, serialize } from 'node:v8';

import { beginExecution, createHarness, createSubmission, requestedScope } from '@test/helpers/ChatExecutionHarness';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';
import { testDate } from '@test/helpers/testClock';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { Notice } from 'obsidian';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { t } from '@/i18n/i18n';

jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({ renderEnvironmentSettingsSection() {} }));
jest.mock('obsidian', () => {
  const dom = jest.requireActual('@test/helpers/ObsidianSettingsDOM');
  class Setting extends dom.Setting {
    setHeading() { return this; }
    addToggle(callback: (control: unknown) => void) {
      const toggleEl = this.settingEl.createEl('input', { attr: { type: 'checkbox' } });
      const toggle = {
        toggleEl,
        setValue(value: boolean) { toggleEl.checked = value; return this; },
        onChange(change: (value: boolean) => void) { toggleEl.addEventListener('change', () => change(toggleEl.checked)); return this; },
      };
      callback(toggle); return this;
    }
  }
  return { ...jest.requireActual('@test/__mocks__/obsidian'), ...dom, Setting };
});

afterEach(() => { document.body.replaceChildren(); jest.clearAllMocks(); });

it('retries an unchanged user-name draft on the next blur after a rejected save', async () => {
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), userName: 'Before', enableAutoTitleGeneration: false };
  let saved = JSON.stringify(settings);
  const persist = jest.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockImplementation(async draft => {
    saved = JSON.stringify(draft);
  });
  const coordinator = new SettingsCoordinator(settings, persist);
  const runProviderExecutionTransition = jest.fn(async () => undefined);
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator), providerHost: { runProviderExecutionTransition } };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const container = document.body.createDiv();
  tab['renderGeneralTab'](container);
  const row = within(container).getByText(t('settings.userName.name')).parentElement!;
  const input = within(row).getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'After' } });
  fireEvent.blur(input);
  await waitFor(() => expect(Notice).toHaveBeenCalledWith('Failed to save settings'));
  expect(settings.userName).toBe('Before');
  expect(JSON.parse(saved).userName).toBe('Before');
  expect(input.value).toBe('After');
  expect(runProviderExecutionTransition).not.toHaveBeenCalled();

  fireEvent.focus(input);
  fireEvent.blur(input);

  await waitFor(() => expect(JSON.parse(saved).userName).toBe('After'));
  expect(settings.userName).toBe('After');
  expect(input.value).toBe('After');
  expect(persist).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(runProviderExecutionTransition).toHaveBeenCalledTimes(1));
  expect((await axe(row, { runOnly: ['aria-valid-attr', 'aria-valid-attr-value'] })).violations).toEqual([]);
});


it.each([
  { key: 'userName' as const, label: 'settings.userName.name' as const, next: 'After' },
  { key: 'systemPrompt' as const, label: 'settings.systemPrompt.name' as const, next: 'Updated instructions' },
  { key: 'mediaFolder' as const, label: 'settings.mediaFolder.name' as const, next: 'New Attachments' },
])('keeps a running reply when unchanged $key loses focus and restarts only after a real edit', async ({ key, label, next }) => {
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), userName: 'Before', systemPrompt: 'Initial instructions', mediaFolder: 'Attachments', enableAutoTitleGeneration: false };
  let saved = JSON.stringify(settings);
  const coordinator = new SettingsCoordinator(settings, async draft => { saved = JSON.stringify(draft); });
  const execution = createHarness();
  const transition = jest.spyOn(execution.registry, 'runTransition');
  const host = {
    settings, mutateSettings: coordinator.mutate.bind(coordinator),
    providerHost: { runProviderExecutionTransition: execution.registry.runTransition.bind(execution.registry) },
  };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const container = document.body.createDiv();
  tab['renderGeneralTab'](container);
  const row = within(container).getByText(t(label)).parentElement!;
  const input = within(row).getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox');
  const active = await beginExecution(execution, createSubmission({ timestamp: testDate().getTime() }));
  active.run.events.push({ type: 'turn_started', accepted: true, scope: requestedScope(active.session, active.run, 1) });
  await waitFor(() => expect(execution.repository.recordConversationActivity).toHaveBeenCalled());
  try {
    input.focus();
    input.blur();
    await tab['textEdits'].flush();
    // Join any actual registry transition admitted by the DOM handler; the spy delegates to the real registry.
    await Promise.all(transition.mock.results.map(result => result.value));
    expect(active.session.disposeCalls).toBe(0);
    expect(active.run.cancelCalls).toBe(0);
    expect(active.session.requests[0].signal.aborted).toBe(false);
    const original = input.value;
    fireEvent.input(input, { target: { value: next } });
    fireEvent.input(input, { target: { value: original } });
    fireEvent.blur(input);
    await tab['textEdits'].flush();
    await Promise.all(transition.mock.results.map(result => result.value));
    expect(active.session.disposeCalls).toBe(0);
    expect(active.run.cancelCalls).toBe(0);
    const tags = within(within(container).getByText(t('settings.excludedTags.name')).parentElement!).getByRole('textbox');
    fireEvent.input(tags, { target: { value: 'excluded' } });
    fireEvent.blur(tags);
    await tab['textEdits'].flush();
    expect(transition).not.toHaveBeenCalled();
    active.run.events.push({ type: 'turn_completed', reason: 'completed', scope: requestedScope(active.session, active.run, 2) });
    active.run.events.end();
    await expect(active.resultPromise).resolves.toMatchObject({ status: 'completed', accepted: true });
    expect(transition).not.toHaveBeenCalled();

    fireEvent.input(input, { target: { value: next } });
    fireEvent.blur(input);
    await tab['textEdits'].flush();
    await Promise.all(transition.mock.results.map(result => result.value));
    expect(settings[key]).toBe(next);
    expect(JSON.parse(saved)[key]).toBe(next);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(active.session.disposeCalls).toBe(1);

    input.focus();
    input.blur();
    await tab['textEdits'].flush();
    await Promise.all(transition.mock.results.map(result => result.value));
    expect(transition).toHaveBeenCalledTimes(1);
    expect(settings[key]).toBe(next);

    jest.useFakeTimers();
    fireEvent.input(input, { target: { value: `${next} timer` } });
    await jest.advanceTimersByTimeAsync(500);
    await tab['textEdits'].flush();
    expect(settings[key]).toBe(`${next} timer`);
    expect(transition).toHaveBeenCalledTimes(2);
    fireEvent.blur(input);
    await tab['textEdits'].flush();
    expect(transition).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
    await tab['textEdits'].flush();
    await execution.coordinator.dispose();
    await execution.registry.dispose();
  }
});


it('does not restart or replay a prompt edit after publication of its durable commit fails', async () => {
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), userName: 'Before', enableAutoTitleGeneration: false };
  let saved = '';
  const persist = jest.fn(async (draft: typeof settings) => { saved = JSON.stringify(draft); });
  const coordinator = new SettingsCoordinator(settings, persist, () => { throw new Error('View unavailable'); });
  const execution = createHarness();
  const transition = jest.spyOn(execution.registry, 'runTransition');
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator), providerHost: { runProviderExecutionTransition: execution.registry.runTransition.bind(execution.registry) } };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const container = document.body.createDiv();
  tab['renderGeneralTab'](container);
  const input = within(within(container).getByText(t('settings.userName.name')).parentElement!).getByRole('textbox');
  try {
    fireEvent.input(input, { target: { value: 'After' } });
    fireEvent.blur(input);
    await waitFor(() => expect(Notice).toHaveBeenCalledWith('Failed to save settings'));
    expect(await tab['textEdits'].flush()).toBe(false);
    expect(settings.userName).toBe('After');
    expect(JSON.parse(saved).userName).toBe('After');
    expect(transition).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(await tab['textEdits'].flush()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(transition).not.toHaveBeenCalled();
  } finally { await execution.coordinator.dispose(); await execution.registry.dispose(); }
});
