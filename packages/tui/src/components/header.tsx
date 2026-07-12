import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Header(props: { vm: ViewModel }) {
  const { vm } = props;
  const actions = computed(() => {
    const items = vm.headerActions.get();
    return items.length > 0 ? `Next: ${items.join(' · ')}` : '';
  });

  return (
    <vstack gap={0}>
      <text value={vm.headerPrimary} bold={true} color="cyan" />
      <show when={computed(() => vm.headerSecondary.get() !== '')}>
        <text value={vm.headerSecondary} color="gray" />
      </show>
      <show when={computed(() => actions.get() !== '')}>
        <text value={actions} color="gray" />
      </show>
    </vstack>
  );
}
