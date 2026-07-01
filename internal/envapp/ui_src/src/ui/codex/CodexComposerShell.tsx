import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { MoreHorizontal, Send } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import {
  findComposerMentionToken,
  findComposerSlashCommandToken,
  replaceComposerTextRange,
} from './composerController';
import {
  filterCodexSlashCommands,
  localizedCodexSlashCommandDescription,
  type CodexSlashCommandSpec,
} from './composerCommands';
import {
  findCodexComposerControlSpec,
  type CodexComposerControlID,
  type CodexComposerControlOption,
  type CodexComposerControlSpec,
} from './composerControls';
import {
  createCodexComposerFileIndex,
  type CodexFileSearchEntry,
} from './composerFileIndex';
import { createCodexComposerAutosizeController } from './createCodexComposerAutosizeController';
import { compactPathLabel } from './presentation';
import type {
  CodexComposerAttachmentDraft,
  CodexComposerMentionDraft,
} from './types';

type ComposerPopupKind =
  | 'none'
  | 'file-mentions'
  | 'slash-commands'
  | 'slash-parameter-options';

type ComposerSlashParameterSession = Readonly<{
  commandID: CodexSlashCommandSpec['id'];
  controlID: CodexComposerControlID;
}>;

type ComposerSelectVariant = 'value' | 'policy';
type ComposerSelectLabelMode = 'always' | 'auto';
type ComposerControlLocation = 'inline' | 'overflow';
type ComposerMeasureControlID = 'attachment' | 'working_dir' | CodexComposerControlID;
type ComposerOverflowControlID = Exclude<ComposerMeasureControlID, 'attachment'>;
type ComposerControlLayout = Readonly<{
  availableWidth: number;
  moreWidth: number;
  itemWidths: Partial<Record<ComposerMeasureControlID, number>>;
}>;

const CODEX_COMPOSER_CONTROL_GAP_PX = 8;
const CODEX_COMPOSER_MORE_WIDTH_FALLBACK_PX = 32;
const CODEX_COMPOSER_MEASURE_CONTROL_ORDER: readonly ComposerMeasureControlID[] = [
  'attachment',
  'working_dir',
  'model',
  'effort',
  'approval',
  'sandbox',
];
const CODEX_COMPOSER_MORE_CONTROL_ORDER: readonly ComposerOverflowControlID[] = [
  'working_dir',
  'model',
  'effort',
  'approval',
  'sandbox',
];

function ComposerSelectChip(props: {
  label: string;
  value: string;
  options: readonly CodexComposerControlOption[];
  placeholder: string;
  disabled: boolean;
  variant: ComposerSelectVariant;
  labelMode?: ComposerSelectLabelMode;
  onChange: (value: string) => void;
}) {
  const hasValue = () => String(props.value ?? '').trim().length > 0;
  const showLabel = () => (props.labelMode ?? 'auto') === 'always' || !hasValue();
  return (
    <div
      data-codex-select-variant={props.variant}
      data-codex-select-collapsed={showLabel() ? 'false' : 'true'}
      class={cn(
        'codex-chat-select-chip',
        props.variant === 'value'
          ? 'codex-chat-select-chip-value'
          : 'codex-chat-select-chip-policy',
        !showLabel() && 'codex-chat-select-chip-value-only',
        props.disabled && 'codex-chat-select-chip-disabled',
      )}
    >
      <Show when={showLabel()}>
        <span class="codex-chat-select-chip-label">{props.label}</span>
      </Show>
      <Select
        value={props.value}
        onChange={(value) => props.onChange(String(value ?? ''))}
        options={[...props.options]}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-label={props.label}
        class={cn(
          'codex-chat-select-chip-control',
          props.variant === 'value'
            ? 'codex-chat-select-chip-control-value'
            : 'codex-chat-select-chip-control-policy',
        )}
      />
    </div>
  );
}

function AttachmentCard(props: {
  attachment: CodexComposerAttachmentDraft;
  onRemove: (attachmentID: string) => void;
}) {
  const i18n = useI18n();
  return (
    <div class="codex-chat-attachment-card">
      <img
        class="codex-chat-attachment-thumb"
        src={props.attachment.preview_url}
        alt={props.attachment.name}
        loading="lazy"
        decoding="async"
      />
      <div class="codex-chat-attachment-copy">
        <div class="codex-chat-attachment-name" title={props.attachment.name}>
          {props.attachment.name}
        </div>
      </div>
      <button
        type="button"
        class="codex-chat-attachment-remove"
        onClick={() => props.onRemove(props.attachment.id)}
        aria-label={i18n.t('codex.composer.removeAttachment', { name: props.attachment.name })}
        title={i18n.t('codex.composer.removeAttachment', { name: props.attachment.name })}
      >
        ×
      </button>
    </div>
  );
}

function MentionChip(props: {
  mention: CodexComposerMentionDraft;
  onRemove: (mentionID: string) => void;
}) {
  const i18n = useI18n();
  return (
    <div class="codex-chat-mention-chip">
      <span class="codex-chat-mention-chip-kicker">@</span>
      <span class="codex-chat-mention-chip-copy" title={props.mention.path}>
        <span class="codex-chat-mention-chip-name">{props.mention.name}</span>
        <span class="codex-chat-mention-chip-path">{compactPathLabel(props.mention.path, props.mention.path)}</span>
      </span>
      <button
        type="button"
        class="codex-chat-mention-chip-remove"
        onClick={() => props.onRemove(props.mention.id)}
        aria-label={i18n.t('codex.composer.removeMention', { name: props.mention.name })}
        title={i18n.t('codex.composer.removeMention', { name: props.mention.name })}
      >
        ×
      </button>
    </div>
  );
}

export function CodexComposerShell(props: {
  workingDirPath: string;
  workingDirLabel: string;
  workingDirTitle: string;
  workingDirLocked: boolean;
  workingDirDisabled: boolean;
  runtimeControls: readonly CodexComposerControlSpec[];
  attachments: readonly CodexComposerAttachmentDraft[];
  mentions: readonly CodexComposerMentionDraft[];
  supportsImages: boolean;
  capabilitiesLoading: boolean;
  composerText: string;
  submitting: boolean;
  primaryActionKind: 'send' | 'queue' | 'stop';
  primaryActionDisabled: boolean;
  primaryActionDisabledReason: string;
  guidanceNote: string;
  hostAvailable: boolean;
  hostDisabledReason: string;
  onOpenWorkingDirPicker: () => void;
  onAddAttachments: (files: readonly File[]) => Promise<void>;
  onRemoveAttachment: (attachmentID: string) => void;
  onAddFileMentions: (mentions: ReadonlyArray<{
    name: string;
    path: string;
    is_image: boolean;
  }>) => void;
  onRemoveMention: (mentionID: string) => void;
  onComposerInput: (value: string) => void;
  onResetComposer: () => void;
  onStartNewThreadDraft: () => void;
  onSend: () => void;
  onQueue: () => void;
  onStop: () => void;
}) {
  const i18n = useI18n();
  const rpc = useRedevenRpc();
  const fileIndex = createCodexComposerFileIndex({
    listDirectory: async (path) => {
      const response = await rpc.fs.list({ path, showHidden: true });
      return response?.entries ?? [];
    },
  });
  const [isComposing, setIsComposing] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [selectionStart, setSelectionStart] = createSignal(0);
  const [selectionEnd, setSelectionEnd] = createSignal(0);
  const [activePopupIndex, setActivePopupIndex] = createSignal(0);
  const [dismissedPopupSignature, setDismissedPopupSignature] = createSignal('');
  const [slashParameterSession, setSlashParameterSession] = createSignal<ComposerSlashParameterSession | null>(null);
  const [fileIndexRevision, setFileIndexRevision] = createSignal(0);
  const [composerMoreOpen, setComposerMoreOpen] = createSignal(false);
  const [composerControlLayout, setComposerControlLayout] = createSignal<ComposerControlLayout>({
    availableWidth: 0,
    moreWidth: CODEX_COMPOSER_MORE_WIDTH_FALLBACK_PX,
    itemWidths: {},
  });
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let workingDirChipRef: HTMLButtonElement | undefined;
  let composerMetaViewportRef: HTMLDivElement | undefined;
  let composerMetaMeasureRef: HTMLDivElement | undefined;
  let composerMoreButtonRef: HTMLButtonElement | undefined;
  let composerMorePanelRef: HTMLDivElement | undefined;
  const autosizeController = createCodexComposerAutosizeController();

  const hasDraftContent = () => (
    !!String(props.composerText ?? '').trim() ||
    props.attachments.length > 0 ||
    props.mentions.length > 0
  );

  const syncSelection = () => {
    setSelectionStart(textareaRef?.selectionStart ?? 0);
    setSelectionEnd(textareaRef?.selectionEnd ?? 0);
  };

  const restoreSelection = (selection: number) => {
    requestAnimationFrame(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      textareaRef.setSelectionRange(selection, selection);
      syncSelection();
    });
  };

  const requestAutosize = (text = textareaRef?.value ?? props.composerText) => {
    autosizeController.requestMeasure(text);
  };

  const mentionToken = createMemo(() => findComposerMentionToken({
    text: props.composerText,
    selectionStart: selectionStart(),
    selectionEnd: selectionEnd(),
  }));

  const slashCommandToken = createMemo(() => (
    mentionToken()
      ? null
      : findComposerSlashCommandToken({
          text: props.composerText,
          selectionStart: selectionStart(),
          selectionEnd: selectionEnd(),
        })
  ));

  const popupKind = createMemo<ComposerPopupKind>(() => {
    if (mentionToken()) return 'file-mentions';
    if (slashParameterSession()) return 'slash-parameter-options';
    if (slashCommandToken()) return 'slash-commands';
    return 'none';
  });

  const activeSlashParameterControl = createMemo(() => {
    const session = slashParameterSession();
    if (!session) return null;
    return findCodexComposerControlSpec(props.runtimeControls, session.controlID);
  });

  const popupSignature = createMemo(() => {
    if (popupKind() === 'file-mentions') {
      const token = mentionToken();
      return token ? `file:${props.workingDirPath}:${token.range.start}:${token.query}` : '';
    }
    if (popupKind() === 'slash-parameter-options') {
      const session = slashParameterSession();
      const control = activeSlashParameterControl();
      if (!session || !control) return '';
      return [
        'param',
        session.commandID,
        session.controlID,
        control.value,
        control.options.map((option) => option.value).join(','),
      ].join(':');
    }
    if (popupKind() === 'slash-commands') {
      const token = slashCommandToken();
      return token ? `slash:${token.query}` : '';
    }
    return '';
  });

  const popupVisible = createMemo(() => {
    const signature = popupSignature();
    if (!signature) return false;
    return signature !== dismissedPopupSignature();
  });

  const slashCommands = createMemo<CodexSlashCommandSpec[]>(() => (
    popupKind() === 'slash-commands'
      ? filterCodexSlashCommands({
          query: slashCommandToken()?.query ?? '',
          context: {
            hostAvailable: props.hostAvailable,
            workingDirEditable: props.hostAvailable && !props.workingDirLocked && !props.workingDirDisabled,
          },
        })
      : []
  ));

  const slashParameterOptions = createMemo<CodexComposerControlOption[]>(() => (
    popupKind() === 'slash-parameter-options'
      ? [...(activeSlashParameterControl()?.options ?? [])]
      : []
  ));

  createEffect(() => {
    if (!popupVisible() || popupKind() !== 'file-mentions') return;
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return;
    void fileIndex.ensureIndexed(cwd);
  });

  createEffect(() => {
    const unsubscribe = fileIndex.subscribe(() => {
      setFileIndexRevision((value) => value + 1);
    });
    onCleanup(unsubscribe);
  });

  const fileMentionCandidates = createMemo<CodexFileSearchEntry[]>(() => {
    void fileIndexRevision();
    if (popupKind() !== 'file-mentions') return [];
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return [];
    return fileIndex.query(cwd, mentionToken()?.query ?? '');
  });

  const fileIndexLoading = createMemo(() => {
    void fileIndexRevision();
    if (popupKind() !== 'file-mentions') return false;
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return false;
    return fileIndex.getSnapshot(cwd)?.complete === false;
  });

  createEffect(() => {
    const session = slashParameterSession();
    if (!session) return;
    const control = activeSlashParameterControl();
    if (control && !control.disabled && control.options.length > 0) return;
    setSlashParameterSession(null);
  });

  const popupItemCount = createMemo(() => (
    popupKind() === 'file-mentions'
      ? fileMentionCandidates().length
      : popupKind() === 'slash-parameter-options'
        ? slashParameterOptions().length
        : slashCommands().length
  ));

  createEffect(() => {
    const count = popupItemCount();
    setActivePopupIndex((current) => {
      if (count <= 0) return 0;
      return Math.min(current, count - 1);
    });
  });

  createEffect(() => {
    popupSignature();
    if (popupKind() === 'slash-parameter-options') {
      const control = activeSlashParameterControl();
      if (!control) {
        setActivePopupIndex(0);
        return;
      }
      const selectedIndex = control.options.findIndex((option) => option.value === control.value);
      setActivePopupIndex(selectedIndex >= 0 ? selectedIndex : 0);
      return;
    }
    setActivePopupIndex(0);
  });

  createEffect(() => {
    void props.composerText;
    requestAutosize(props.composerText);
  });

  onCleanup(() => {
    autosizeController.dispose();
    fileIndex.dispose();
  });

  const valueControls = createMemo(() => props.runtimeControls.filter((control) => control.variant === 'value'));
  const policyControls = createMemo(() => props.runtimeControls.filter((control) => control.variant === 'policy'));
  const popupAriaLabel = createMemo(() => {
    switch (popupKind()) {
      case 'file-mentions':
        return i18n.t('codex.composer.fileReferenceSuggestions');
      case 'slash-parameter-options': {
        const control = activeSlashParameterControl();
        return control ? i18n.t('codex.composer.optionsForControl', { label: control.label }) : i18n.t('codex.composer.commandParameterOptions');
      }
      case 'slash-commands':
      default:
        return i18n.t('codex.composer.commandSuggestions');
    }
  });

  const primaryActionAriaLabel = () => (
    props.primaryActionKind === 'stop'
      ? i18n.t('codex.composer.stopActiveTurn')
      : props.primaryActionKind === 'queue'
      ? i18n.t('codex.composer.queueNextTurn')
      : i18n.t('codex.composer.sendToCodex')
  );
  const primaryActionIsStop = () => props.primaryActionKind === 'stop';
  const canOpenWorkingDirPicker = () => props.hostAvailable && !props.workingDirDisabled && !props.workingDirLocked;
  const workingDirChipTitle = () => {
    const absolutePath = String(props.workingDirTitle ?? '').trim() || i18n.t('codex.common.workingDirectory');
    if (!props.hostAvailable) {
      return statusNote() || absolutePath;
    }
    if (props.workingDirLocked) {
      return i18n.t('codex.composer.lockedToThisThread', { path: absolutePath });
    }
    return absolutePath;
  };
  const workingDirChipLabel = () => String(props.workingDirLabel ?? '').trim() || compactPathLabel(props.workingDirPath, i18n.t('codex.common.workingDir'));
  const slashParameterOptionDetail = (option: CodexComposerControlOption) => {
    const description = String(option.description ?? '').trim();
    if (description) return description;
    const value = String(option.value ?? '').trim();
    const label = String(option.label ?? '').trim();
    if (value && value !== label) return value;
    return '';
  };
  const statusNote = () => {
    if (!props.hostAvailable) {
      return String(props.hostDisabledReason ?? '').trim() || i18n.t('codex.composer.installHostToEnable');
    }
    if (props.attachments.length > 0 && !props.supportsImages) {
      return i18n.t('codex.composer.selectedModelNoImages');
    }
    return '';
  };
  const composerPlaceholder = () => {
    return props.supportsImages || props.capabilitiesLoading
      ? i18n.t('codex.composer.placeholderWithImages')
      : i18n.t('codex.composer.placeholderTextOnly');
  };
  const composerMoreControlIDs = createMemo<readonly ComposerOverflowControlID[]>(() => (
    CODEX_COMPOSER_MORE_CONTROL_ORDER.filter((id) => (
      id === 'working_dir' || findCodexComposerControlSpec(props.runtimeControls, id) !== null
    ))
  ));
  const composerMeasuredControlIDs = createMemo<readonly ComposerMeasureControlID[]>(() => [
    'attachment',
    ...composerMoreControlIDs(),
  ]);
  const composerControlsWidth = (ids: readonly ComposerMeasureControlID[], includeMore: boolean): number => {
    const layout = composerControlLayout();
    const controlsWidth = ids.reduce((total, id) => total + Math.max(0, layout.itemWidths[id] ?? 0), 0);
    const controlGaps = Math.max(0, ids.length - 1) * CODEX_COMPOSER_CONTROL_GAP_PX;
    if (!includeMore) return controlsWidth + controlGaps;
    return controlsWidth
      + controlGaps
      + (ids.length > 0 ? CODEX_COMPOSER_CONTROL_GAP_PX : 0)
      + Math.max(CODEX_COMPOSER_MORE_WIDTH_FALLBACK_PX, layout.moreWidth);
  };
  const composerMetaOverflowing = createMemo(() => {
    const availableWidth = composerControlLayout().availableWidth;
    if (availableWidth <= 0) return false;
    return composerControlsWidth(composerMeasuredControlIDs(), false) > availableWidth;
  });
  const setComposerControlLayoutIfChanged = (next: ComposerControlLayout) => {
    const previous = composerControlLayout();
    const same = previous.availableWidth === next.availableWidth
      && previous.moreWidth === next.moreWidth
      && CODEX_COMPOSER_MEASURE_CONTROL_ORDER.every((id) => (previous.itemWidths[id] ?? 0) === (next.itemWidths[id] ?? 0));
    if (!same) setComposerControlLayout(next);
  };
  const measureComposerControls = () => {
    const availableWidth = Math.ceil(
      composerMetaViewportRef?.getBoundingClientRect().width
        || composerMetaViewportRef?.clientWidth
        || 0,
    );
    const itemWidths: Partial<Record<ComposerMeasureControlID, number>> = {};
    for (const id of CODEX_COMPOSER_MEASURE_CONTROL_ORDER) {
      const node = composerMetaMeasureRef?.querySelector<HTMLElement>(`[data-codex-composer-control-measure="${id}"]`);
      const width = Math.ceil(node?.getBoundingClientRect().width || node?.offsetWidth || 0);
      if (width > 0) itemWidths[id] = width;
    }
    const moreNode = composerMetaMeasureRef?.querySelector<HTMLElement>('[data-codex-composer-more-measure="true"]');
    const moreWidth = Math.max(
      CODEX_COMPOSER_MORE_WIDTH_FALLBACK_PX,
      Math.ceil(moreNode?.getBoundingClientRect().width || moreNode?.offsetWidth || 0),
    );
    setComposerControlLayoutIfChanged({
      availableWidth,
      moreWidth,
      itemWidths,
    });
  };
  let composerControlMeasureFrame = 0;
  const scheduleComposerControlMeasure = () => {
    if (typeof window === 'undefined') return;
    if (composerControlMeasureFrame) return;
    composerControlMeasureFrame = window.requestAnimationFrame(() => {
      composerControlMeasureFrame = 0;
      measureComposerControls();
    });
  };
  onMount(() => {
    measureComposerControls();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleComposerControlMeasure());
    if (composerMetaViewportRef) resizeObserver?.observe(composerMetaViewportRef);
    if (composerMetaMeasureRef) resizeObserver?.observe(composerMetaMeasureRef);
    const onResize = () => scheduleComposerControlMeasure();
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      if (composerControlMeasureFrame) {
        window.cancelAnimationFrame(composerControlMeasureFrame);
        composerControlMeasureFrame = 0;
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onResize);
    });
  });
  createEffect(() => {
    void props.hostAvailable;
    void props.supportsImages;
    void props.workingDirDisabled;
    void props.workingDirLocked;
    void workingDirChipLabel();
    void workingDirChipTitle();
    void props.runtimeControls.map((control) => [
      control.id,
      control.label,
      control.value,
      control.placeholder,
      control.disabled,
      control.variant,
      control.options.map((option) => `${option.value}:${option.label}`).join(','),
    ].join('|')).join('||');
    measureComposerControls();
  });
  createEffect(() => {
    if (!composerMetaOverflowing()) setComposerMoreOpen(false);
  });
  createEffect(() => {
    if (!composerMoreOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (composerMoreButtonRef?.contains(target) || composerMorePanelRef?.contains(target)) return;
      setComposerMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setComposerMoreOpen(false);
      queueMicrotask(() => composerMoreButtonRef?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    });
  });
  const primaryActionDisabled = () => props.primaryActionDisabled;
  const primaryActionTitle = () => (
    String(props.primaryActionDisabledReason ?? '').trim() || primaryActionAriaLabel()
  );
  const primaryActionActive = () => (
    (primaryActionIsStop() || hasDraftContent()) &&
    !primaryActionDisabled()
  );
  const handlePrimaryAction = () => {
    if (primaryActionDisabled()) return;
    if (primaryActionIsStop()) {
      props.onStop();
      return;
    }
    if (props.primaryActionKind === 'queue') {
      props.onQueue();
      return;
    }
    props.onSend();
  };

  const applyComposerText = (nextText: string, nextSelection?: number) => {
    props.onComposerInput(nextText);
    if (typeof nextSelection === 'number') {
      restoreSelection(nextSelection);
    }
  };

  const commitFileMention = (entry: CodexFileSearchEntry) => {
    const token = mentionToken();
    if (!token) return;
    props.onAddFileMentions([{
      name: entry.name,
      path: entry.path,
      is_image: entry.is_image,
    }]);
    const result = replaceComposerTextRange(props.composerText, token.range, '');
    setDismissedPopupSignature('');
    applyComposerText(result.text, result.selection);
  };

  const commitSlashParameterOption = (option: CodexComposerControlOption) => {
    const control = activeSlashParameterControl();
    if (!control) return;
    control.onChange(String(option.value ?? ''));
    setDismissedPopupSignature('');
    setSlashParameterSession(null);
    requestAnimationFrame(() => textareaRef?.focus());
  };

  const runSlashCommand = (command: CodexSlashCommandSpec) => {
    let nextText = props.composerText;
    let nextSelection = selectionStart();
    const token = slashCommandToken();
    if (token) {
      const result = replaceComposerTextRange(nextText, token.range, '');
      nextText = result.text;
      nextSelection = result.selection;
    }
    setDismissedPopupSignature('');

    if (command.kind === 'parameter') {
      const controlID = command.parameter_target;
      const control = controlID ? findCodexComposerControlSpec(props.runtimeControls, controlID) : null;
      applyComposerText(nextText, nextSelection);
      if (!controlID || !control || control.disabled || control.options.length === 0) return;
      setSlashParameterSession({
        commandID: command.id,
        controlID,
      });
      return;
    }

    switch (command.action) {
      case 'insert-mention-trigger': {
        setSlashParameterSession(null);
        const result = replaceComposerTextRange(nextText, { start: nextSelection, end: nextSelection }, '@');
        applyComposerText(result.text, result.selection);
        return;
      }
      case 'start-new-thread': {
        setSlashParameterSession(null);
        applyComposerText(nextText);
        props.onStartNewThreadDraft();
        return;
      }
      case 'clear-composer': {
        setSlashParameterSession(null);
        props.onResetComposer();
        restoreSelection(0);
        return;
      }
      case 'open-working-dir-picker': {
        setSlashParameterSession(null);
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => {
          if (canOpenWorkingDirPicker()) {
            props.onOpenWorkingDirPicker();
            return;
          }
          workingDirChipRef?.focus();
        });
        return;
      }
      default:
        return;
    }
  };

  const dismissActivePopup = () => {
    if (popupKind() === 'slash-parameter-options') {
      setSlashParameterSession(null);
      requestAnimationFrame(() => textareaRef?.focus());
      return;
    }
    setDismissedPopupSignature(popupSignature());
  };

  const handlePopupKeydown = (event: KeyboardEvent): boolean => {
    if (!popupVisible()) return false;

    const itemCount = popupItemCount();
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissActivePopup();
      return true;
    }
    if (itemCount <= 0) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        return true;
      }
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActivePopupIndex((current) => (current + 1) % itemCount);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActivePopupIndex((current) => (current - 1 + itemCount) % itemCount);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      if (popupKind() === 'file-mentions') {
        const candidate = fileMentionCandidates()[activePopupIndex()];
        if (candidate) {
          commitFileMention(candidate);
        }
        return true;
      }
      if (popupKind() === 'slash-parameter-options') {
        const option = slashParameterOptions()[activePopupIndex()];
        if (option) {
          commitSlashParameterOption(option);
        }
        return true;
      }
      const command = slashCommands()[activePopupIndex()];
      if (command) {
        runSlashCommand(command);
      }
      return true;
    }
    return false;
  };

  const attachmentControl = () => (
    <button
      type="button"
      class="codex-chat-meta-btn codex-chat-attachment-trigger"
      data-codex-composer-control="attachment"
      onClick={() => fileInputRef?.click()}
      disabled={!props.hostAvailable || !props.supportsImages}
      aria-label={i18n.t('codex.composer.addAttachments')}
      title={i18n.t('codex.composer.addAttachments')}
    >
      <PaperclipIcon />
    </button>
  );

  const attachmentInput = () => (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*"
      class="hidden"
      onChange={(event) => {
        const files = event.currentTarget.files;
        if (!files || files.length === 0) return;
        void props.onAddAttachments(Array.from(files));
        event.currentTarget.value = '';
      }}
    />
  );

  const workingDirectoryControl = (location: ComposerControlLocation = 'inline') => (
    <button
      ref={(element) => {
        workingDirChipRef = element;
      }}
      type="button"
      class={cn(
        'codex-chat-chip codex-chat-working-dir-chip codex-chat-path-chip',
        `codex-chat-composer-control-${location}`,
        canOpenWorkingDirPicker()
          ? 'codex-chat-chip-actionable'
          : 'codex-chat-chip-disabled',
        props.workingDirLocked && 'codex-chat-working-dir-chip-locked',
      )}
      data-codex-composer-control="working_dir"
      onClick={() => {
        if (!canOpenWorkingDirPicker()) return;
        setComposerMoreOpen(false);
        props.onOpenWorkingDirPicker();
      }}
      disabled={props.workingDirDisabled}
      title={workingDirChipTitle()}
      aria-label={props.workingDirLocked ? i18n.t('codex.composer.workingDirectoryLocked') : i18n.t('codex.composer.selectWorkingDirectory')}
      aria-disabled={!canOpenWorkingDirPicker()}
      tabIndex={canOpenWorkingDirPicker() ? 0 : -1}
    >
      <FolderIcon />
      <span class="codex-chat-working-dir-chip-label">{workingDirChipLabel()}</span>
      <Show when={props.workingDirLocked}>
        <LockIcon />
      </Show>
    </button>
  );

  const runtimeControlChip = (control: CodexComposerControlSpec, location: ComposerControlLocation = 'inline') => (
    <span
      class={cn(
        'codex-chat-composer-control-slot',
        `codex-chat-composer-control-${location}`,
      )}
      data-codex-composer-control={control.id}
    >
      <ComposerSelectChip
        label={control.label}
        value={control.value}
        options={control.options}
        placeholder={control.placeholder}
        disabled={control.disabled}
        variant={control.variant}
        onChange={control.onChange}
      />
    </span>
  );

  const controlDisplayLabel = (control: CodexComposerControlSpec) => {
    const selected = control.options.find((option) => option.value === control.value);
    return String(selected?.label ?? control.value ?? control.placeholder ?? '').trim() || control.label;
  };

  const composerMoreControlLabel = (id: ComposerOverflowControlID): string => {
    if (id === 'working_dir') return i18n.t('codex.common.workingDirectory');
    return findCodexComposerControlSpec(props.runtimeControls, id)?.label ?? '';
  };

  const composerMoreControl = (id: ComposerOverflowControlID) => {
    if (id === 'working_dir') return workingDirectoryControl('overflow');
    const control = findCodexComposerControlSpec(props.runtimeControls, id);
    return control ? runtimeControlChip(control, 'overflow') : null;
  };

  const composerMorePanel = () => (
    <Show when={composerMoreOpen() && composerMetaOverflowing()}>
      <div
        ref={composerMorePanelRef}
        class="codex-chat-composer-more-panel"
        role="dialog"
        aria-label={i18n.t('codex.composer.moreInputControls')}
        data-codex-composer-more-panel="true"
      >
        <For each={composerMoreControlIDs()}>
          {(id) => (
            <div class="codex-chat-composer-more-row" data-codex-composer-more-item={id}>
              <span class="codex-chat-composer-more-label">{composerMoreControlLabel(id)}</span>
              <span class="codex-chat-composer-more-control">{composerMoreControl(id)}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );

  const composerMoreButton = () => (
    <Show when={composerMetaOverflowing()}>
      <div class="codex-chat-composer-more-anchor">
        <button
          ref={composerMoreButtonRef}
          type="button"
          class="codex-chat-composer-more-button"
          aria-label={i18n.t('codex.composer.moreInputControls')}
          title={i18n.t('codex.composer.moreControls')}
          aria-haspopup="dialog"
          aria-expanded={composerMoreOpen()}
          onClick={() => setComposerMoreOpen((open) => !open)}
        >
          <MoreHorizontal class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {composerMorePanel()}
      </div>
    </Show>
  );

  const composerMeasureControl = (id: ComposerMeasureControlID) => {
    if (id === 'attachment') {
      return (
        <span class="codex-chat-meta-btn codex-chat-attachment-trigger codex-chat-composer-control-measure">
          <PaperclipIcon />
        </span>
      );
    }
    if (id === 'working_dir') {
      return (
        <span class={cn(
          'codex-chat-chip codex-chat-working-dir-chip codex-chat-path-chip codex-chat-composer-control-measure',
          props.workingDirLocked && 'codex-chat-working-dir-chip-locked',
        )}>
          <FolderIcon />
          <span class="codex-chat-working-dir-chip-label">{workingDirChipLabel()}</span>
          <Show when={props.workingDirLocked}>
            <LockIcon />
          </Show>
        </span>
      );
    }
    const control = findCodexComposerControlSpec(props.runtimeControls, id);
    if (!control) return null;
    return (
      <span class={cn(
        'codex-chat-select-chip codex-chat-composer-control-measure',
        control.variant === 'value'
          ? 'codex-chat-select-chip-value'
          : 'codex-chat-select-chip-policy',
        control.value && 'codex-chat-select-chip-value-only',
        control.disabled && 'codex-chat-select-chip-disabled',
      )}>
        <Show when={!control.value}>
          <span class="codex-chat-select-chip-label">{control.label}</span>
        </Show>
        <span class={cn(
          'codex-chat-select-chip-control',
          control.variant === 'value'
            ? 'codex-chat-select-chip-control-value'
            : 'codex-chat-select-chip-control-policy',
        )}>
          {controlDisplayLabel(control)}
        </span>
      </span>
    );
  };

  return (
    <div data-codex-surface="composer" class={cn(
      'chat-input-container codex-chat-input',
      isFocused() && 'chat-input-container-focused',
    )}>
      <div class="chat-input-body codex-chat-input-body">
        <div class="codex-chat-input-primary-row">
          <textarea
            ref={(element) => {
              textareaRef = element;
              autosizeController.setTextarea(element);
            }}
            value={props.composerText}
            disabled={!props.hostAvailable}
            onInput={(event) => {
              setSlashParameterSession(null);
              props.onComposerInput(event.currentTarget.value);
              setDismissedPopupSignature('');
              syncSelection();
              requestAutosize(event.currentTarget.value);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.items ?? [])
                .map((item) => item.kind === 'file' ? item.getAsFile() : null)
                .filter((file): file is File => file instanceof File && String(file.type ?? '').startsWith('image/'));
              if (files.length === 0 || !props.hostAvailable || !props.supportsImages) {
                return;
              }
              event.preventDefault();
              void props.onAddAttachments(files);
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={() => requestAutosize()}
            onCompositionEnd={() => {
              setIsComposing(false);
              syncSelection();
              requestAutosize();
            }}
            onKeyDown={(event) => {
              if (!isComposing() && handlePopupKeydown(event)) return;
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              handlePrimaryAction();
            }}
            onKeyUp={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onSelect={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onClick={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onFocus={() => {
              setIsFocused(true);
              syncSelection();
            }}
            onBlur={() => setIsFocused(false)}
            rows={2}
            placeholder={composerPlaceholder()}
            class="chat-input-textarea codex-chat-input-textarea"
          />

          <div class="codex-chat-input-send-slot">
            <button
              type="button"
              class={cn(
                'chat-input-send-btn codex-chat-input-send-btn',
                primaryActionIsStop() && 'codex-chat-input-send-btn-stop',
                primaryActionActive() && 'chat-input-send-btn-active',
              )}
              onClick={handlePrimaryAction}
              disabled={primaryActionDisabled()}
              data-codex-primary-action={props.primaryActionKind}
              aria-label={primaryActionAriaLabel()}
              title={primaryActionTitle()}
            >
              <Show when={primaryActionIsStop()} fallback={<Send class="h-[18px] w-[18px]" />}>
                <StopSquareIcon class="h-[18px] w-[18px]" />
              </Show>
            </button>
          </div>
        </div>

        <Show when={String(props.guidanceNote ?? '').trim()}>
          <div class="codex-chat-input-guidance">{props.guidanceNote}</div>
        </Show>

        <Show when={popupVisible()}>
          <div class="codex-chat-popup-overlay">
            <div
              class="codex-chat-popup"
              data-codex-popup-kind={popupKind()}
              role="listbox"
              aria-label={popupAriaLabel()}
            >
              <Show when={popupKind() === 'file-mentions'} fallback={(
                <Show when={popupKind() === 'slash-parameter-options'} fallback={(
                  <For each={slashCommands()}>
                    {(command, index) => (
                      <button
                        type="button"
                        role="option"
                        class={cn(
                          'codex-chat-popup-item',
                          activePopupIndex() === index() && 'codex-chat-popup-item-active',
                        )}
                        aria-selected={activePopupIndex() === index()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runSlashCommand(command)}
                      >
                        <span class="codex-chat-popup-item-title">{command.title}</span>
                        <span class="codex-chat-popup-item-detail">{localizedCodexSlashCommandDescription(command, i18n.t)}</span>
                      </button>
                    )}
                  </For>
                )}>
                  <Show
                    when={slashParameterOptions().length > 0}
                    fallback={<div class="codex-chat-popup-empty">{i18n.t('codex.composer.noOptionsAvailable')}</div>}
                  >
                    <For each={slashParameterOptions()}>
                      {(option, index) => (
                        <button
                          type="button"
                          role="option"
                          class={cn(
                            'codex-chat-popup-item',
                            activePopupIndex() === index() && 'codex-chat-popup-item-active',
                          )}
                          aria-selected={activePopupIndex() === index()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commitSlashParameterOption(option)}
                        >
                          <span class="codex-chat-popup-item-title">{option.label}</span>
                          <Show when={slashParameterOptionDetail(option)}>
                            <span class="codex-chat-popup-item-detail">{slashParameterOptionDetail(option)}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              )}>
                <Show
                  when={fileMentionCandidates().length > 0}
                  fallback={(
                    <div class="codex-chat-popup-empty">
                      {fileIndexLoading()
                        ? i18n.t('codex.composer.indexingFiles')
                        : i18n.t('codex.composer.noMatchingFiles')}
                    </div>
                  )}
                >
                  <For each={fileMentionCandidates()}>
                    {(entry, index) => (
                      <button
                        type="button"
                        role="option"
                        class={cn(
                          'codex-chat-popup-item',
                          activePopupIndex() === index() && 'codex-chat-popup-item-active',
                        )}
                        aria-selected={activePopupIndex() === index()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => commitFileMention(entry)}
                      >
                        <span class="codex-chat-popup-item-title">{entry.name}</span>
                        <span class="codex-chat-popup-item-detail">{compactPathLabel(entry.parent, entry.parent)}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </div>
        </Show>

        <div class="codex-chat-input-meta">
          <div
            ref={composerMetaViewportRef}
            class="codex-chat-input-meta-rail"
            role="toolbar"
            aria-label={i18n.t('codex.composer.inputControls')}
            data-codex-composer-overflow={composerMetaOverflowing() ? 'true' : 'false'}
          >
            <Show when={!composerMetaOverflowing()} fallback={(
              <>
                <div class="codex-chat-input-meta-group codex-chat-input-meta-group-context" data-codex-composer-inline-item="attachment">
                  {attachmentControl()}
                  {attachmentInput()}
                </div>
                {composerMoreButton()}
              </>
            )}>
              <div class="codex-chat-input-meta-group codex-chat-input-meta-group-context">
                <span class="codex-chat-composer-control-slot" data-codex-composer-inline-item="attachment">
                  {attachmentControl()}
                </span>
                {attachmentInput()}
                <span class="codex-chat-composer-control-slot" data-codex-composer-inline-item="working_dir">
                  {workingDirectoryControl('inline')}
                </span>
              </div>

              <div class="codex-chat-input-meta-group codex-chat-input-meta-group-strategy">
                <div class="codex-chat-input-meta-subgroup codex-chat-input-meta-subgroup-values">
                  <For each={valueControls()}>
                    {(control) => (
                      <span data-codex-composer-inline-item={control.id}>
                        {runtimeControlChip(control, 'inline')}
                      </span>
                    )}
                  </For>
                </div>

                <div class="codex-chat-input-meta-subgroup codex-chat-input-meta-subgroup-policies">
                  <For each={policyControls()}>
                    {(control) => (
                      <span data-codex-composer-inline-item={control.id}>
                        {runtimeControlChip(control, 'inline')}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div ref={composerMetaMeasureRef} class="codex-chat-input-meta-measure" aria-hidden="true">
              <For each={composerMeasuredControlIDs()}>
                {(id) => (
                  <span data-codex-composer-control-measure={id}>
                    {composerMeasureControl(id)}
                  </span>
                )}
              </For>
              <span data-codex-composer-more-measure="true">
                <span class="codex-chat-composer-more-button codex-chat-composer-control-measure">
                  <MoreHorizontal class="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </span>
            </div>
          </div>

          <Show when={statusNote()}>
            <div class="codex-chat-input-support">
              <Show when={statusNote()}>
                <div class={cn(
                  'codex-chat-input-status',
                  !props.hostAvailable && 'text-error',
                )}>
                  {statusNote()}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={props.mentions.length > 0 || props.attachments.length > 0}>
            <div class="codex-chat-draft-objects">
              <Show when={props.mentions.length > 0}>
                <div class="codex-chat-mention-strip codex-chat-draft-strip">
                  <For each={props.mentions}>
                    {(mention) => (
                      <MentionChip mention={mention} onRemove={props.onRemoveMention} />
                    )}
                  </For>
                </div>
              </Show>

              <Show when={props.attachments.length > 0}>
                <div class="codex-chat-attachment-strip codex-chat-draft-strip">
                  <For each={props.attachments}>
                    {(attachment) => (
                      <AttachmentCard attachment={attachment} onRemove={props.onRemoveAttachment} />
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

const PaperclipIcon: Component = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const FolderIcon: Component = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const LockIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 1 1 8 0v4" />
  </svg>
);

const StopSquareIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
);
