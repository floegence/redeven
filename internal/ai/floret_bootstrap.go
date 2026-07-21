package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
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
}

type floretStartupRecoveryCapabilities struct {
	root          floretRootTurnRecoveryBinder
	subagent      floretSubagentTurnRecoveryBinder
	listSubagents floretSubagentReadHostFactory
}

type boundFloretPendingToolRecoveryCoordinator struct {
	binder *flruntime.PendingToolRecoveryHostBinder
}

func newFloretPendingToolRecoveryCoordinator(bootstrap *flruntime.HostBootstrap) (floretPendingToolRecoveryCoordinator, error) {
	binder, err := flruntime.NewPendingToolRecoveryHostBinder(bootstrap)
	if err != nil {
		return nil, err
	}
	return &boundFloretPendingToolRecoveryCoordinator{binder: binder}, nil
}

func (c *boundFloretPendingToolRecoveryCoordinator) Settle(
	ctx context.Context,
	executionThreadID string,
	authorityThreadID string,
	settle func(context.Context, floretPendingToolSettler) error,
) error {
	if c == nil || c.binder == nil {
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
	var owner floretPendingToolSettler
	var err error
	if executionThreadID == authorityThreadID {
		owner, err = c.binder.NewThreadHost(ctx, flruntime.ThreadID(executionThreadID), nil)
	} else {
		owner, err = c.binder.NewSubAgentHost(ctx, flruntime.ThreadID(authorityThreadID), nil)
	}
	if err != nil {
		return err
	}
	if owner == nil {
		return errors.New("Floret pending tool recovery owner is unavailable")
	}
	return settle(ctx, owner)
}

type floretThreadRuntimeBinder func(flruntime.ThreadID) (floretThreadRuntimeCapabilities, error)

type floretThreadCreateAuthorityAdapter struct {
	create floretThreadCreateHostFactory
	title  floretThreadTitleHostFactory
}

func (a floretThreadCreateAuthorityAdapter) CreateThread(ctx context.Context, threadID flruntime.ThreadID, intentID flruntime.CreateIntentID) (flruntime.ThreadSummary, error) {
	host, err := a.create(threadID, intentID)
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	return host.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: threadID, CreateIntentID: intentID})
}

func (a floretThreadCreateAuthorityAdapter) SetCreatedThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	host, err := a.title(ctx, threadID, nil)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return host.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: threadID, Title: title})
}

type floretThreadTitleAuthorityAdapter struct {
	title floretThreadTitleHostFactory
}

func (a floretThreadTitleAuthorityAdapter) SetThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	host, err := a.title(ctx, threadID, nil)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return host.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: threadID, Title: title})
}

type floretThreadForkAuthorityAdapter struct {
	fork  floretThreadForkHostFactory
	title floretThreadTitleHostFactory
}

func (a floretThreadForkAuthorityAdapter) ForkThread(ctx context.Context, operationID flruntime.ForkOperationID, sourceThreadID, destinationThreadID flruntime.ThreadID) (flruntime.ForkThreadResult, error) {
	host, err := a.fork(ctx, sourceThreadID, nil)
	if err != nil {
		return flruntime.ForkThreadResult{}, err
	}
	return host.ForkThread(ctx, flruntime.ForkThreadRequest{OperationID: operationID, SourceThreadID: sourceThreadID, DestinationThreadID: destinationThreadID})
}

func (a floretThreadForkAuthorityAdapter) SetForkedThreadTitle(ctx context.Context, threadID flruntime.ThreadID, title string) (flruntime.ThreadSnapshot, error) {
	host, err := a.title(ctx, threadID, nil)
	if err != nil {
		return flruntime.ThreadSnapshot{}, err
	}
	return host.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: threadID, Title: title})
}

type floretThreadDeleteAuthorityAdapter struct {
	delete floretThreadDeleteHostFactory
}

func (a floretThreadDeleteAuthorityAdapter) DeleteThread(ctx context.Context, threadID flruntime.ThreadID) error {
	host, err := a.delete(ctx, threadID)
	if err != nil {
		return err
	}
	return host.DeleteThread(ctx, threadID)
}

type floretTurnHostAdapter struct {
	host     *flruntime.TurnExecutionHost
	read     floretThreadReadHost
	threadID flruntime.ThreadID
}

type floretThreadReadHostAdapter struct {
	host *flruntime.ThreadReadHost
}

func (h floretThreadReadHostAdapter) ReadThread(ctx context.Context, id flruntime.ThreadID) (flruntime.ThreadSnapshot, error) {
	return h.host.ReadThread(ctx, id)
}

func (h floretThreadReadHostAdapter) ReadThreadOverview(ctx context.Context, id flruntime.ThreadID) (flruntime.ThreadOverview, error) {
	return h.host.ReadThreadOverview(ctx, id)
}

func (h floretThreadReadHostAdapter) ListThreadTurns(ctx context.Context, req flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.host.ListThreadTurns(ctx, req)
}

func (h floretThreadReadHostAdapter) ReadThreadAgentTodos(ctx context.Context, id flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error) {
	return h.host.ReadThreadAgentTodos(ctx, id)
}

func (h floretThreadReadHostAdapter) ReadThreadContext(ctx context.Context, id flruntime.ThreadID) (flruntime.ThreadContextSnapshot, error) {
	return h.host.ReadThreadContext(ctx, id)
}

func (h floretThreadReadHostAdapter) ReadTurnProjection(ctx context.Context, req flruntime.ReadTurnProjectionRequest) (flruntime.ThreadTurnProjection, error) {
	return h.host.ReadTurnProjection(ctx, req)
}

type floretSubagentReadHostAdapter struct {
	host *flruntime.SubAgentReadHost
}

type floretInterruptedTurnRecoveryHostFactoryAdapter struct {
	factory *flruntime.InterruptedTurnRecoveryHostFactory
}

func (f floretInterruptedTurnRecoveryHostFactoryAdapter) NewHost(ctx context.Context) (floretInterruptedTurnRecoveryHost, error) {
	if f.factory == nil {
		return nil, errors.New("Floret interrupted-turn recovery factory is unavailable")
	}
	return f.factory.NewHost(ctx, nil)
}

func (h floretSubagentReadHostAdapter) ListSubAgents(ctx context.Context, parentThreadID flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	return h.host.ListSubAgents(ctx, parentThreadID)
}

func (h floretSubagentReadHostAdapter) ReadSubAgentDetail(ctx context.Context, req flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error) {
	return h.host.ReadSubAgentDetail(ctx, req)
}

func (h floretTurnHostAdapter) RunTurn(ctx context.Context, req flruntime.RunTurnRequest) (flruntime.TurnResult, error) {
	return h.host.RunTurn(ctx, req)
}
func (h floretTurnHostAdapter) ReadApprovalQueue(ctx context.Context, req flruntime.ReadApprovalQueueRequest) (flruntime.ApprovalQueue, error) {
	return h.host.ReadApprovalQueue(ctx, req)
}
func (h floretTurnHostAdapter) ResolveApproval(ctx context.Context, req flruntime.ResolveApprovalRequest) (flruntime.ResolveApprovalResult, error) {
	return h.host.ResolveApproval(ctx, req)
}
func (h floretTurnHostAdapter) SettlePendingTool(ctx context.Context, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return h.host.SettlePendingTool(ctx, req)
}
func (h floretTurnHostAdapter) ReadThreadAgentTodos(ctx context.Context, id flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error) {
	if strings.TrimSpace(string(id)) != strings.TrimSpace(string(h.threadID)) {
		return flruntime.ThreadAgentTodoState{}, errors.New("Floret turn host todo read authority mismatch")
	}
	return h.read.ReadThreadAgentTodos(ctx, id)
}
func (h floretTurnHostAdapter) UpdateThreadAgentTodos(ctx context.Context, req flruntime.UpdateThreadAgentTodosRequest) (flruntime.ThreadAgentTodoState, error) {
	return h.host.UpdateThreadAgentTodos(ctx, req)
}

type floretCompactionHostAdapter struct {
	host *flruntime.ThreadCompactionHost
}

func (h floretCompactionHostAdapter) CompactThread(ctx context.Context, req flruntime.CompactThreadRequest) (flruntime.CompactThreadResult, error) {
	return h.host.CompactThread(ctx, req)
}

type floretSubagentHostAdapter struct {
	host *flruntime.SubAgentHost
	read floretSubagentReadHost
}

func (h floretSubagentHostAdapter) SettlePendingTool(ctx context.Context, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return h.host.SettlePendingTool(ctx, req)
}
func (h floretSubagentHostAdapter) SpawnSubAgent(ctx context.Context, req flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	return h.host.SpawnSubAgent(ctx, req)
}
func (h floretSubagentHostAdapter) SendSubAgentInput(ctx context.Context, req flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error) {
	return h.host.SendSubAgentInput(ctx, req)
}
func (h floretSubagentHostAdapter) WaitSubAgents(ctx context.Context, req flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error) {
	return h.host.WaitSubAgents(ctx, req)
}
func (h floretSubagentHostAdapter) ListSubAgents(ctx context.Context, id flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	return h.read.ListSubAgents(ctx, id)
}
func (h floretSubagentHostAdapter) CloseSubAgent(ctx context.Context, req flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	return h.host.CloseSubAgent(ctx, req)
}

func configureFloretRuntime(store *flruntime.Store) (*floretBootstrapResult, floretStartupRecoveryCapabilities, error) {
	if store == nil {
		return nil, floretStartupRecoveryCapabilities{}, errors.New("floret store is required")
	}
	var (
		threadReadBinder       *flruntime.ThreadReadHostBinder
		threadCreateBinder     *flruntime.ThreadCreateHostBinder
		threadTitleBinder      *flruntime.ThreadTitleHostBinder
		threadForkBinder       *flruntime.ThreadForkHostBinder
		threadDeleteBinder     *flruntime.ThreadDeleteHostBinder
		turnBinder             *flruntime.TurnExecutionHostBinder
		compactionBinder       *flruntime.ThreadCompactionHostBinder
		subagentBinder         *flruntime.SubAgentHostBinder
		subagentReadBinder     *flruntime.SubAgentReadHostBinder
		pendingToolCoordinator floretPendingToolRecoveryCoordinator
		recoveryBinder         *flruntime.InterruptedTurnRecoveryHostBinder
	)
	err := flruntime.ConfigureHostCapabilities(store, func(bootstrap *flruntime.HostBootstrap) error {
		var err error
		if threadReadBinder, err = flruntime.NewThreadReadHostBinder(bootstrap); err != nil {
			return err
		}
		if threadCreateBinder, err = flruntime.NewThreadCreateHostBinder(bootstrap); err != nil {
			return err
		}
		if threadTitleBinder, err = flruntime.NewThreadTitleHostBinder(bootstrap); err != nil {
			return err
		}
		if threadForkBinder, err = flruntime.NewThreadForkHostBinder(bootstrap); err != nil {
			return err
		}
		if threadDeleteBinder, err = flruntime.NewThreadDeleteHostBinder(bootstrap); err != nil {
			return err
		}
		if turnBinder, err = flruntime.NewTurnExecutionHostBinder(bootstrap); err != nil {
			return err
		}
		if compactionBinder, err = flruntime.NewThreadCompactionHostBinder(bootstrap); err != nil {
			return err
		}
		if subagentBinder, err = flruntime.NewSubAgentHostBinder(bootstrap); err != nil {
			return err
		}
		if subagentReadBinder, err = flruntime.NewSubAgentReadHostBinder(bootstrap); err != nil {
			return err
		}
		if pendingToolCoordinator, err = newFloretPendingToolRecoveryCoordinator(bootstrap); err != nil {
			return err
		}
		if recoveryBinder, err = flruntime.NewInterruptedTurnRecoveryHostBinder(bootstrap); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	result := &floretBootstrapResult{
		close:               store.Close,
		pendingToolRecovery: pendingToolCoordinator,
		newThreadRead: func(ctx context.Context, threadID flruntime.ThreadID) (floretThreadReadHost, error) {
			host, err := threadReadBinder.NewHost(ctx, threadID)
			if err != nil {
				return nil, err
			}
			return floretThreadReadHostAdapter{host: host}, nil
		},
		newThreadCreate: func(threadID flruntime.ThreadID, createIntentID flruntime.CreateIntentID) (floretThreadCreateHost, error) {
			return threadCreateBinder.Bind(threadID, createIntentID)
		},
		newThreadTitle: func(ctx context.Context, threadID flruntime.ThreadID, sink flruntime.EventSink) (floretThreadTitleHost, error) {
			return threadTitleBinder.NewHost(ctx, threadID, sink)
		},
		newThreadFork: func(ctx context.Context, threadID flruntime.ThreadID, sink flruntime.EventSink) (floretForkHost, error) {
			return threadForkBinder.NewHost(ctx, threadID, sink)
		},
		newThreadDelete: func(ctx context.Context, threadID flruntime.ThreadID) (ThreadDeleteHost, error) {
			return threadDeleteBinder.NewHost(ctx, threadID)
		},
		bindThreadRuntime: func(threadID flruntime.ThreadID) (floretThreadRuntimeCapabilities, error) {
			turnFactory, err := turnBinder.Bind(threadID)
			if err != nil {
				return floretThreadRuntimeCapabilities{}, err
			}
			compactionFactory, err := compactionBinder.Bind(threadID)
			if err != nil {
				return floretThreadRuntimeCapabilities{}, err
			}
			subagentFactory, err := subagentBinder.Bind(threadID)
			if err != nil {
				return floretThreadRuntimeCapabilities{}, err
			}
			return floretThreadRuntimeCapabilities{
				Turn: func(ctx context.Context, opts flruntime.TurnExecutionHostOptions) (floretTurnHost, error) {
					read, err := threadReadBinder.NewHost(ctx, threadID)
					if err != nil {
						return nil, err
					}
					host, err := turnFactory.NewHost(ctx, opts)
					if err != nil {
						return nil, err
					}
					return floretTurnHostAdapter{host: host, read: read, threadID: threadID}, nil
				},
				Compaction: func(ctx context.Context, opts flruntime.ThreadCompactionHostOptions) (floretCompactionHost, error) {
					host, err := compactionFactory.NewHost(ctx, opts)
					if err != nil {
						return nil, err
					}
					return floretCompactionHostAdapter{host: host}, nil
				},
				SubAgent: func(ctx context.Context, opts flruntime.SubAgentHostOptions) (floretSubagentHost, error) {
					host, err := subagentFactory.NewHost(ctx, opts)
					if err != nil {
						return nil, err
					}
					read, err := subagentReadBinder.NewHost(ctx, threadID)
					if err != nil {
						return nil, err
					}
					return floretSubagentHostAdapter{host: host, read: read}, nil
				},
			}, nil
		},
		newSubagentRead: func(ctx context.Context, parentThreadID flruntime.ThreadID) (floretSubagentReadHost, error) {
			host, err := subagentReadBinder.NewHost(ctx, parentThreadID)
			if err != nil {
				return nil, err
			}
			return floretSubagentReadHostAdapter{host: host}, nil
		},
	}
	result.threadCreate = floretThreadCreateAuthorityAdapter{create: result.newThreadCreate, title: result.newThreadTitle}
	result.threadTitle = floretThreadTitleAuthorityAdapter{title: result.newThreadTitle}
	result.threadFork = floretThreadForkAuthorityAdapter{fork: result.newThreadFork, title: result.newThreadTitle}
	result.threadDelete = floretThreadDeleteAuthorityAdapter{delete: result.newThreadDelete}
	recovery := floretStartupRecoveryCapabilities{
		root: func(ctx context.Context, threadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			factory, err := recoveryBinder.BindThread(ctx, threadID)
			if err != nil {
				return nil, err
			}
			return floretInterruptedTurnRecoveryHostFactoryAdapter{factory: factory}, nil
		},
		subagent: func(ctx context.Context, parentThreadID flruntime.ThreadID, childThreadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			factory, err := recoveryBinder.BindSubAgent(ctx, parentThreadID, childThreadID)
			if err != nil {
				return nil, err
			}
			return floretInterruptedTurnRecoveryHostFactoryAdapter{factory: factory}, nil
		},
		listSubagents: func(ctx context.Context, parentThreadID flruntime.ThreadID) (floretSubagentReadHost, error) {
			host, err := subagentReadBinder.NewHost(ctx, parentThreadID)
			if err != nil {
				return nil, err
			}
			return floretSubagentReadHostAdapter{host: host}, nil
		},
	}
	return result, recovery, nil
}

func newFloretBootstrapResult(store *flruntime.Store) (*floretBootstrapResult, error) {
	result, _, err := configureFloretRuntime(store)
	return result, err
}

func openFloretRuntime(storePath string) (*floretBootstrapResult, floretStartupRecoveryCapabilities, error) {
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	result, recovery, err := configureFloretRuntime(store)
	if err != nil {
		_ = store.Close()
		return nil, floretStartupRecoveryCapabilities{}, err
	}
	return result, recovery, nil
}
