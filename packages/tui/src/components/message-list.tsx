import { computed, createSignal } from 'bindtty';
import type { InteractionNodeFocusChangeEvent } from '@bindtty/interaction';
import { VScrollView } from '@bindtty/widgets';
import type { ViewModel } from '../view-model.js';
import type { TuiMessage, TuiPresentationItem, TuiWorkingItem } from '../types.js';
import { roleColor, roleLabel } from '../theme.js';
import { MESSAGE_SCROLL_ID } from './constants.js';

export function MessageList(props: { vm: ViewModel }) {
  const { vm } = props;
  const focused = createSignal(false);
  const title = computed(() => {
    const page = vm.page.get();
    if (page.kind === 'hub') {
      const base = page.mode === 'help' ? '帮助' : '状态';
      return focused.get() ? `${base}  Up/Down` : base;
    }
    return focused.get() ? '消息  Up/Down' : '消息';
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
                key={(item) => (item as TuiPresentationItem).id}
              >
                {(item) => {
                  const presentation = item as TuiPresentationItem;
                  if ('kind' in presentation && presentation.kind === 'working') return <WorkingPresentation item={presentation} />;
                  const message = presentation as TuiMessage;
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

function WorkingPresentation(props: { item: TuiWorkingItem }) {
  const { item } = props;
  const label = item.status === 'streaming'
    ? `WORKING · ${(item.phase ?? 'STARTING').toUpperCase()}`
    : item.status === 'completed' ? `WORK · TEMPORARY · ${item.pathStatus.toUpperCase()}` : `WORKING · ${item.status.toUpperCase()}`;
  const body = item.status === 'streaming'
    ? `${item.truncated ? '部分较早过程已折叠\n\n' : ''}临时过程 · 非最终内容 · 不进入存档${item.text ? `\n\n${item.text}` : ''}`
    : item.status === 'completed'
      ? `${item.workPath ?? '临时工作目录不可用'}\n仅在本次处理运行期间有效`
      : item.detail ?? '工作过程未完成';
  return (
    <vstack gap={0}>
      <text value={`[${label}]`} color={item.status === 'failed' ? 'red' : item.status === 'cancelled' ? 'yellow' : 'cyan'} bold={true} wrap="truncate-end" />
      <text value={body} color="gray" wrap="wrap" />
    </vstack>
  );
}
