import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function LoadingBar(props: { vm: ViewModel }) {
  const label = computed(() => {
    const value = props.vm.loadingLabel.get();
    return value ? `◐ ${value}` : '';
  });
  const visible = computed(() => label.get() !== '');
  return (
    <show when={visible}>
      <text value={label} color="yellow" bold={true} wrap="truncate-end" />
    </show>
  );
}

