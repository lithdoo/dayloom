import { computed } from 'bindtty';
import { List } from '@bindtty/widgets';
import type { TuiMessage, ViewModel } from '../view-model.js';
import { roleColor, roleLabel } from '../theme.js';

export function MessageList(props: { vm: ViewModel }) {
  const { vm } = props;
  const items = computed(() => {
    const all = vm.visibleMessages.get();
    const height = vm.listHeight.get();
    const limit = Math.max(1, height * 2);
    return vm.stickToBottom.get() ? all.slice(-limit) : all;
  });

  return (
    <box border={true} padding={0}>
      <List
        id="dayloom-message-list"
        items={items}
        height={vm.listHeight}
        scrollOnArrow={computed(() => props.vm.inputMode.get() === 'hidden')}
        getKey={(item: TuiMessage) => item.id}
        render={(item: TuiMessage) => (
          <hstack>
            <text value={`[${roleLabel(item.role)}] `} color={roleColor(item.role)} bold={true} />
            <text value={item.text} color={roleColor(item.role)} wrap="wrap" />
          </hstack>
        )}
      />
    </box>
  );
}
