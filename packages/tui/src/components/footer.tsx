import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';
import { footerHint } from '../theme.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() => {
    const page = props.vm.page.get();
    if (page.kind === 'hub') {
      if (page.busy) return props.vm.loadingLabel.get() ?? page.busy.label;
      return 'Enter 确认 · ↑↓ 选择 · q 退出';
    }
    return footerHint(props.vm.t, props.vm.loadingLabel.get(), props.vm.inputHint.get());
  });

  return <text value={text} color="gray" wrap="truncate-end" />;
}
