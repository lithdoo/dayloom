import { computed } from 'bindtty';
import { Textarea } from '@bindtty/widgets';
import type { TerminalKeyEvent } from '@bindtty/terminal';
import type { ViewModel } from '../view-model.js';
import { TEXTAREA_ID } from './constants.js';
import { multilineInputHint } from '../theme.js';

export function TextInputArea(props: { vm: ViewModel }) {
  const { vm } = props;
  const showText = computed(() => vm.inputMode.get() === 'text');
  const showConfirm = computed(() => vm.inputMode.get() === 'confirm');
  const disabled = computed(() => vm.loadingLabel.get() !== null);
  const multilineHint = computed(() => multilineInputHint(vm.t));

  return (
    <vstack gap={0}>
      <show when={showText}>
        <text value={vm.inputInstruction} wrap="truncate-end" color="gray" />
        <text value={multilineHint} wrap="truncate-end" color="gray" />
        <hstack gap={0}>
          <text value={vm.inputPrompt} />
          <box flexGrow={1}>
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
      </show>
      <show when={showConfirm}>
        <ConfirmBox vm={vm} />
      </show>
    </vstack>
  );
}

function ConfirmBox(props: { vm: ViewModel }) {
  const disabled = computed(() => props.vm.loadingLabel.get() !== null);

  function onKey(event: TerminalKeyEvent): boolean {
    return handleConfirmKey(event, props.vm, disabled);
  }

  return (
    <box id="dayloom-confirm" onKey={onKey}>
      <vstack gap={0}>
        <text value={props.vm.confirmQuestion} wrap="wrap" />
        <text value={props.vm.t('tui.input.confirmHint')} color="gray" />
      </vstack>
    </box>
  );
}

function handleConfirmKey(
  event: TerminalKeyEvent,
  vm: ViewModel,
  disabled: ReturnType<typeof computed<boolean>>,
): boolean {
  if (disabled.get()) return false;
  const input = event.input.toLowerCase();
  if (input === 'y' || event.name === 'y') {
    vm.submitConfirm(true);
    return true;
  }
  if (input === 'n' || event.name === 'n') {
    vm.submitConfirm(false);
    return true;
  }
  if (event.name === 'return' || event.name === 'enter') {
    vm.submitConfirm(true);
    return true;
  }
  return false;
}
