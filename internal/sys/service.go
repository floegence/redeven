package sys

import (
	"context"
	"strings"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// TypeID_SYS_PING is a lightweight, side-effect-free health check RPC for Env App.
	//
	// NOTE: The type_id must match Env App: internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_SYS_PING uint32 = 4001

	// TypeID_SYS_UPGRADE triggers an in-place self-upgrade (download latest + restart).
	//
	// NOTE: The type_id must match Env App: internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_SYS_UPGRADE uint32 = 4002

	// TypeID_SYS_RESTART restarts the agent process (best-effort).
	//
	// NOTE: The type_id must match Env App: internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_SYS_RESTART uint32 = 4003
)

type Upgrader interface {
	StartUpgrade(ctx context.Context, meta *session.Meta, req *UpgradeRequest) (*UpgradeResponse, error)
}

type UpgradeRequest struct {
	DryRun        *bool  `json:"dry_run,omitempty"`
	TargetVersion string `json:"target_version,omitempty"`
}

type UpgradeResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

type Restarter interface {
	StartRestart(ctx context.Context, meta *session.Meta, req *RestartRequest) (*RestartResponse, error)
}

type RestartRequest struct{}

type RestartResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

type Options struct {
	AgentInstanceID string
	Version         string
	Commit          string
	BuildTime       string
	Upgrader        Upgrader
	Restarter       Restarter
}

type Service struct {
	agentInstanceID string
	version         string
	commit          string
	buildTime       string

	upgrader  Upgrader
	restarter Restarter
}

func NewService(opts Options) *Service {
	return &Service{
		agentInstanceID: strings.TrimSpace(opts.AgentInstanceID),
		version:         strings.TrimSpace(opts.Version),
		commit:          strings.TrimSpace(opts.Commit),
		buildTime:       strings.TrimSpace(opts.BuildTime),
		upgrader:        opts.Upgrader,
		restarter:       opts.Restarter,
	}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	if s == nil || r == nil {
		return
	}

	rpctyped.Register[pingReq, pingResp](r, TypeID_SYS_PING, func(_ctx context.Context, _ *pingReq) (*pingResp, error) {
		return &pingResp{
			ServerTimeMs:    time.Now().UnixMilli(),
			AgentInstanceID: s.agentInstanceID,
			Version:         s.version,
			Commit:          s.commit,
			BuildTime:       s.buildTime,
		}, nil
	})

	rpctyped.Register[UpgradeRequest, UpgradeResponse](r, TypeID_SYS_UPGRADE, func(ctx context.Context, req *UpgradeRequest) (*UpgradeResponse, error) {
		if meta == nil || !meta.CanAdmin {
			return nil, &rpc.Error{Code: 403, Message: "admin permission denied"}
		}
		if s.upgrader == nil {
			return nil, &rpc.Error{Code: 501, Message: "upgrade not supported"}
		}
		if req == nil {
			req = &UpgradeRequest{}
		}
		return s.upgrader.StartUpgrade(ctx, meta, req)
	})

	rpctyped.Register[RestartRequest, RestartResponse](r, TypeID_SYS_RESTART, func(ctx context.Context, req *RestartRequest) (*RestartResponse, error) {
		if meta == nil || !meta.CanAdmin {
			return nil, &rpc.Error{Code: 403, Message: "admin permission denied"}
		}
		if s.restarter == nil {
			return nil, &rpc.Error{Code: 501, Message: "restart not supported"}
		}
		if req == nil {
			req = &RestartRequest{}
		}
		return s.restarter.StartRestart(ctx, meta, req)
	})
}

type pingReq struct{}

type pingResp struct {
	ServerTimeMs    int64  `json:"server_time_ms,omitempty"`
	AgentInstanceID string `json:"agent_instance_id,omitempty"`
	Version         string `json:"version,omitempty"`
	Commit          string `json:"commit,omitempty"`
	BuildTime       string `json:"build_time,omitempty"`
}
