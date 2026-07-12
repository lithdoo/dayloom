import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';
import { footerHint } from '../theme.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() =>
    footerHint(props.vm.t, props.vm.loadingLabel.get(), props.vm.inputHint.get()),
  );

  return <text value={text} color="gray" wrap="truncate-end" />;
}
