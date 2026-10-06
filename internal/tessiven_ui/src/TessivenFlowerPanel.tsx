import { Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import {
  ArrowRight,
  ArrowUp,
  Check,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import {
  createFlowerTurnLauncherPanelController,
  type FlowerTurnLauncherSubmitInput,
} from '../../flower_ui/src/FlowerTurnLauncherWindow';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';
import { tessivenFlowerIntent } from './flower';
import type { Selection, TessivenText, Version } from './types';

export type CanvasFlowerRequest = {
  selection: Selection;
  label: string;
  prompt?: string;
  nonce: number;
};
export type CanvasFlowerSend = (
  input: FlowerTurnLauncherSubmitInput,
  threadID?: string,
) => Promise<string>;

/** Canvas-owned presentation; the shared Flower controller owns send identity and recovery. */
export function TessivenFlowerPanel(props: {
  request: CanvasFlowerRequest;
  open: boolean;
  version?: Version;
  onCompareVersion?: (number: number) => void;
  t: TessivenText;
  onSend: CanvasFlowerSend;
  onOpenConversation: (threadID: string) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = createSignal(props.request);
  const [intent, setIntent] = createSignal(
    tessivenFlowerIntent(
      props.request.selection,
      props.t,
      props.request.prompt,
    ),
  );
  const [draft, setDraft] = createSignal(props.request.prompt ?? '');
  const [threadID, setThreadID] = createSignal<string>();
  const [accepted, setAccepted] = createSignal(false);
  const [submittedVersion, setSubmittedVersion] = createSignal<number>();
  const savedUpdate = () => {
    const current = props.version,
      base = submittedVersion();
    return current && base !== undefined && current.number > base
      ? current
      : undefined;
  };
  const [targetHeld, setTargetHeld] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;
  const controller = createFlowerTurnLauncherPanelController({
    open: true,
    get intent() {
      return intent();
    },
    autoFocus: false,
    get draft() {
      return draft();
    },
    onDraftChange: setDraft,
    get copy() {
      return { empty_message: props.t('flowerPlaceholder') };
    },
    onClose: props.onClose,
    onSubmit: async (input) => {
      const baseVersion = target().selection.version_id;
      const id = await props.onSend(input, threadID());
      setSubmittedVersion(baseVersion);
      setThreadID(id);
      setAccepted(true);
      setDraft('');
      setTarget(props.request);
      setTargetHeld(false);
      setIntent(tessivenFlowerIntent(props.request.selection, props.t));
    },
  });
  createEffect(() => {
    const request = props.request;
    untrack(() => {
      if (controller.sending() || controller.admissionUnknown()) {
        setTargetHeld(true);
        return;
      }
      setTarget(request);
      setTargetHeld(false);
      if (request.prompt !== undefined) setDraft(request.prompt);
      setIntent(tessivenFlowerIntent(request.selection, props.t));
    });
  });
  createEffect(() => {
    if (props.open) {
      const frame = requestAnimationFrame(() =>
        textarea?.focus({ preventScroll: true }),
      );
      onCleanup(() => cancelAnimationFrame(frame));
    }
  });
  return (
    <aside
      class="tessiven-flower-panel"
      aria-label={props.t('canvasFlower')}
      hidden={!props.open}
    >
      <header>
        <FlowerIcon />
        <strong>Flower</strong>
        <button
          class="tessiven-icon-button"
          onClick={props.onClose}
          aria-label={props.t('close')}
        >
          <X />
        </button>
      </header>
      <div class="tessiven-flower-scope">
        <span title={target().label}>{target().label}</span>
        <small>
          {props.t('version', { version: target().selection.version_id })}
        </small>
      </div>
      <label class="tessiven-flower-input" data-floe-input-surface>
        <textarea
          ref={(element) => {
            textarea = element;
            controller.setTextareaEl(element);
          }}
          aria-label={props.t('flowerPlaceholder')}
          placeholder={props.t('flowerPlaceholder')}
          value={controller.visiblePrompt()}
          disabled={controller.sending() || controller.admissionUnknown()}
          onInput={(event) => {
            controller.setUserPrompt(event.currentTarget.value);
            controller.setValidationError('');
            controller.setLaunchError('');
            setAccepted(false);
          }}
          onCompositionStart={() => controller.setIsComposing(true)}
          onCompositionEnd={() => {
            controller.setIsComposing(false);
            controller.setUserPrompt(textarea?.value ?? '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              props.onClose();
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.isComposing &&
              !controller.isComposing() &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void controller.submit();
            }
          }}
        />
        <div class="tessiven-flower-send-row">
          <span>{props.t('flowerEnter')}</span>
          <Button
            size="icon"
            icon={ArrowUp}
            aria-label={props.t(
              controller.admissionUnknown() ? 'flowerRetry' : 'flowerSend',
            )}
            title={props.t(
              controller.admissionUnknown() ? 'flowerRetry' : 'flowerSend',
            )}
            loading={controller.sending()}
            disabled={!controller.canSubmit()}
            onClick={() => void controller.submit()}
          />
        </div>
      </label>
      <Show when={controller.launchError() || controller.validationError()}>
        <p
          class="tessiven-flower-error"
          role={controller.admissionUnknown() ? 'status' : 'alert'}
        >
          <Show when={controller.admissionUnknown()}>
            {props.t('flowerUnknown')}{' '}
          </Show>
          {controller.launchError() || controller.validationError()}
        </p>
      </Show>
      <Show when={targetHeld()}>
        <p class="tessiven-flower-hint" role="status">
          {props.t('flowerTargetHeld')}
        </p>
      </Show>
      <Show when={threadID()}>
        <div class="tessiven-flower-receipt">
          <Show when={accepted() && !savedUpdate()}>
            <span role="status">
              <Check />
              {props.t('flowerAccepted')}
            </span>
          </Show>
          <Show when={savedUpdate()}>
            {(saved) => (
              <div class="tessiven-flower-update" role="status">
                <strong>
                  <Check />
                  <span>{props.t('canvasUpdated')}</span>
                  <small>
                    {props.t('version', { version: saved().number })}
                  </small>
                </strong>
                <p>{saved().summary}</p>
                <Show when={props.onCompareVersion}>
                  <button
                    onClick={() =>
                      props.onCompareVersion?.(submittedVersion()!)
                    }
                  >
                    {props.t('reviewChanges')}
                    <ArrowRight />
                  </button>
                </Show>
              </div>
            )}
          </Show>
          <button onClick={() => props.onOpenConversation(threadID()!)}>
            {props.t('flowerConversation')}
            <ArrowRight />
          </button>
        </div>
      </Show>
      <p class="tessiven-flower-hint">{props.t('flowerWorkflow')}</p>
    </aside>
  );
}
