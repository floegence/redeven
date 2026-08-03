package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v3/identity"
)

type floretReadCapabilities struct {
	thread    floretThreadReadHostFactory
	inventory floretRootThreadInventory
	subagent  floretSubagentReadHostFactory
}

func (c *floretReadCapabilities) listRootThreads(ctx context.Context, request floretListRootThreadsRequest) (floretRootThreadsPage, error) {
	if c == nil || c.inventory == nil {
		return floretRootThreadsPage{}, errors.New("Floret root thread inventory capability is unavailable")
	}
	return c.inventory.ListRootThreads(ctxOrBackground(ctx), request)
}

func (c *floretReadCapabilities) openThread(ctx context.Context, threadID string) (floretThreadReadHost, error) {
	if c == nil || c.thread == nil {
		return nil, errors.New("Floret thread read capability is unavailable")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("Floret thread read identity is incomplete")
	}
	return c.thread(ctxOrBackground(ctx), identity.ThreadID(threadID))
}

func (c *floretReadCapabilities) openSubagent(ctx context.Context, parentThreadID string) (floretSubagentReadHost, error) {
	if c == nil || c.subagent == nil {
		return nil, errors.New("Floret SubAgent read capability is unavailable")
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	if parentThreadID == "" {
		return nil, errors.New("Floret SubAgent read identity is incomplete")
	}
	return c.subagent(ctxOrBackground(ctx), identity.ThreadID(parentThreadID))
}

type floretRuntimeCapabilityIssuer struct {
	bind floretThreadRuntimeBinder
}

func (i *floretRuntimeCapabilityIssuer) bindThread(threadID string) (floretThreadRuntimeCapabilities, error) {
	if i == nil || i.bind == nil {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime capability issuer is unavailable")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime authority identity is incomplete")
	}
	return i.bind(identity.ThreadID(threadID))
}
