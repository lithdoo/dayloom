import { computed } from 'bindtty';
import { ScrollView } from '@bindtty/widgets';
import type { TuiMessage, ViewModel } from '../view-model.js';
import { roleColor, roleLabel } from '../theme.js';

export function MessageList(props: { vm: ViewModel }) {
  const { vm } = props;
  const scrollOnArrow = computed(() => vm.inputMode.get() === 'hidden');

  return (
    <box flexGrow={1} flexShrink={1}>
      <ScrollView
        id="dayloom-message-scroll"
        width={vm.viewportWidth}
        height={vm.listHeight}
        border={false}
        padding={0}
        stickToBottom={vm.stickToBottom}
        scrollOnArrow={scrollOnArrow}
        showScrollbar={{ vertical: true, horizontal: false }}
      >
        <vstack gap={0}>
          <for each={vm.visibleMessages} key={(item, index) => (item as TuiMessage).id ?? index}>
            {(item) => {
              const message = item as TuiMessage;
              return (
                <hstack gap={0}>
                  <text
                    value={`[${roleLabel(message.role)}] `}
                    color={roleColor(message.role)}
                    bold={true}
                  />
                  <text value={message.text} color={roleColor(message.role)} wrap="wrap" />
                </hstack>
              );
            }}
          </for>
        </vstack>
      </ScrollView>
    </box>
  );
}
