/** @jest-environment jsdom */
import '@/providers';
import '@test/helpers/ObsidianSettingsDOM';

import { deserialize, serialize } from 'node:v8';

import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { getClaudeProviderSettings } from '@/providers/claude/settings';

it.each(['Enter', 'Escape'])('leaves composing %s to the custom model alias editor', async key => {
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  const settings = { providerConfigs: { claude: { modelAliases: {} } } };
  let saved = '';
  const coordinator = new SettingsCoordinator(settings, async draft => { saved = JSON.stringify(draft); });
  const plugin = {
    settings,
    getActiveEnvironmentVariables: () => 'ANTHROPIC_MODEL=custom-model',
    mutateSettings: coordinator.mutate.bind(coordinator),
    notifyProviderChatOptionsChanged: jest.fn(),
    storage: { getAdapter: () => ({}) },
  };
  const tab = new ClaudianSettingTab({} as any, {} as any, plugin as any);
  const container = document.body.appendChild(document.createElement('div'));
  try {
    tab['renderCustomContextLimits'](container, 'claude');
    const field = within(container).getByRole('textbox', { name: 'Alias for custom-model' }) as HTMLInputElement;
    expect((await axe(container)).violations).toEqual([]);
    field.focus();
    fireEvent.compositionStart(field);
    fireEvent.input(field, { target: { value: 'unfinished' }, isComposing: true });
    expect(fireEvent.keyDown(field, { key, isComposing: true })).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('unfinished');
    await coordinator.persistCurrent();
    expect(getClaudeProviderSettings(JSON.parse(saved)).modelAliases).toEqual({});
    fireEvent.compositionEnd(field);
    fireEvent.input(field, { target: { value: '完成' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(getClaudeProviderSettings(settings).modelAliases['custom-model']).toBe('完成'));
    expect(getClaudeProviderSettings(JSON.parse(saved)).modelAliases['custom-model']).toBe('完成');
  } finally { container.remove(); }
});

it('keeps the latest alias edit when it restores the committed value during a pending save', async () => {
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  const settings = { providerConfigs: { claude: { modelAliases: {} } } };
  let release!: () => void;
  let started!: () => void;
  const saving = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  const coordinator = new SettingsCoordinator(settings, async () => {
    if (++writes === 1) { started(); await gate; }
  });
  const notify = jest.fn();
  const plugin = {
    settings,
    getActiveEnvironmentVariables: () => 'ANTHROPIC_MODEL=custom-model',
    mutateSettings: coordinator.mutate.bind(coordinator),
    notifyProviderChatOptionsChanged: notify,
    storage: { getAdapter: () => ({}) },
  };
  const tab = new ClaudianSettingTab({} as any, {} as any, plugin as any);
  const container = document.body.appendChild(document.createElement('div'));
  tab['renderCustomContextLimits'](container, 'claude');
  const field = within(container).getByRole('textbox', { name: 'Alias for custom-model' }) as HTMLInputElement;
  expect((await axe(container)).violations).toEqual([]);
  field.value = 'First';
  fireEvent.blur(field);
  await saving;
  field.value = '';
  fireEvent.blur(field);
  release();
  await coordinator.persistCurrent();
  await waitFor(() => expect(getClaudeProviderSettings(settings).modelAliases).toEqual({}));
  expect(notify).toHaveBeenCalledTimes(2);
  container.remove();
});
