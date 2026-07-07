import { computed, Textarea } from 'bindtty';
import type { TerminalKeyEvent } from '@bindtty/terminal';
import type { ViewModel } from '../view-model.js';

const TEXTAREA_ID = 'dayloom-textarea';

export function TextInputArea(props: { vm: ViewModel }) {
  const { vm } = props;
  const textVisible = computed(() => vm.inputMode.get() === 'text');
  const confirmVisible = computed(() => vm.inputMode.get() === 'confirm');
  const inputDisabled = computed(() => vm.loadingLabel.get() !== null);

  return (
    <box border={true} padding={0}>
      <vstack>
        <show when={textVisible}>
          <vstack>
            <text value={vm.inputInstruction} color="green" />
            <vstack>
              <text value={computed(() => `${vm.inputPrompt.get()} `)} bold={true} />
              <Textarea
                id={TEXTAREA_ID}
                value={vm.inputValue}
                disabled={inputDisabled}
                minRows={1}
                maxRows={4}
                resetCursorToken={vm.inputResetToken}
                onChange={(value: string) => vm.inputValue.set(value)}
                onSubmit={() => vm.submitTextInput()}
                onViewportRowsChange={(rows: number) => vm.setInputViewportRows(rows)}
              />
            </vstack>
          </vstack>
        </show>
        <show when={confirmVisible}>
          <ConfirmBox vm={vm} />
        </show>
      </vstack>
    </box>
  );
}

function ConfirmBox(props: { vm: ViewModel }) {
  const disabled = computed(() => props.vm.loadingLabel.get() !== null);

  function onKey(event: TerminalKeyEvent): boolean {
    if (disabled.get()) return false;
    const input = event.input.toLowerCase();
    if (input === 'y' || event.name === 'y') {
      props.vm.submitConfirm(true);
      return true;
    }
    if (input === 'n' || event.name === 'n') {
      props.vm.submitConfirm(false);
      return true;
    }
    if (event.name === 'return' || event.name === 'enter') {
      props.vm.submitConfirm(true);
      return true;
    }
    return false;
  }

  return (
    <box id="dayloom-confirm" border={true} padding={1} onKey={onKey}>
      <hstack>
        <text value={props.vm.confirmQuestion} color="yellow" />
        <text value=" [Y/n]" bold={true} />
      </hstack>
    </box>
  );
}
