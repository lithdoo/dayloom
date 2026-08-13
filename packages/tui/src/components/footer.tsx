import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() => {
    const page = props.vm.page.get();
    if (page.kind === 'hub') {
      return 'Enter 确认 · Up/Down 选择 · p 行动 · s 状态 · ? 帮助 · q 退出';
    }
    return props.vm.inputHint.get();
  });
  return <text value={text} color="gray" wrap="truncate-end" />;
}

