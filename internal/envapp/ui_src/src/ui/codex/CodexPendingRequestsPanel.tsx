import { For, Show } from 'solid-js';
import { Button, Input, Tag } from '@floegence/floe-webapp-core/ui';

import { displayStatus, requestTagVariant } from './presentation';
import type { CodexPendingRequest } from './types';
import { buildCodexPendingRequestViewModel } from './viewModel';

export function CodexPendingRequestsPanel(props: {
  requests: readonly CodexPendingRequest[];
  requestDraftValue: (requestID: string, questionID: string) => string;
  setRequestDraftValue: (requestID: string, questionID: string, value: string) => void;
  onAnswer: (request: CodexPendingRequest, decision?: string) => void;
}) {
  return (
    <div data-codex-surface="pending-requests" class="codex-request-panel">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-sm font-medium text-foreground">Pending Codex requests</div>
          <div class="mt-1 text-xs leading-5 text-muted-foreground">
            Resolve these before the active Codex run can continue.
          </div>
        </div>
        <Tag variant="warning" tone="soft" size="sm">
          {props.requests.length}
        </Tag>
      </div>

      <div class="codex-request-list">
        <For each={props.requests}>
          {(request) => {
            const viewModel = () => buildCodexPendingRequestViewModel(request);
            return (
              <div class="codex-request-card">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {displayStatus(request.type, 'request')}
                      </div>
                      <Tag variant={requestTagVariant(request.type)} tone="soft" size="sm">
                        {viewModel().title}
                      </Tag>
                      <Show when={viewModel().questionCount > 0}>
                        <Tag variant="neutral" tone="soft" size="sm">
                          {viewModel().questionCount} prompts
                        </Tag>
                      </Show>
                    </div>
                    <div class="mt-2 text-sm leading-6 text-foreground">
                      {viewModel().detail}
                    </div>
                  </div>
                  <Tag variant="neutral" tone="soft" size="sm">
                    Item {request.item_id}
                  </Tag>
                </div>

                <Show when={viewModel().command}>
                  <div class="codex-request-command">
                    <div class="mb-1 text-[11px] text-muted-foreground">
                      {viewModel().cwd || 'Working directory unavailable'}
                    </div>
                    {viewModel().command}
                  </div>
                </Show>

                <Show when={(request.questions?.length ?? 0) > 0}>
                  <div class="mt-3 space-y-3">
                    <For each={request.questions ?? []}>
                      {(question) => (
                        <div class="rounded-xl border border-border/60 bg-background/85 p-3">
                          <div class="text-sm font-medium text-foreground">{question.header}</div>
                          <div class="mt-1 text-sm leading-6 text-muted-foreground">{question.question}</div>
                          <Input
                            type={question.is_secret ? 'password' : 'text'}
                            value={props.requestDraftValue(request.id, question.id)}
                            onInput={(event) => props.setRequestDraftValue(request.id, question.id, event.currentTarget.value)}
                            placeholder={question.options?.[0]?.label || 'Enter response'}
                            class="mt-3 w-full"
                          />
                          <Show when={(question.options?.length ?? 0) > 0}>
                            <div class="mt-3 flex flex-wrap gap-2">
                              <For each={question.options ?? []}>
                                {(option) => (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => props.setRequestDraftValue(request.id, question.id, option.label)}
                                  >
                                    {option.label}
                                  </Button>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="mt-4 flex flex-wrap gap-2">
                  <Show
                    when={request.type === 'user_input'}
                    fallback={(
                      <>
                        <Button size="sm" onClick={() => props.onAnswer(request, 'accept')}>
                          Approve once
                        </Button>
                        <Show when={(request.available_decisions ?? []).includes('accept_for_session')}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onAnswer(request, 'accept_for_session')}
                          >
                            Approve for session
                          </Button>
                        </Show>
                        <Button size="sm" variant="outline" onClick={() => props.onAnswer(request, 'decline')}>
                          Decline
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => props.onAnswer(request, 'cancel')}>
                          Cancel
                        </Button>
                      </>
                    )}
                  >
                    <Button size="sm" onClick={() => props.onAnswer(request)}>
                      {viewModel().decisionLabel}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => props.onAnswer(request, 'cancel')}>
                      Cancel
                    </Button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
