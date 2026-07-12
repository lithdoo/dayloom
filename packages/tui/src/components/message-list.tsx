import { computed, createSignal } from 'bindtty';
import { VScrollView } from '@bindtty/widgets';
import type { TuiMessage, ViewModel } from '../view-model.js';
import { roleColor, roleLabel } from '../theme.js';

export function MessageList(props: { vm: ViewModel }) {
  const { vm } = props;
  const scrollOnArrow = computed(() => vm.inputMode.get() === 'hidden');
  const focused = createSignal(false);
  const title = computed(() =>
    focused.get()
      ? vm.t('tui.messages.titleFocused')
      : vm.t('tui.messages.title'),
  );
  const titleColor = computed(() => (focused.get() ? 'cyan' : 'gray'));

  return (
    <box flexGrow={1} flexShrink={1}>
      <vstack gap={0}>
        <text
          value={title}
          color={titleColor}
          bold={focused}
          wrap="truncate-end"
        />
        <VScrollView
          id="dayloom-message-scroll"
          focusStyle="none"
          onFocusChange={(event) => focused.set(event.focused)}
          width={vm.viewportWidth}
          height={vm.listHeight}
          border={false}
          padding={0}
          stickToBottom={vm.stickToBottom}
          scrollOnArrow={scrollOnArrow}
          showScrollbar={true}
        >
          <vstack gap={0}>
            <for
              each={vm.visibleMessages}
              key={(item, index) => (item as TuiMessage).id ?? index}
            >
              {(item) => {
                const message = item as TuiMessage;
                return (
                  <hstack gap={0}>
                    <text
                      value={`[${roleLabel(message.role)}] `}
                      color={roleColor(message.role)}
                      bold={true}
                    />
                    <text
                      value={message.text}
                      color={roleColor(message.role)}
                      wrap="wrap"
                    />
                  </hstack>
                );
              }}
            </for>
          </vstack>
        </VScrollView>
      </vstack>
    </box>
  );
}
