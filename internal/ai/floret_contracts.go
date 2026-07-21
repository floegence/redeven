package ai

import (
	"context"

	flruntime "github.com/floegence/floret/runtime"
)

type floretHostFactory func(context.Context, flruntime.TurnExecutionHostOptions) (floretTurnHost, error)

type floretCompactionHostFactory func(context.Context, flruntime.ThreadCompactionHostOptions) (floretCompactionHost, error)

type floretSubagentHostFactory func(context.Context, flruntime.SubAgentHostOptions) (floretSubagentHost, error)

type floretThreadRuntimeCapabilities struct {
	Turn       floretHostFactory
	Compaction floretCompactionHostFactory
	SubAgent   floretSubagentHostFactory
}

type floretThreadReadHostFactory func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error)

type floretSubagentReadHostFactory func(context.Context, flruntime.ThreadID) (floretSubagentReadHost, error)

type floretThreadCreateHostFactory func(flruntime.ThreadID, flruntime.CreateIntentID) (floretThreadCreateHost, error)

type floretThreadTitleHostFactory func(context.Context, flruntime.ThreadID, flruntime.EventSink) (floretThreadTitleHost, error)

type floretThreadForkHostFactory func(context.Context, flruntime.ThreadID, flruntime.EventSink) (floretForkHost, error)

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
	RecoverInterruptedTurn(context.Context) (flruntime.RecoverInterruptedTurnResult, error)
}

type floretInterruptedTurnRecoveryHostFactory interface {
	NewHost(context.Context) (floretInterruptedTurnRecoveryHost, error)
}

type floretRootTurnRecoveryBinder func(context.Context, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretSubagentTurnRecoveryBinder func(context.Context, flruntime.ThreadID, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretThreadCreateHost interface {
	CreateThread(context.Context, flruntime.CreateThreadRequest) (flruntime.ThreadSummary, error)
}

type floretTurnRunner interface {
	RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error)
}

type floretTurnHost interface {
	floretTurnRunner
	floretActiveRunHost
}

type floretApprovalAuthority interface {
	ReadApprovalQueue(context.Context, flruntime.ReadApprovalQueueRequest) (flruntime.ApprovalQueue, error)
	ResolveApproval(context.Context, flruntime.ResolveApprovalRequest) (flruntime.ResolveApprovalResult, error)
}

type floretPendingToolSettler interface {
	SettlePendingTool(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
}

type floretActiveRunHost interface {
	floretApprovalAuthority
	floretPendingToolSettler
	ReadThreadAgentTodos(context.Context, flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error)
	UpdateThreadAgentTodos(context.Context, flruntime.UpdateThreadAgentTodosRequest) (flruntime.ThreadAgentTodoState, error)
}

type floretForkHost interface {
	ForkThread(context.Context, flruntime.ForkThreadRequest) (flruntime.ForkThreadResult, error)
}

type floretCompactionHost interface {
	CompactThread(context.Context, flruntime.CompactThreadRequest) (flruntime.CompactThreadResult, error)
}

type floretThreadReadHost interface {
	ReadThread(context.Context, flruntime.ThreadID) (flruntime.ThreadSnapshot, error)
	ReadThreadOverview(context.Context, flruntime.ThreadID) (flruntime.ThreadOverview, error)
	ListThreadTurns(context.Context, flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
	ReadThreadAgentTodos(context.Context, flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error)
	ReadThreadContext(context.Context, flruntime.ThreadID) (flruntime.ThreadContextSnapshot, error)
	ReadTurnProjection(context.Context, flruntime.ReadTurnProjectionRequest) (flruntime.ThreadTurnProjection, error)
}

type floretSubagentReadHost interface {
	ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error)
	ReadSubAgentDetail(context.Context, flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error)
}

type floretThreadTitleHost interface {
	SetThreadTitle(context.Context, flruntime.SetThreadTitleRequest) (flruntime.ThreadSnapshot, error)
}

type ThreadDeleteHost interface {
	DeleteThread(context.Context, flruntime.ThreadID) error
}

type FlowerReadStateCleaner interface {
	RetireFlowerThreadReadState(context.Context, string, string) error
}

type floretSubagentHost interface {
	floretPendingToolSettler
	SpawnSubAgent(context.Context, flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error)
	SendSubAgentInput(context.Context, flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error)
	WaitSubAgents(context.Context, flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error)
	ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error)
	CloseSubAgent(context.Context, flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error)
}
