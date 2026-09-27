// Browser-half entry for dsh-notion-oauth — runs inside the DSH web GUI.
// Registers the Notion page into the additive `settings.section` list slot.
import { createElement } from 'react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { NotionSettings } from './NotionSettings.tsx';

export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'notion', order: 30, label: 'Notion' },
      () => createElement(NotionSettings),
    ),
  );
}
