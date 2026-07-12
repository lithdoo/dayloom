import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function LoadingBar(props: { vm: ViewModel }) {
  const visible = computed(() => props.vm.loadingLabel.get() !== null);
  const label = computed(() => {
    const value = props.vm.loadingLabel.get();
    return value ? `◐ ${value}` : '';
  });

  return (
    <show when={visible}>
      <text value={label} color="yellow" bold={true} />
    </show>
  );
}
