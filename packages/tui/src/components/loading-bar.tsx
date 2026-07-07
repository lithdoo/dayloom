import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function LoadingBar(props: { vm: ViewModel }) {
  const label = computed(() => {
    const value = props.vm.loadingLabel.get();
    return value ? `Working: ${value}` : '';
  });

  return (
    <box height={1} padding={0}>
      <text value={label} color="yellow" />
    </box>
  );
}
