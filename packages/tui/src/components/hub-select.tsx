import { computed, createSignal } from 'bindtty';
import type { InteractionNodeFocusChangeEvent } from '@bindtty/interaction';
import type { TerminalKeyEvent } from '@bindtty/terminal';
import { elementTemplate } from '@bindtty/vnode';
import type { ViewModel } from '../view-model.js';
import type { TuiHubAction } from '../types.js';
import { HUB_SELECT_ID } from './constants.js';

export function HubSelect(props: { vm: ViewModel }) {
  const { vm } = props;
  const focused = createSignal(false);
  const title = computed(() => focused.get() ? '指令  Up/Down' : '指令');
  const titleColor = computed(() => focused.get() ? 'cyan' : 'gray');

  function onKey(event: TerminalKeyEvent): boolean {
    const page = vm.page.get();
    if (page.kind !== 'hub' || page.busy) return false;
    if (event.kind === 'key' && event.key === 'up') {
      vm.moveHubSelection(-1);
      return true;
    }
    if (event.kind === 'key' && event.key === 'down') {
      vm.moveHubSelection(1);
      return true;
    }
    if (event.kind === 'key' && event.key === 'enter') {
      vm.submitHubSelection();
      return true;
    }
    if (event.kind !== 'text') return false;
    const input = event.text.toLowerCase();
    const shortcut = vm.hubActions.get().find((action) => action.shortcut === input);
    if (shortcut) {
      vm.selectHubAction(shortcut.id);
      void vm.submitHubSelection(shortcut.id);
      return true;
    }
    return false;
  }

  return elementTemplate(
    'box',
    {
      id: HUB_SELECT_ID,
      focusable: true,
      focusStyle: 'none',
      onFocusChange: (event: InteractionNodeFocusChangeEvent) => focused.set(event.focused),
      onKey,
    },
    (
      <vstack gap={0}>
        <text value={title} color={titleColor} bold={focused} wrap="truncate-end" />
        <for each={vm.hubActions} key={(action) => (action as TuiHubAction).id}>
          {(item) => {
            const action = item as TuiHubAction;
            const selected = computed(() => vm.selectedHubActionId.get() === action.id);
            const marker = computed(() => selected.get() ? '> ' : '  ');
            const value = computed(() => `${marker.get()}${action.label}  ${action.summary}`);
            return <text value={value} bold={selected} wrap="truncate-end" />;
          }}
        </for>
      </vstack>
    ),
  );
}
