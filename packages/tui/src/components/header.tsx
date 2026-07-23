import type { ViewModel } from '../view-model.js';

export function Header(props: { vm: ViewModel }) {
  return (
    <vstack gap={0}>
      <text value={props.vm.headerPrimary} bold={true} color="cyan" wrap="truncate-end" />
      <text value={props.vm.headerSecondary} color="gray" wrap="truncate-end" />
    </vstack>
  );
}

