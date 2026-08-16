package agent

import (
	"context"
	"errors"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessrpc"
	"github.com/floegence/redeven/internal/fs"
	"github.com/floegence/redeven/internal/gitrepo"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

// remoteSessionPlan is prepared before Connect so every inbound client RPC is
// present in ConnectorOptions.RPCHandlers. Stream serving starts only after a
// session exists and is kept separate from the frozen RPC registry.
type remoteSessionPlan struct {
	rpc     *flowersec.RPCHandlers
	streams *flowersec.StreamHandlers
	cleanup func()
}

func (a *Agent) prepareRemoteSessionPlan(meta *session.Meta) (*remoteSessionPlan, error) {
	if a == nil || meta == nil {
		return nil, errors.New("invalid remote session plan")
	}
	streams, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{OnError: func(err error) {
		if err != nil && a.log != nil {
			a.log.Warn("agent stream error", "channel_id", meta.ChannelID, "floe_app", meta.FloeApp, "error", err)
		}
	}})
	if err != nil {
		return nil, err
	}
	rpc := flowersec.NewRPCHandlers()
	router := sessionrpc.NewRouter()
	var fsSvc *fs.Service
	var gitRepoSvc *gitrepo.Service
	if a.filesystemScope != nil && a.gitRuntime != nil {
		fsSvc = fs.NewServiceWithCoordinator(a.filesystemScope, a.gitRuntime)
		gitRepoSvc = gitrepo.NewServiceWithScopeAndRuntime(a.filesystemScope, a.gitRuntime)
	}
	cleanups := make([]func(), 0, 4)
	if gitRepoSvc != nil {
		cleanups = append(cleanups, gitRepoSvc.Close)
	}
	cleanup := func() {
		for i := len(cleanups) - 1; i >= 0; i-- {
			cleanups[i]()
		}
	}

	accessrpc.New(a.accessGate).Register(router, meta)
	if a.sys != nil {
		a.sys.RegisterWithAccessGate(router, meta, a.accessGate)
	}
	if fsSvc != nil {
		fsSvc.RegisterWithAccessGate(router, meta, a.accessGate)
	}
	if gitRepoSvc != nil {
		gitRepoSvc.RegisterWithAccessGate(router, meta, a.accessGate)
	}
	if a.mon != nil {
		a.mon.RegisterWithAccessGate(router, meta, a.accessGate)
	}
	a.registerSessionsRPCWithAccessGate(router, meta, a.accessGate)
	cleanups = append(cleanups, a.registerAISessionRPC(router, meta, nil))
	if a.term != nil {
		// Inbound terminal RPC handlers must exist before Connect freezes the
		// registry. The outbound notification sink is attached to the real peer
		// after Connect so its initial metadata replay cannot be lost.
		cleanups = append(cleanups, a.term.RegisterWithAccessGate(router, meta, nil, a.accessGate))
	}
	if err := router.Bind(rpc); err != nil {
		cleanup()
		return nil, err
	}
	if fsSvc != nil {
		if err := streams.HandleStream("fs/read_file", func(ctx context.Context, incoming flowersec.IncomingStream) error {
			if incoming.Stream == nil {
				return errors.New("missing read-file stream")
			}
			fsSvc.ServeReadFileStreamWithAccessGate(ctx, incoming.Stream, meta, a.accessGate)
			return nil
		}); err != nil {
			cleanup()
			return nil, err
		}
	}
	if a.term != nil {
		if err := streams.HandleStream(livev1.StreamKind, a.terminalLiveStreamHandler(meta)); err != nil {
			cleanup()
			return nil, err
		}
	}
	return &remoteSessionPlan{rpc: rpc, streams: streams, cleanup: cleanup}, nil
}
