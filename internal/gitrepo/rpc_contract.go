package gitrepo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	maxWorkspacePathStatusPaths       = 64
	maxWorkspacePathStatusPathBytes   = 128 << 10
	maxWorkspacePathStatusWirePayload = 736 << 10
	maxWorkspaceBusinessPayload       = 700 << 10
)

func workspaceBusinessResponseFits(value any) bool {
	_, err := gitruntime.JSONEncodedSize(value, maxWorkspaceBusinessPayload)
	return err == nil
}

const (
	GitErrorWorkspaceSnapshotStale        uint32 = 40901
	GitErrorWorkspaceInventoryLimit       uint32 = 41301
	GitErrorWorkspaceResponseBudget       uint32 = 41302
	GitErrorWorkspacePaginationRequired   uint32 = 41303
	GitErrorDestructiveWorkspaceScanLimit uint32 = 41304
	GitErrorResponseBudget                uint32 = 41305
	GitErrorResourceLimit                 uint32 = 41306
	GitErrorRequestBudget                 uint32 = 41307
	GitErrorWorkspacePathEncoding         uint32 = 42201
)

func registerGitTyped[TReq any, TResp any](
	router *sessionrpc.Router,
	typeID uint32,
	runtime *gitruntime.Runtime,
	gate *accessgate.Gate,
	meta *session.Meta,
	policy accessgate.RPCAccessPolicy,
	handler func(context.Context, *TReq) (*TResp, error),
) {
	gitruntime.RegisterTyped(
		router,
		typeID,
		runtime,
		gitruntime.DefaultRPCSpec[TReq, TResp](),
		gate,
		meta,
		policy,
		handler,
	)
}

func registerGitPathStatusTyped(
	router *sessionrpc.Router,
	runtime *gitruntime.Runtime,
	gate *accessgate.Gate,
	meta *session.Meta,
	handler func(context.Context, *listWorkspacePathStatusesReq) (*listWorkspacePathStatusesResp, error),
) {
	spec := gitruntime.DefaultRPCSpec[listWorkspacePathStatusesReq, listWorkspacePathStatusesResp]()
	spec.Request.Validate = func(req *listWorkspacePathStatusesReq) error {
		if req == nil || len(req.Paths) > maxWorkspacePathStatusPaths {
			return errors.New("workspace path status request exceeds path limit")
		}
		pathBytes := 0
		for _, pathValue := range req.Paths {
			pathBytes += len(pathValue)
			if pathBytes > maxWorkspacePathStatusPathBytes {
				return errors.New("workspace path status request exceeds path byte limit")
			}
		}
		encoded, err := json.Marshal(req)
		if err != nil || len(encoded) > maxWorkspacePathStatusWirePayload {
			return errors.New("workspace path status request exceeds wire limit")
		}
		return nil
	}
	gitruntime.RegisterTyped(
		router,
		TypeID_GIT_LIST_PATH_STATUSES,
		runtime,
		spec,
		gate,
		meta,
		accessgate.RPCAccessProtected,
		handler,
	)
}
