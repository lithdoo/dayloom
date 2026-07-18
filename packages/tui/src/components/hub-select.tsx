import { computed, createSignal } from 'bindtty';
import type { TerminalKeyEvent } from '@bindtty/terminal';
import type { InteractionNodeFocusChangeEvent } from '@bindtty/interaction';
import { elementTemplate } from '@bindtty/vnode';
import type { ViewModel } from '../view-model.js';
import { HUB_SELECT_ID } from './constants.js';

export function HubSelect(props: { vm: ViewModel }) {
  const { vm } = props;
  const focused = createSignal(false);
  const title = computed(() => focused.get() ? '指令  ↑↓' : '指令');
  const titleColor = computed(() => focused.get() ? 'cyan' : 'gray');
  const options = computed(() => vm.hubActions.get());

  function onKey(event: TerminalKeyEvent): boolean {
    const page = vm.page.get();
    if (page.kind !== 'hub' || page.busy) return false;
    if (event.name === 'up') {
      vm.moveHubSelection(-1);
      return true;
    }
    if (event.name === 'down') {
      vm.moveHubSelection(1);
      return true;
    }
    if (event.name === 'return' || event.name === 'enter') {
      vm.submitHubSelection();
      return true;
    }
    const input = (event.input ?? '').toLowerCase();
    const shortcut = vm.hubActions.get().find((action) => action.shortcut === input);
    if (shortcut) {
      vm.selectHubAction(shortcut.id);
      vm.submitHubSelection();
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
        <for each={options} key={(action) => (action as { id: string }).id}>
          {(action) => {
            const hubAction = action as ReturnType<typeof options.get>[number];
            const selected = computed(() => vm.hubSelectedActionId.get() === hubAction.id);
            const label = computed(() => `${selected.get() ? '> ' : '  '}${hubAction.label}  ${hubAction.summary}`);
            return <text value={label} bold={selected} wrap="truncate-end" />;
          }}
        </for>
      </vstack>
    ),
  );
}
