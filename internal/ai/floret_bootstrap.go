package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v2/runtime"
)

// floretBootstrapResult exists only while NewService assembles responsibility-
// specific capabilities. Service must not retain this aggregate.
type floretBootstrapResult struct {
	close               func() error
	pendingToolRecovery floretPendingToolRecoveryCoordinator

	newThreadRead   floretThreadReadHostFactory
	newThreadCreate floretThreadCreateHostFactory
	newThreadTitle  floretThreadTitleHostFactory
	newThreadFork   floretThreadForkHostFactory
	newThreadDelete floretThreadDeleteHostFactory

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

type boundFloretPendingToolRecoveryCoordinator struct {
	open func(context.Context, flruntime.PendingToolRecoveryTarget) (*flruntime.PendingToolRecovery, error)
}

type boundFloretPendingToolRecoverySettler struct {
	open              func(context.Context, flruntime.PendingToolRecoveryTarget) (*flruntime.PendingToolRecovery, error)
	executionThreadID flruntime.ThreadID
	authorityThreadID flruntime.ThreadID
}

func (c *boundFloretPendingToolRecoveryCoordinator) Settle(
	ctx context.Context,
	executionThreadID string,
	authorityThreadID string,
	settle func(context.Context, floretPendingToolSettler) error,
) error {
	if c == nil || c.open == nil {
		return errors.New("Floret pending tool recovery coordinator is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	executionThreadID = strings.TrimSpace(executionThreadID)
	authorityThreadID = strings.TrimSpace(authorityThreadID)
	if executionThreadID == "" || authorityThreadID == "" {
		return errors.New("Floret pending tool recovery identity is incomplete")
	}
	if settle == nil {
		return errors.New("Floret pending tool recovery settlement is unavailable")
	}
	return settle(ctx, &boundFloretPendingToolRecoverySettler{
		open: c.open, executionThreadID: flruntime.ThreadID(executionThreadID),
		authorityThreadID: flruntime.ThreadID(authorityThreadID),
	})
}

func (s *boundFloretPendingToolRecoverySettler) SettlePendingTool(ctx context.Context, request flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if s == nil || s.open == nil {
		return flruntime.PendingToolSettlementResult{}, errors.New("Floret pending tool recovery settler is unavailable")
	}
	parentThreadID := flruntime.ThreadID("")
	if s.executionThreadID != s.authorityThreadID {
		parentThreadID = s.authorityThreadID
	}
	target := request.Target
	if target.ThreadID != s.executionThreadID {
		return flruntime.PendingToolSettlementResult{}, errors.New("Floret pending tool recovery target identity mismatch")
	}
	recovery, err := s.open(ctxOrBackground(ctx), flruntime.PendingToolRecoveryTarget{
		ParentThreadID: parentThreadID, Target: target,
	})
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	return recovery.Settle(ctxOrBackground(ctx), flruntime.PendingToolRecoveryRequest{
		Status: request.Status, Summary: request.Summary, Output: request.Output, Activity: request.Activity,
	})
}

type floretThreadRuntimeBinder func(flruntime.ThreadID) (floretThreadRuntimeCapabilities, error)

type floretThreadCreateAuthorityAdapter struct {
	create floretThreadCreateHostFactory
	title  floretThreadTitleHostFactory
}

func (a floretThreadCreateAuthorityAdapter) CreateThread(ctx context.Context, threadID flruntime.ThreadID, intentID flruntime.CreateIntentID) (flruntime.ThreadSummary, error) {
	handle, err := a.create(threadID, intentID)
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	return handle.Create(ctx)
}

func (a floretThreadCreateAuthorityAdapter) SetCreatedThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	handle, err := a.title(ctx, threadID)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return handle.Set(ctx, title)
}

type floretThreadTitleAuthorityAdapter struct {
	title floretThreadTitleHostFactory
}

func (a floretThreadTitleAuthorityAdapter) SetThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	handle, err := a.title(ctx, threadID)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return handle.Set(ctx, title)
}

type floretThreadForkAuthorityAdapter struct {
	fork  floretThreadForkHostFactory
	title floretThreadTitleHostFactory
}

func (a floretThreadForkAuthorityAdapter) ForkThread(ctx context.Context, operationID flruntime.ForkOperationID, sourceThreadID, destinationThreadID flruntime.ThreadID) (flruntime.ForkThreadResult, error) {
	handle, err := a.fork(ctx, sourceThreadID)
	if err != nil {
		return flruntime.ForkThreadResult{}, err
	}
	return handle.Fork(ctx, flruntime.ThreadForkRequest{OperationID: operationID, DestinationThreadID: destinationThreadID})
}

func (a floretThreadForkAuthorityAdapter) SetForkedThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	handle, err := a.title(ctx, threadID)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return handle.Set(ctx, title)
}

type floretThreadDeleteAuthorityAdapter struct {
	delete floretThreadDeleteHostFactory
}

func (a floretThreadDeleteAuthorityAdapter) DeleteThread(ctx context.Context, threadID flruntime.ThreadID) error {
	handle, err := a.delete(ctx, threadID)
	if err != nil {
		return err
	}
	return handle.Delete(ctx)
}

type floretThreadReadHostAdapter struct {
	reader *flruntime.ThreadReader
}

func (h floretThreadReadHostAdapter) ReadThread(ctx context.Context) (flruntime.ThreadSnapshot, error) {
	return h.reader.Read(ctx)
}

func (h floretThreadReadHostAdapter) ReadThreadOverview(ctx context.Context) (flruntime.ThreadOverview, error) {
	return h.reader.ReadOverview(ctx)
}

func (h floretThreadReadHostAdapter) ReadThreadTurn(ctx context.Context, turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return h.reader.ReadTurn(ctx, turnID)
}

func (h floretThreadReadHostAdapter) ListThreadTurns(ctx context.Context, request flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.reader.ListTurns(ctx, request)
}

func (h floretThreadReadHostAdapter) ReadThreadAgentTodos(ctx context.Context) (flruntime.ThreadAgentTodoState, error) {
	return h.reader.ReadAgentTodos(ctx)
}

func (h floretThreadReadHostAdapter) ReadThreadContext(ctx context.Context) (flruntime.ThreadContextSnapshot, error) {
	return h.reader.ReadContext(ctx)
}

func (h floretThreadReadHostAdapter) ReadTurnProjection(ctx context.Context, turnID flruntime.TurnID, runID flruntime.RunID) (flruntime.ThreadTurnProjection, error) {
	return h.reader.ReadProjection(ctx, turnID, runID)
}

type floretSubagentReadHostAdapter struct {
	reader *flruntime.SubAgentReader
}

func (h floretSubagentReadHostAdapter) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return h.reader.List(ctx)
}

func (h floretSubagentReadHostAdapter) ReadThreadTurn(ctx context.Context, childThreadID flruntime.ThreadID, turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return h.reader.ReadTurn(ctx, childThreadID, turnID)
}

func (h floretSubagentReadHostAdapter) ListThreadTurns(ctx context.Context, childThreadID flruntime.ThreadID, request flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.reader.ListTurns(ctx, childThreadID, request)
}

func (h floretSubagentReadHostAdapter) ReadSubAgentDetail(ctx context.Context, request flruntime.SubAgentDetailRequest) (flruntime.SubAgentDetail, error) {
	return h.reader.ReadDetail(ctx, request)
}

type floretTurnHostAdapter struct {
	runner   *flruntime.TurnRunner
	reader   *flruntime.ThreadReader
	threadID flruntime.ThreadID
}

func (h floretTurnHostAdapter) Run(ctx context.Context, request flruntime.TurnRequest) (flruntime.TurnResult, error) {
	return h.runner.Run(ctx, request)
}

func (h floretTurnHostAdapter) ReadApprovalQueue(ctx context.Context) (flruntime.ApprovalQueue, error) {
	return h.reader.ReadApprovalQueue(ctx)
}

func (h floretTurnHostAdapter) ResolveApproval(ctx context.Context, request flruntime.ApprovalResolutionRequest) (flruntime.ResolveApprovalResult, error) {
	return h.runner.ResolveApproval(ctx, request)
}

func (h floretTurnHostAdapter) SettlePendingTool(ctx context.Context, request flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if request.Target.ThreadID != h.threadID {
		return flruntime.PendingToolSettlementResult{}, errors.New("Floret pending tool settlement target identity mismatch")
	}
	return h.runner.SettlePendingTool(ctx, flruntime.ActivePendingToolSettlement{
		Target: flruntime.ActivePendingToolTarget{
			TurnID: request.Target.TurnID, RunID: request.Target.RunID, ToolCallID: request.Target.ToolCallID,
			ToolName: request.Target.ToolName, Handle: request.Target.Handle, EffectAttemptID: request.Target.EffectAttemptID,
		},
		Status: request.Status, Summary: request.Summary, Output: request.Output, Activity: request.Activity,
	})
}

func (h floretTurnHostAdapter) ReadThreadAgentTodos(ctx context.Context) (flruntime.ThreadAgentTodoState, error) {
	return h.reader.ReadAgentTodos(ctx)
}

func (h floretTurnHostAdapter) UpdateThreadAgentTodos(ctx context.Context, request flruntime.AgentTodoUpdateRequest) (flruntime.ThreadAgentTodoState, error) {
	return h.runner.UpdateAgentTodos(ctx, request)
}

type floretCompactionHostAdapter struct {
	compactor *flruntime.ThreadCompactor
}

func (h floretCompactionHostAdapter) Compact(ctx context.Context, request flruntime.ThreadCompactionRequest) (flruntime.CompactThreadResult, error) {
	return h.compactor.Compact(ctx, request)
}

type floretSubagentHostAdapter struct {
	manager *flruntime.SubAgentManager
	reader  *flruntime.SubAgentReader
}

func (h floretSubagentHostAdapter) SettlePendingTool(ctx context.Context, request flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return h.manager.SettlePendingTool(ctx, request)
}

func (h floretSubagentHostAdapter) SpawnSubAgent(ctx context.Context, request flruntime.SpawnSubAgent) (flruntime.SubAgentSnapshot, error) {
	return h.manager.Spawn(ctx, request)
}

func (h floretSubagentHostAdapter) SendSubAgentInput(ctx context.Context, request flruntime.SendSubAgentInput) (flruntime.SubAgentSnapshot, error) {
	return h.manager.SendInput(ctx, request)
}

func (h floretSubagentHostAdapter) WaitSubAgents(ctx context.Context, request flruntime.WaitSubAgents) (flruntime.WaitSubAgentsResult, error) {
	return h.manager.Wait(ctx, request)
}

func (h floretSubagentHostAdapter) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return h.reader.List(ctx)
}

func (h floretSubagentHostAdapter) CloseSubAgent(ctx context.Context, request flruntime.CloseSubAgent) (flruntime.SubAgentSnapshot, error) {
	return h.manager.Close(ctx, request)
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
	inventory *flruntime.ThreadInventory
}

func (a floretRootThreadInventoryAdapter) ListRootThreads(ctx context.Context, request flruntime.ListRootThreadsRequest) (flruntime.RootThreadsPage, error) {
	return a.inventory.List(ctx, request)
}

func configureFloretRuntime(host *flruntime.Host) (*floretBootstrapResult, floretStartupRecoveryCapabilities, error) {
	if host == nil {
		return nil, floretStartupRecoveryCapabilities{}, errors.New("Floret runtime Host is required")
	}
	inventory, err := host.ThreadInventory(context.Background())
	if err != nil {
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	rootInventory := floretRootThreadInventoryAdapter{inventory: inventory}
	result := &floretBootstrapResult{
		close: host.Close,
		pendingToolRecovery: &boundFloretPendingToolRecoveryCoordinator{
			open: func(ctx context.Context, target flruntime.PendingToolRecoveryTarget) (*flruntime.PendingToolRecovery, error) {
				return host.PendingToolRecovery(ctx, target, nil)
			},
		},
		newThreadRead: func(ctx context.Context, threadID flruntime.ThreadID) (floretThreadReadHost, error) {
			reader, err := host.ThreadReader(ctx, threadID)
			if err != nil {
				return nil, err
			}
			return floretThreadReadHostAdapter{reader: reader}, nil
		},
		newThreadCreate: func(threadID flruntime.ThreadID, createIntentID flruntime.CreateIntentID) (floretThreadCreateHost, error) {
			return host.ThreadCreator(threadID, createIntentID)
		},
		newThreadTitle: func(ctx context.Context, threadID flruntime.ThreadID) (floretThreadTitleHost, error) {
			return host.ThreadTitleEditor(ctx, threadID)
		},
		newThreadFork: func(ctx context.Context, threadID flruntime.ThreadID) (floretForkHost, error) {
			return host.ThreadForker(ctx, threadID)
		},
		newThreadDelete: func(ctx context.Context, threadID flruntime.ThreadID) (ThreadDeleteHost, error) {
			return host.ThreadDeleter(ctx, threadID)
		},
		bindThreadRuntime: func(threadID flruntime.ThreadID) (floretThreadRuntimeCapabilities, error) {
			return floretThreadRuntimeCapabilities{
				Turn: func(ctx context.Context, agent *flruntime.Agent) (floretTurnHost, error) {
					runner, err := host.TurnRunner(ctx, threadID, agent)
					if err != nil {
						return nil, err
					}
					reader, err := host.ThreadReader(ctx, threadID)
					if err != nil {
						return nil, err
					}
					return floretTurnHostAdapter{runner: runner, reader: reader, threadID: threadID}, nil
				},
				Compaction: func(ctx context.Context, agent *flruntime.Agent) (floretCompactionHost, error) {
					compactor, err := host.ThreadCompactor(ctx, threadID, agent)
					if err != nil {
						return nil, err
					}
					return floretCompactionHostAdapter{compactor: compactor}, nil
				},
				SubAgent: func(ctx context.Context, agent *flruntime.Agent) (floretSubagentHost, error) {
					manager, err := host.SubAgentManager(ctx, threadID, agent)
					if err != nil {
						return nil, err
					}
					reader, err := host.SubAgentReader(ctx, threadID)
					if err != nil {
						return nil, err
					}
					return floretSubagentHostAdapter{manager: manager, reader: reader}, nil
				},
			}, nil
		},
		newSubagentRead: func(ctx context.Context, parentThreadID flruntime.ThreadID) (floretSubagentReadHost, error) {
			reader, err := host.SubAgentReader(ctx, parentThreadID)
			if err != nil {
				return nil, err
			}
			return floretSubagentReadHostAdapter{reader: reader}, nil
		},
	}
	result.threadCreate = floretThreadCreateAuthorityAdapter{create: result.newThreadCreate, title: result.newThreadTitle}
	result.threadTitle = floretThreadTitleAuthorityAdapter{title: result.newThreadTitle}
	result.threadFork = floretThreadForkAuthorityAdapter{fork: result.newThreadFork, title: result.newThreadTitle}
	result.threadDelete = floretThreadDeleteAuthorityAdapter{delete: result.newThreadDelete}
	result.orphanRoots = &floretOrphanRootMaintenanceCoordinator{inventory: rootInventory, delete: result.threadDelete}
	recovery := floretStartupRecoveryCapabilities{
		inventory: rootInventory,
		root: func(ctx context.Context, threadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			handle, err := host.InterruptedTurnRecovery(ctx, flruntime.InterruptedTurnRecoveryTarget{ThreadID: threadID}, nil)
			if err != nil {
				return nil, err
			}
			return floretInterruptedTurnRecoveryHostFactoryAdapter{recovery: handle}, nil
		},
		subagent: func(ctx context.Context, parentThreadID flruntime.ThreadID, childThreadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			handle, err := host.InterruptedTurnRecovery(ctx, flruntime.InterruptedTurnRecoveryTarget{
				ParentThreadID: parentThreadID, ThreadID: childThreadID,
			}, nil)
			if err != nil {
				return nil, err
			}
			return floretInterruptedTurnRecoveryHostFactoryAdapter{recovery: handle}, nil
		},
		listSubagents: result.newSubagentRead,
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
		_ = host.Close()
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	return result, recovery, nil
}
