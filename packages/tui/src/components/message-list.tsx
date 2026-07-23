import { computed, createSignal } from 'bindtty';
import type { InteractionNodeFocusChangeEvent } from '@bindtty/interaction';
import { VScrollView } from '@bindtty/widgets';
import type { ViewModel } from '../view-model.js';
import type { TuiMessage } from '../message-history.js';
import { roleColor, roleLabel } from '../theme.js';
import { MESSAGE_SCROLL_ID } from './constants.js';

export function MessageList(props: { vm: ViewModel }) {
  const { vm } = props;
  const focused = createSignal(false);
  const title = computed(() => {
    const page = vm.page.get();
    if (page.kind === 'hub') {
      const base = page.mode === 'help' ? '帮助' : '状态';
      return focused.get() ? `${base}  ↑↓` : base;
    }
    return focused.get() ? '消息  ↑↓' : '消息';
  });
  const titleColor = computed(() => focused.get() ? 'cyan' : 'gray');
  const contentWidth = computed(() => Math.max(1, vm.viewportWidth.get() - 1));

  return (
    <box flexGrow={1} flexShrink={1}>
      <vstack gap={0}>
        <text value={title} color={titleColor} bold={focused} wrap="truncate-end" />
        <VScrollView
          id={MESSAGE_SCROLL_ID}
          focusStyle="none"
          onFocusChange={(event: InteractionNodeFocusChangeEvent) => focused.set(event.focused)}
          width={vm.viewportWidth}
          height={vm.listHeight}
          offset={vm.messageScrollOffset}
          onOffsetChange={(nextOffset: number) => vm.setMessageScrollOffset(nextOffset)}
          border={false}
          padding={0}
          stickToBottom={vm.stickToBottom}
          showScrollbar={true}
        >
          <box width={contentWidth}>
            <vstack gap={0}>
              <for
                each={vm.visibleMessages}
                key={(item, index) => {
                  const message = item as TuiMessage;
                  return `${message.id ?? index}:${message.role}:${message.text}`;
                }}
              >
                {(item) => {
                  const message = item as TuiMessage;
                  return (
                    <hstack gap={0}>
                      <text
                        value={`[${roleLabel(message.role)}] `}
                        color={roleColor(message.role)}
                        bold={true}
                        flexShrink={0}
                      />
                      <text
                        value={message.text}
                        color={roleColor(message.role)}
                        wrap="wrap"
                        flexGrow={1}
                        flexShrink={1}
                        minWidth={0}
                      />
                    </hstack>
                  );
                }}
              </for>
            </vstack>
          </box>
        </VScrollView>
      </vstack>
    </box>
  );
}
