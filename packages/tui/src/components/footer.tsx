import { computed } from 'bindtty';
import type { ViewModel } from '../view-model.js';

export function Footer(props: { vm: ViewModel }) {
  const text = computed(() => {
    const page = props.vm.page.get();
    if (page.kind === 'hub') {
      return hubFooterHint(props.vm.hubActions.get());
    }
    return props.vm.inputHint.get();
  });
  return <text value={text} color="gray" wrap="truncate-end" />;
}

export function hubFooterHint(actions: readonly { id: string }[]): string {
  const hints = ['Enter 确认', 'Up/Down 选择'];
  if (actions.some((action) => action.id === 'play')) hints.push('p 行动');
  hints.push('s 状态', '? 帮助', 'q 退出');
  return hints.join(' · ');
}

