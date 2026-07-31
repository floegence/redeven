package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
)

// floretBootstrapResult exists only while NewService assembles responsibility-
// specific capabilities. Service must not retain this aggregate.
type floretBootstrapResult struct {
	close               func() error
	pendingToolRecovery floretPendingToolRecoveryCoordinator

	newThreadRead floretThreadReadHostFactory

	bindThreadRuntime floretThreadRuntimeBinder
	newSubagentRead   floretSubagentReadHostFactory

	threadCreate floretThreadCreateAuthority
	threadTitle  floretThreadTitleAuthority
	threadFork   floretThreadForkAuthority
	threadDelete floretThreadDeleteAuthority
	orphanRoots  *floretOrphanRootMaintenanceCoordinator
}

type floretStartupRecoveryCapabilities struct {
	inventory     floretRootThreadInventory
	root          floretRootTurnRecoveryBinder
	subagent      floretSubagentTurnRecoveryBinder
	listSubagents floretSubagentReadHostFactory
}

type floretThreadRuntimeBinder func(identity.ThreadID) (floretThreadRuntimeCapabilities, error)

type floretHostAuthorityAdapter struct {
	host *flruntime.Host
}

func (a floretHostAuthorityAdapter) CreateThread(ctx context.Context, requestID identity.LogicalRequestID) (flruntime.CreateThreadResult, error) {
	return a.host.Threads().CreateThread(ctxOrBackground(ctx), flruntime.CreateThreadCommand{LogicalRequestID: requestID})
}

func (a floretHostAuthorityAdapter) SetCreatedThreadTitle(ctx context.Context, threadID identity.ThreadID, command flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error) {
	return a.SetThreadTitle(ctx, threadID, command)
}

func (a floretHostAuthorityAdapter) SetThreadTitle(ctx context.Context, threadID identity.ThreadID, command flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error) {
	thread, err := a.host.Thread(ctxOrBackground(ctx), threadID)
	if err != nil {
		return flruntime.SetThreadTitleResult{}, err
	}
	return thread.SetTitle(ctxOrBackground(ctx), command)
}

func (a floretHostAuthorityAdapter) ForkThread(ctx context.Context, sourceThreadID identity.ThreadID, command flruntime.ForkThreadCommand) (flruntime.ForkThreadResultV3, error) {
	thread, err := a.host.Thread(ctxOrBackground(ctx), sourceThreadID)
	if err != nil {
		return flruntime.ForkThreadResultV3{}, err
	}
	return thread.ForkThread(ctxOrBackground(ctx), command)
}

func (a floretHostAuthorityAdapter) SetForkedThreadTitle(ctx context.Context, threadID identity.ThreadID, command flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error) {
	return a.SetThreadTitle(ctx, threadID, command)
}

func (a floretHostAuthorityAdapter) DeleteThread(ctx context.Context, threadID identity.ThreadID, command flruntime.DeleteThreadCommand) error {
	thread, err := a.host.Thread(ctxOrBackground(ctx), threadID)
	if err != nil {
		return err
	}
	_, err = thread.DeleteThread(ctxOrBackground(ctx), command)
	return err
}

type floretThreadReadHostAdapter struct {
	thread *flruntime.Thread
}

func (h floretThreadReadHostAdapter) ReadThread(ctx context.Context) (flruntime.ThreadSnapshot, error) {
	view, err := h.thread.Snapshot(ctxOrBackground(ctx))
	return view.Thread, err
}

func (h floretThreadReadHostAdapter) ReadThreadOverview(ctx context.Context) (flruntime.ThreadOverview, error) {
	return h.thread.ReadOverview(ctxOrBackground(ctx))
}

func (h floretThreadReadHostAdapter) ReadThreadTurn(ctx context.Context, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return h.thread.ReadTurn(ctxOrBackground(ctx), turnID)
}

func (h floretThreadReadHostAdapter) ListThreadTurns(ctx context.Context, request flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.thread.ListTurns(ctxOrBackground(ctx), request)
}

func (h floretThreadReadHostAdapter) ReadThreadAgentTodos(ctx context.Context) (flruntime.ThreadAgentTodoState, error) {
	return h.thread.ReadAgentTodos(ctxOrBackground(ctx))
}

func (h floretThreadReadHostAdapter) ReadThreadContext(ctx context.Context) (flruntime.ThreadContextSnapshot, error) {
	return h.thread.ReadContext(ctxOrBackground(ctx))
}

func (h floretThreadReadHostAdapter) ReadTurnProjection(ctx context.Context, turnID identity.TurnID, runID identity.RunID) (flruntime.ThreadTurnProjection, error) {
	return h.thread.ReadProjection(ctxOrBackground(ctx), turnID, runID)
}

type floretSubagentReadHostAdapter struct {
	parent *flruntime.Thread
}

func (h floretSubagentReadHostAdapter) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return h.parent.ListSubAgents(ctxOrBackground(ctx))
}

func (h floretSubagentReadHostAdapter) child(ctx context.Context, childThreadID identity.ThreadID) (*flruntime.Child, error) {
	return h.parent.Child(ctxOrBackground(ctx), childThreadID)
}

func (h floretSubagentReadHostAdapter) ReadThreadTurn(ctx context.Context, childThreadID identity.ThreadID, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	child, err := h.child(ctx, childThreadID)
	if err != nil {
		return flruntime.ThreadTurnSnapshot{}, err
	}
	return child.ReadTurn(ctxOrBackground(ctx), turnID)
}

func (h floretSubagentReadHostAdapter) ListThreadTurns(ctx context.Context, childThreadID identity.ThreadID, request flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	child, err := h.child(ctx, childThreadID)
	if err != nil {
		return flruntime.ThreadTurnsPage{}, err
	}
	return child.ListTurns(ctxOrBackground(ctx), request)
}

func (h floretSubagentReadHostAdapter) ReadSubAgentDetail(ctx context.Context, childThreadID identity.ThreadID, request flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error) {
	child, err := h.child(ctx, childThreadID)
	if err != nil {
		return flruntime.SubAgentDetail{}, err
	}
	return child.ReadDetail(ctxOrBackground(ctx), request)
}

type floretTurnHostAdapter struct {
	thread *flruntime.Thread
	turns  *flruntime.Turns
}

func (h floretTurnHostAdapter) StartTurn(ctx context.Context, command flruntime.StartTurnCommand) (flruntime.StartTurnResult, error) {
	return h.turns.StartTurn(ctxOrBackground(ctx), command)
}

func (h floretTurnHostAdapter) ReadTurn(ctx context.Context, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return h.thread.ReadTurn(ctxOrBackground(ctx), turnID)
}

func (h floretTurnHostAdapter) ReadApprovalQueue(ctx context.Context) (flruntime.ApprovalQueue, error) {
	return h.thread.ReadApprovalQueue(ctxOrBackground(ctx))
}

func (h floretTurnHostAdapter) ResolveApproval(ctx context.Context, command flruntime.ResolveApprovalCommand) (flruntime.ResolveApprovalResult, error) {
	result, err := h.turns.ResolveApproval(ctxOrBackground(ctx), command)
	return result.Resolution, err
}

func (h floretTurnHostAdapter) SettlePendingTool(ctx context.Context, request floretPendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if request.Target.ThreadID != h.thread.ID() {
		return flruntime.PendingToolSettlementResult{}, errors.New("Floret pending tool settlement target identity mismatch")
	}
	result, err := h.turns.RecordPendingToolOutcome(ctxOrBackground(ctx), flruntime.RecordPendingToolOutcomeCommand{
		LogicalRequestID: request.LogicalRequestID,
		Target: flruntime.ActivePendingToolTarget{
			TurnID: request.Target.TurnID, RunID: request.Target.RunID, ToolCallID: request.Target.ToolCallID,
			ToolName: request.Target.ToolName, Handle: request.Target.Handle, EffectAttemptID: request.Target.EffectAttemptID,
		},
		Status: request.Status, Summary: request.Summary, Output: request.Output, Activity: request.Activity,
	})
	return result.Outcome, err
}

func (h floretTurnHostAdapter) ReadThreadAgentTodos(ctx context.Context) (flruntime.ThreadAgentTodoState, error) {
	return h.thread.ReadAgentTodos(ctxOrBackground(ctx))
}

func (h floretTurnHostAdapter) UpdateThreadAgentTodos(ctx context.Context, command flruntime.UpdateTodosCommand) (flruntime.ThreadAgentTodoState, error) {
	result, err := h.turns.UpdateTodos(ctxOrBackground(ctx), command)
	return result.State, err
}

type floretCompactionHostAdapter struct {
	thread *flruntime.Thread
	agent  *flruntime.Agent
}

func (h floretCompactionHostAdapter) Compact(ctx context.Context, command flruntime.CompactThreadCommand) (flruntime.CompactThreadResult, error) {
	return h.thread.Compact(ctxOrBackground(ctx), h.agent, command)
}

type floretSubagentHostAdapter struct {
	active    floretTurnHostAdapter
	subagents *flruntime.SubAgents
}

func (h floretSubagentHostAdapter) SettlePendingTool(ctx context.Context, request floretPendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return h.active.SettlePendingTool(ctx, request)
}

func (h floretSubagentHostAdapter) SpawnSubAgent(ctx context.Context, command flruntime.SpawnSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	result, err := h.subagents.SpawnSubAgent(ctxOrBackground(ctx), command)
	return result.Child, err
}

func (h floretSubagentHostAdapter) SendSubAgentInput(ctx context.Context, command flruntime.SendSubAgentMessageCommand) (flruntime.SubAgentSnapshot, error) {
	result, err := h.subagents.SendSubAgentMessage(ctxOrBackground(ctx), command)
	return result.Child, err
}

func (h floretSubagentHostAdapter) InterruptSubAgent(ctx context.Context, command flruntime.InterruptSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	result, err := h.subagents.InterruptSubAgent(ctxOrBackground(ctx), command)
	return result.Child, err
}

func (h floretSubagentHostAdapter) WaitSubAgents(ctx context.Context, command flruntime.WaitSubAgentsCommand) (flruntime.WaitSubAgentsResult, error) {
	return h.subagents.WaitSubAgents(ctxOrBackground(ctx), command)
}

func (h floretSubagentHostAdapter) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return h.subagents.List(ctxOrBackground(ctx))
}

func (h floretSubagentHostAdapter) CloseSubAgent(ctx context.Context, command flruntime.CloseSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	result, err := h.subagents.CloseSubAgent(ctxOrBackground(ctx), command)
	return result.Child, err
}

type boundFloretPendingToolRecoveryCoordinator struct {
	host *flruntime.Host
}

type boundFloretPendingToolRecoverySettler struct {
	host              *flruntime.Host
	executionThreadID identity.ThreadID
	authorityThreadID identity.ThreadID
}

func (c *boundFloretPendingToolRecoveryCoordinator) Settle(ctx context.Context, executionThreadID string, authorityThreadID string, settle func(context.Context, floretPendingToolSettler) error) error {
	if c == nil || c.host == nil || settle == nil {
		return errors.New("Floret pending tool recovery coordinator is unavailable")
	}
	executionID := identity.ThreadID(strings.TrimSpace(executionThreadID))
	authorityID := identity.ThreadID(strings.TrimSpace(authorityThreadID))
	if executionID == "" || authorityID == "" {
		return errors.New("Floret pending tool recovery identity is incomplete")
	}
	return settle(ctxOrBackground(ctx), &boundFloretPendingToolRecoverySettler{
		host: c.host, executionThreadID: executionID, authorityThreadID: authorityID,
	})
}

func (s *boundFloretPendingToolRecoverySettler) SettlePendingTool(ctx context.Context, request floretPendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if s == nil || s.host == nil || request.Target.ThreadID != s.executionThreadID {
		return flruntime.PendingToolSettlementResult{}, errors.New("Floret pending tool recovery target identity mismatch")
	}
	authority, err := s.host.Thread(ctxOrBackground(ctx), s.authorityThreadID)
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	var recovery *flruntime.PendingToolRecovery
	if s.executionThreadID == s.authorityThreadID {
		recovery, err = authority.PendingToolRecovery(ctxOrBackground(ctx), request.Target)
	} else {
		var child *flruntime.Child
		child, err = authority.Child(ctxOrBackground(ctx), s.executionThreadID)
		if err == nil {
			recovery, err = child.PendingToolRecovery(ctxOrBackground(ctx), request.Target)
		}
	}
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	return recovery.Settle(ctxOrBackground(ctx), flruntime.PendingToolRecoveryRequest{Status: request.Status, Summary: request.Summary, Output: request.Output, Activity: request.Activity})
}

type floretInterruptedTurnRecoveryHostFactoryAdapter struct {
	recovery *flruntime.InterruptedTurnRecovery
}

func (f floretInterruptedTurnRecoveryHostFactoryAdapter) NewHost(context.Context) (floretInterruptedTurnRecoveryHost, error) {
	if f.recovery == nil {
		return nil, errors.New("Floret interrupted-turn recovery handle is unavailable")
	}
	return f.recovery, nil
}

type floretRootThreadInventoryAdapter struct {
	threads *flruntime.Threads
}

func (a floretRootThreadInventoryAdapter) ListRootThreads(ctx context.Context, request floretListRootThreadsRequest) (floretRootThreadsPage, error) {
	page, err := a.threads.ListThreads(ctxOrBackground(ctx), flruntime.ListThreadsOptions{Cursor: flruntime.ThreadListCursor(request.Cursor), Limit: request.Limit})
	if err != nil {
		return floretRootThreadsPage{}, err
	}
	out := floretRootThreadsPage{NextCursor: string(page.NextCursor), HasMore: page.HasMore, Threads: make([]flruntime.ThreadSnapshot, 0, len(page.Threads))}
	for _, item := range page.Threads {
		out.Threads = append(out.Threads, item.Thread)
	}
	return out, nil
}

func configureFloretRuntime(host *flruntime.Host) (*floretBootstrapResult, floretStartupRecoveryCapabilities, error) {
	if host == nil {
		return nil, floretStartupRecoveryCapabilities{}, errors.New("Floret runtime Host is required")
	}
	authority := floretHostAuthorityAdapter{host: host}
	newThread := func(ctx context.Context, threadID identity.ThreadID) (*flruntime.Thread, error) {
		return host.Thread(ctxOrBackground(ctx), threadID)
	}
	newThreadRead := func(ctx context.Context, threadID identity.ThreadID) (floretThreadReadHost, error) {
		thread, err := newThread(ctx, threadID)
		if err != nil {
			return nil, err
		}
		return floretThreadReadHostAdapter{thread: thread}, nil
	}
	newSubagentRead := func(ctx context.Context, parentThreadID identity.ThreadID) (floretSubagentReadHost, error) {
		thread, err := newThread(ctx, parentThreadID)
		if err != nil {
			return nil, err
		}
		return floretSubagentReadHostAdapter{parent: thread}, nil
	}
	rootInventory := floretRootThreadInventoryAdapter{threads: host.Threads()}
	result := &floretBootstrapResult{
		close:               func() error { return host.Shutdown(context.Background()) },
		pendingToolRecovery: &boundFloretPendingToolRecoveryCoordinator{host: host},
		newThreadRead:       newThreadRead, newSubagentRead: newSubagentRead,
		threadCreate: authority, threadTitle: authority, threadFork: authority, threadDelete: authority,
	}
	result.bindThreadRuntime = func(threadID identity.ThreadID) (floretThreadRuntimeCapabilities, error) {
		return floretThreadRuntimeCapabilities{
			Turn: func(ctx context.Context, agent *flruntime.Agent) (floretTurnHost, error) {
				thread, err := newThread(ctx, threadID)
				if err != nil {
					return nil, err
				}
				turns, err := thread.Turns(agent)
				if err != nil {
					return nil, err
				}
				return floretTurnHostAdapter{thread: thread, turns: turns}, nil
			},
			Compaction: func(ctx context.Context, agent *flruntime.Agent) (floretCompactionHost, error) {
				thread, err := newThread(ctx, threadID)
				if err != nil {
					return nil, err
				}
				return floretCompactionHostAdapter{thread: thread, agent: agent}, nil
			},
			SubAgent: func(ctx context.Context, agent *flruntime.Agent) (floretSubagentHost, error) {
				thread, err := newThread(ctx, threadID)
				if err != nil {
					return nil, err
				}
				turns, err := thread.Turns(agent)
				if err != nil {
					return nil, err
				}
				subagents, err := thread.SubAgents(ctxOrBackground(ctx), agent)
				if err != nil {
					return nil, err
				}
				return floretSubagentHostAdapter{active: floretTurnHostAdapter{thread: thread, turns: turns}, subagents: subagents}, nil
			},
		}, nil
	}
	result.orphanRoots = &floretOrphanRootMaintenanceCoordinator{inventory: rootInventory, delete: result.threadDelete}
	recovery := floretStartupRecoveryCapabilities{
		inventory: rootInventory, listSubagents: newSubagentRead,
		root: func(ctx context.Context, threadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			thread, err := newThread(ctx, threadID)
			if err != nil {
				return nil, err
			}
			handle, err := thread.InterruptedTurnRecovery(ctxOrBackground(ctx))
			return floretInterruptedTurnRecoveryHostFactoryAdapter{recovery: handle}, err
		},
		subagent: func(ctx context.Context, parentThreadID identity.ThreadID, childThreadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			parent, err := newThread(ctx, parentThreadID)
			if err != nil {
				return nil, err
			}
			child, err := parent.Child(ctxOrBackground(ctx), childThreadID)
			if err != nil {
				return nil, err
			}
			handle, err := child.InterruptedTurnRecovery(ctxOrBackground(ctx))
			return floretInterruptedTurnRecoveryHostFactoryAdapter{recovery: handle}, err
		},
	}
	return result, recovery, nil
}

func newFloretBootstrapResult(host *flruntime.Host) (*floretBootstrapResult, error) {
	result, _, err := configureFloretRuntime(host)
	return result, err
}

func openFloretRuntime(ctx context.Context, storePath string, progress func(FloretStoreStartupPhase)) (*floretBootstrapResult, floretStartupRecoveryCapabilities, error) {
	source, err := prepareFloretStorage(ctx, storePath, progress)
	if err != nil {
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	host, err := flruntime.Open(ctx, flruntime.Options{Storage: source})
	if err != nil {
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	result, recovery, err := configureFloretRuntime(host)
	if err != nil {
		_ = host.Shutdown(context.Background())
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	return result, recovery, nil
}
