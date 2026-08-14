import { computed } from 'bindtty';
import type { TerminalKeyEvent } from '@bindtty/terminal';
import { Textarea } from '@bindtty/widgets';
import type { ViewModel } from '../view-model.js';
import { TEXTAREA_ID } from './constants.js';

export function TextInputArea(props: { vm: ViewModel }) {
  const { vm } = props;
  const visible = computed(() => vm.inputMode.get() === 'text');
  const disabled = computed(() => !vm.inputControlEnabled.get());

  function onHistoryKey(event: TerminalKeyEvent): boolean {
    if (event.kind !== 'key' || !event.modifiers.ctrl) return false;
    if (event.key === 'p') {
      vm.navigateInputHistory(-1);
      return true;
    }
    if (event.key === 'n') {
      vm.navigateInputHistory(1);
      return true;
    }
    return false;
  }

  return (
    <show when={visible}>
      <vstack gap={0}>
        <text value={vm.inputInstruction} wrap="truncate-end" color="gray" />
        <hstack gap={0}>
          <text value={vm.inputPrompt} />
          <box flexGrow={1} focusable={false} onKey={onHistoryKey}>
            <Textarea
              id={TEXTAREA_ID}
              value={vm.inputValue}
              disabled={disabled}
              minRows={1}
              maxRows={4}
              resetCursorToken={vm.inputResetToken}
              onChange={(value: string) => vm.inputValue.set(value)}
              onSubmit={() => vm.submitTextInput()}
              onViewportRowsChange={(rows: number) => vm.setInputViewportRows(rows)}
            />
          </box>
        </hstack>
      </vstack>
    </show>
  );
}
