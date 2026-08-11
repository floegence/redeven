package ai

import (
	"context"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	fltools "github.com/floegence/floret/v3/tools"
)

type floretTurnRunnerOpener func(context.Context, *flruntime.Agent) (floretTurnHost, error)

type floretCompactorOpener func(context.Context, *flruntime.Agent) (floretCompactionHost, error)

type floretSubagentManagerOpener func(context.Context, *flruntime.Agent) (floretSubagentHost, error)

type floretThreadRuntimeCapabilities struct {
	Turn       floretTurnRunnerOpener
	Compaction floretCompactorOpener
	SubAgent   floretSubagentManagerOpener
}

type floretThreadReadHostFactory func(context.Context, identity.ThreadID) (floretThreadReadHost, error)

type floretSubagentReadHostFactory func(context.Context, identity.ThreadID) (floretSubagentReadHost, error)

type floretThreadCreateAuthority interface {
	CreateThread(context.Context, identity.LogicalRequestID) (flruntime.CreateThreadResult, error)
	SetCreatedThreadTitle(context.Context, identity.ThreadID, flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error)
}

type floretThreadTitleAuthority interface {
	SetThreadTitle(context.Context, identity.ThreadID, flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error)
}

type floretThreadForkAuthority interface {
	ForkThread(context.Context, identity.ThreadID, flruntime.ForkThreadCommand) (flruntime.ForkThreadResultV3, error)
	SetForkedThreadTitle(context.Context, identity.ThreadID, flruntime.SetThreadTitleCommand) (flruntime.SetThreadTitleResult, error)
}

type floretThreadDeleteAuthority interface {
	DeleteThread(context.Context, identity.ThreadID, flruntime.DeleteThreadCommand) error
}

type floretInterruptedTurnRecoveryHost interface {
	Recover(context.Context) (flruntime.RecoverInterruptedTurnResult, error)
}

type floretInterruptedTurnRecoveryHostFactory interface {
	NewHost(context.Context) (floretInterruptedTurnRecoveryHost, error)
}

type floretRootTurnRecoveryBinder func(context.Context, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretSubagentTurnRecoveryBinder func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error)

type floretTurnRunner interface {
	AdmitTurn(context.Context, flruntime.StartTurnCommand) (flruntime.AdmitTurnResult, error)
	ExecuteAdmission(context.Context, flruntime.TurnAdmissionReceipt, flruntime.ExecutionContext) (flruntime.StartTurnResult, error)
	RetryTurn(context.Context, flruntime.RetryTurnCommand) (flruntime.RetryTurnResult, error)
	ReadTurn(context.Context, identity.TurnID) (flruntime.ThreadTurnSnapshot, error)
}

type floretTurnHost interface {
	floretTurnRunner
	floretActiveRunHost
}

type floretApprovalAuthority interface {
	ReadApprovalQueue(context.Context) (flruntime.ApprovalQueue, error)
	ResolveApproval(context.Context, flruntime.ResolveApprovalCommand) (flruntime.ResolveApprovalResult, error)
}

type floretPendingToolSettlementRequest struct {
	LogicalRequestID identity.LogicalRequestID
	Target           flruntime.PendingToolSettlementTarget
	Status           flruntime.PendingToolSettlementStatus
	Summary          string
	Output           string
	Activity         *fltools.ActivityPresentation
}

type floretPendingToolSettler interface {
	SettlePendingTool(context.Context, floretPendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
}

type floretActiveRunHost interface {
	floretApprovalAuthority
	floretPendingToolSettler
	ReadThreadAgentTodos(context.Context) (flruntime.ThreadAgentTodoState, error)
	UpdateThreadAgentTodos(context.Context, flruntime.UpdateTodosCommand) (flruntime.ThreadAgentTodoState, error)
}

type floretCompactionHost interface {
	Compact(context.Context, flruntime.CompactThreadCommand) (flruntime.CompactThreadResult, error)
}

type floretThreadReadHost interface {
	ReadThread(context.Context) (flruntime.ThreadSnapshot, error)
	Bootstrap(context.Context, flruntime.ThreadBootstrapRequest) (flruntime.ThreadBootstrap, error)
	ReadThreadOverview(context.Context) (flruntime.ThreadOverview, error)
	ReadThreadTurn(context.Context, identity.TurnID) (flruntime.ThreadTurnSnapshot, error)
	ListThreadTurns(context.Context, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
	ReadThreadAgentTodos(context.Context) (flruntime.ThreadAgentTodoState, error)
	ReadThreadContext(context.Context) (flruntime.ThreadContextSnapshot, error)
	ReadTurnProjection(context.Context, identity.TurnID, identity.RunID) (flruntime.ThreadTurnProjection, error)
}

type floretSubagentReadHost interface {
	ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error)
	ReadThreadTurn(context.Context, identity.ThreadID, identity.TurnID) (flruntime.ThreadTurnSnapshot, error)
	ListThreadTurns(context.Context, identity.ThreadID, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
	ReadSubAgentDetail(context.Context, identity.ThreadID, flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error)
}

type FlowerReadStateCleaner interface {
	RetireFlowerThreadReadState(context.Context, string, string) error
}

type floretSubagentHost interface {
	floretPendingToolSettler
	SpawnSubAgent(context.Context, flruntime.SpawnSubAgentCommand) (flruntime.SubAgentSnapshot, error)
	SendSubAgentInput(context.Context, flruntime.SendSubAgentMessageCommand) (flruntime.SubAgentSnapshot, error)
	InterruptSubAgent(context.Context, flruntime.InterruptSubAgentCommand) (flruntime.SubAgentSnapshot, error)
	WaitSubAgents(context.Context, flruntime.WaitSubAgentsCommand) (flruntime.WaitSubAgentsResult, error)
	ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error)
	CloseSubAgent(context.Context, flruntime.CloseSubAgentCommand) (flruntime.SubAgentSnapshot, error)
}
