import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Header(props: { vm: ViewModel }) {
  const { vm } = props;

  return (
    <vstack gap={0}>
      <text value={vm.headerPrimary} bold={true} color="cyan" wrap="truncate-end" />
      <show when={computed(() => vm.headerSecondary.get() !== '')}>
        <text value={vm.headerSecondary} color="gray" wrap="truncate-end" />
      </show>
    </vstack>
  );
}
