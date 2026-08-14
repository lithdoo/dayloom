import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() => {
    const page = props.vm.page.get();
    if (page.kind === 'hub') {
      if (page.busy) return props.vm.loadingLabel.get() ?? page.busy.label;
      return 'Enter 确认 · Up/Down 选择 · s 状态 · ? 帮助 · q 退出';
    }
    return props.vm.inputHint.get();
  });
  return <text value={text} color="gray" wrap="truncate-end" />;
}

