import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Header(props: { vm: ViewModel }) {
  const { vm } = props;
  const actions = computed(() => {
    const items = vm.headerActions.get();
    return items.length > 0 ? `Actions: ${items.join(' | ')}` : '';
  });

  return (
    <box border={true} padding={0}>
      <vstack>
        <text value={vm.headerPrimary} bold={true} color="cyan" />
        <text value={vm.headerSecondary} color="gray" />
        <text value={actions} color="gray" />
      </vstack>
    </box>
  );
}
