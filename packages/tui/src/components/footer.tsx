import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() => {
    const hint = props.vm.inputHint.get();
    const loading = props.vm.loadingLabel.get();
    if (loading) return 'Working... input disabled until the current step finishes.';
    return hint || 'Tab focus · Enter newline · Ctrl+Enter submit · y/n confirm · Ctrl+C quit';
  });

  return (
    <box border={true} padding={0}>
      <text value={text} color="gray" />
    </box>
  );
}
