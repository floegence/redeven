package ai

import (
	"context"

	flruntime "github.com/floegence/floret/v2/runtime"
)

type floretTurnRunnerOpener func(context.Context, *flruntime.Agent) (floretTurnHost, error)

type floretCompactorOpener func(context.Context, *flruntime.Agent) (floretCompactionHost, error)

type floretSubagentManagerOpener func(context.Context, *flruntime.Agent) (floretSubagentHost, error)

type floretThreadRuntimeCapabilities struct {
	Turn       floretTurnRunnerOpener
	Compaction floretCompactorOpener
	SubAgent   floretSubagentManagerOpener
}

type floretThreadReadHostFactory func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error)

type floretSubagentReadHostFactory func(context.Context, flruntime.ThreadID) (floretSubagentReadHost, error)

type floretThreadCreateHostFactory func(flruntime.ThreadID, flruntime.CreateIntentID) (floretThreadCreateHost, error)

type floretThreadTitleHostFactory func(context.Context, flruntime.ThreadID) (floretThreadTitleHost, error)

type floretThreadForkHostFactory func(context.Context, flruntime.ThreadID) (floretForkHost, error)

type floretThreadDeleteHostFactory func(context.Context, flruntime.ThreadID) (ThreadDeleteHost, error)

type floretThreadCreateAuthority interface {
	CreateThread(context.Context, flruntime.ThreadID, flruntime.CreateIntentID) (flruntime.ThreadSummary, error)
	SetCreatedThreadTitle(context.Context, flruntime.ThreadID, string) (flruntime.ThreadSnapshot, error)
}

type floretThreadTitleAuthority interface {
	SetThreadTitle(context.Context, flruntime.ThreadID, string) (flruntime.ThreadSnapshot, error)
}

type floretThreadForkAuthority interface {
	ForkThread(context.Context, flruntime.ForkOperationID, flruntime.ThreadID, flruntime.ThreadID) (flruntime.ForkThreadResult, error)
	SetForkedThreadTitle(context.Context, flruntime.ThreadID, string) (flruntime.ThreadSnapshot, error)
}

type floretThreadDeleteAuthority interface {
	DeleteThread(context.Context, flruntime.ThreadID) error
}

type floretInterruptedTurnRecoveryHost interface {
	Recover(context.Context) (flruntime.RecoverInterruptedTurnResult, error)
}

type floretInterruptedTurnRecoveryHostFactory interface {
	NewHost(context.Context) (floretInterruptedTurnRecoveryHost, error)
}

type floretRootTurnRecoveryBinder func(context.Context, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretSubagentTurnRecoveryBinder func(context.Context, flruntime.ThreadID, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretThreadCreateHost interface {
	Create(context.Context) (flruntime.ThreadSummary, error)
}

type floretTurnRunner interface {
	Run(context.Context, flruntime.TurnRequest) (flruntime.TurnResult, error)
}

type floretTurnHost interface {
	floretTurnRunner
	floretActiveRunHost
}

type floretApprovalAuthority interface {
	ReadApprovalQueue(context.Context) (flruntime.ApprovalQueue, error)
	ResolveApproval(context.Context, flruntime.ApprovalResolutionRequest) (flruntime.ResolveApprovalResult, error)
}

type floretPendingToolSettler interface {
	SettlePendingTool(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
}

type floretActiveRunHost interface {
	floretApprovalAuthority
	floretPendingToolSettler
	ReadThreadAgentTodos(context.Context) (flruntime.ThreadAgentTodoState, error)
	UpdateThreadAgentTodos(context.Context, flruntime.AgentTodoUpdateRequest) (flruntime.ThreadAgentTodoState, error)
}

type floretForkHost interface {
	Fork(context.Context, flruntime.ThreadForkRequest) (flruntime.ForkThreadResult, error)
}

type floretCompactionHost interface {
	Compact(context.Context, flruntime.ThreadCompactionRequest) (flruntime.CompactThreadResult, error)
}

type floretThreadReadHost interface {
	ReadThread(context.Context) (flruntime.ThreadSnapshot, error)
	ReadThreadOverview(context.Context) (flruntime.ThreadOverview, error)
	ReadThreadTurn(context.Context, flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error)
	ListThreadTurns(context.Context, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
	ReadThreadAgentTodos(context.Context) (flruntime.ThreadAgentTodoState, error)
	ReadThreadContext(context.Context) (flruntime.ThreadContextSnapshot, error)
	ReadTurnProjection(context.Context, flruntime.TurnID, flruntime.RunID) (flruntime.ThreadTurnProjection, error)
}

type floretSubagentReadHost interface {
	ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error)
	ReadThreadTurn(context.Context, flruntime.ThreadID, flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error)
	ListThreadTurns(context.Context, flruntime.ThreadID, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
	ReadSubAgentDetail(context.Context, flruntime.SubAgentDetailRequest) (flruntime.SubAgentDetail, error)
}

type floretThreadTitleHost interface {
	Set(context.Context, string) (flruntime.ThreadSnapshot, error)
}

type ThreadDeleteHost interface {
	Delete(context.Context) error
}

type FlowerReadStateCleaner interface {
	RetireFlowerThreadReadState(context.Context, string, string) error
}

type floretSubagentHost interface {
	SettlePendingTool(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
	SpawnSubAgent(context.Context, flruntime.SpawnSubAgent) (flruntime.SubAgentSnapshot, error)
	SendSubAgentInput(context.Context, flruntime.SendSubAgentInput) (flruntime.SubAgentSnapshot, error)
	WaitSubAgents(context.Context, flruntime.WaitSubAgents) (flruntime.WaitSubAgentsResult, error)
	ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error)
	CloseSubAgent(context.Context, flruntime.CloseSubAgent) (flruntime.SubAgentSnapshot, error)
}
