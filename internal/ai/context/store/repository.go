package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Repository stores product provider capability metadata only. Conversation
// context is owned and assembled by Floret.
type Repository struct {
	db *threadstore.Store
}

func NewRepository(db *threadstore.Store) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Ready() bool {
	return r != nil && r.db != nil
}

func (r *Repository) UpsertCapability(ctx context.Context, capability model.ModelCapability) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	payload, err := json.Marshal(capability)
	if err != nil {
		return err
	}
	return r.db.UpsertProviderCapability(ctx, threadstore.ProviderCapabilityRecord{
		ProviderID: strings.TrimSpace(capability.ProviderID), ModelName: strings.TrimSpace(capability.ModelName), CapabilityJSON: string(payload),
	})
}

func (r *Repository) GetCapability(ctx context.Context, providerID string, modelName string) (model.ModelCapability, bool, error) {
	if !r.Ready() {
		return model.ModelCapability{}, false, errors.New("repository not ready")
	}
	rec, err := r.db.GetProviderCapability(ctx, providerID, modelName)
	if err != nil || rec == nil {
		return model.ModelCapability{}, false, err
	}
	var capability model.ModelCapability
	if err := json.Unmarshal([]byte(rec.CapabilityJSON), &capability); err != nil {
		return model.ModelCapability{}, false, err
	}
	capability.ProviderID = strings.TrimSpace(providerID)
	capability.ModelName = strings.TrimSpace(modelName)
	return model.NormalizeCapability(capability), true, nil
}
