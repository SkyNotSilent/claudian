/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import type { ProviderCapabilities } from '@/core/providers/types';
import { NavigationSidebar } from '@/features/chat/navigation/NavigationSidebar';
import { MessageActions } from '@/features/chat/rendering/MessageActions';

const css = readFileSync(path.resolve('src/style/components/nav-sidebar.css'), 'utf8');
const sidebars: NavigationSidebar[] = [];

afterEach(() => {
  for (const sidebar of sidebars.splice(0)) sidebar.destroy();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function mount(scrollable: boolean) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const parentEl = document.body.createDiv();
  const messagesEl = parentEl.createDiv();
  for (const title of ['First question', 'Second question']) {
    messagesEl.createDiv({ cls: 'claudian-message claudian-message-user', attr: { 'data-toc-title': title } });
  }
  Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: scrollable ? 2_000 : 400 });
  Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, value: 400 });
  messagesEl.scrollTo = jest.fn() as never;

  const sidebar = new NavigationSidebar(parentEl, messagesEl);
  sidebars.push(sidebar);
  return { parentEl, messagesEl, view: within(parentEl) };
}

it('offers history navigation as named native buttons and the directory as a disclosure', async () => {
  const { parentEl, messagesEl, view } = mount(true);

  for (const name of ['Scroll to top', 'Previous message', 'Conversation directory', 'Next message', 'Scroll to bottom']) {
    expect(view.getByRole('button', { name }).getAttribute('type')).toBe('button');
  }

  const directory = view.getByRole('button', { name: 'Conversation directory' });
  expect(directory.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(directory);
  expect(directory.getAttribute('aria-expanded')).toBe('true');

  const entry = view.getByRole('button', { name: '2. Second question' });
  expect(entry.getAttribute('type')).toBe('button');
  expect((await axe(parentEl)).violations).toEqual([]);

  fireEvent.click(entry);
  expect(messagesEl.scrollTo).toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '2. Second question' })).toBeNull();
  expect(directory.getAttribute('aria-expanded')).toBe('false');
});

it('keeps the navigation out of the accessibility tree and tab order while it is not shown', () => {
  const { view } = mount(false);

  expect(view.queryAllByRole('button')).toEqual([]);
  // The controls still exist, so the empty query reflects their hidden state.
  expect(view.getAllByRole('button', { hidden: true })).toHaveLength(5);
});

// Expected names are acceptance literals: the title keeps whole characters and
// the 80-unit cap (ellipsis included), never slicing a surrogate pair apart.
const EMOJI = '😀';
const directoryTitleCases = [
  [
    'truncates at a surrogate pair boundary without splitting the pair',
    `${'x'.repeat(76)}${EMOJI}tail`,
    `${'x'.repeat(76)}...`,
  ],
  [
    'keeps a surrogate pair that fits before the truncation boundary',
    `${'x'.repeat(75)}${EMOJI}tail`,
    `${'x'.repeat(75)}${EMOJI}...`,
  ],
  [
    'leaves an exact 80-unit title unchanged',
    `${'x'.repeat(78)}${EMOJI}`,
    `${'x'.repeat(78)}${EMOJI}`,
  ],
] as const;

function addUserPrompt(messagesEl: HTMLElement, rawText: string): HTMLElement {
  const msgEl = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
  msgEl.createDiv({ cls: 'claudian-message-content', text: rawText });
  return msgEl;
}

describe.each(directoryTitleCases)('directory title: %s', (_name, rawText, expectedTitle) => {
  it('shows the published title from real MessageActions metadata', () => {
    const { messagesEl, view } = mount(true);
    messagesEl.replaceChildren();
    const msgEl = addUserPrompt(messagesEl, rawText);
    const actions = new MessageActions(
      { settings: {} } as never, messagesEl, () => ({}) as ProviderCapabilities, {},
    );
    actions.applyTocTitle(msgEl, rawText);

    fireEvent.click(view.getByRole('button', { name: 'Conversation directory' }));
    expect(view.getByRole('button', { name: `1. ${expectedTitle}` }).textContent).toBe(`1. ${expectedTitle}`);
  });
});

it('falls back to visible message text without metadata through the same formatter', () => {
  const rawText = `${'x'.repeat(76)}${EMOJI}tail`;
  const { messagesEl, view } = mount(true);
  messagesEl.replaceChildren();
  addUserPrompt(messagesEl, rawText);

  fireEvent.click(view.getByRole('button', { name: 'Conversation directory' }));
  expect(view.getByRole('button', { name: `1. ${'x'.repeat(76)}...` }).textContent).toBe(`1. ${'x'.repeat(76)}...`);
});
