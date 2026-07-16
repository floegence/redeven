package ai

import (
	"context"

	flruntime "github.com/floegence/floret/runtime"
)

type floretThreadEnsurer interface {
	EnsureThread(context.Context, flruntime.EnsureThreadRequest) (flruntime.ThreadSummary, error)
}

type floretTurnRunner interface {
	RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error)
}

type floretTurnHost interface {
	floretThreadEnsurer
	floretTurnRunner
	floretActiveRunHost
	floretSubagentsCloser
}

type floretProjectionReader interface {
	ReadTurnProjection(context.Context, flruntime.ReadTurnProjectionRequest) (flruntime.ThreadTurnProjection, error)
}

type floretPendingApprovalLister interface {
	ListPendingApprovals(context.Context, flruntime.ListPendingApprovalsRequest) (flruntime.PendingApprovals, error)
}

type floretPendingToolSettler interface {
	SettlePendingTool(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
}

type floretActiveRunHost interface {
	floretPendingApprovalLister
	floretPendingToolSettler
}

type floretSubagentsCloser interface {
	CloseSubAgents(context.Context, flruntime.CloseSubAgentsRequest) (flruntime.CloseSubAgentsResult, error)
}

type floretForkHost interface {
	ForkThread(context.Context, flruntime.ForkThreadRequest) (flruntime.ForkThreadResult, error)
}

type ThreadMaintenanceHost interface {
	DeleteThread(context.Context, flruntime.ThreadID) error
	Close() error
}

type FlowerReadStateCleaner interface {
	DeleteFlowerThreadReadState(context.Context, string, string) error
}

type floretSubagentHost interface {
	floretThreadEnsurer
	floretPendingToolSettler
	floretSubagentsCloser
	SpawnSubAgent(context.Context, flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error)
	SendSubAgentInput(context.Context, flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error)
	WaitSubAgents(context.Context, flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error)
	ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error)
	CloseSubAgent(context.Context, flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error)
	ReadSubAgentDetail(context.Context, flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error)
	DeleteThread(context.Context, flruntime.ThreadID) error
	Close() error
}
