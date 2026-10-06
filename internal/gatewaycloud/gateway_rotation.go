package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaystate"
	"time"
)

func (g *Gateway) rotateMachineKey(ctx context.Context, identity Identity) error {
	g.mu.Lock()
	if g.config.PendingPrivateKeyB64u == "" && g.config.KeyRotatedAtUnixMS > time.Now().Add(-30*24*time.Hour).UnixMilli() {
		g.mu.Unlock()
		return nil
	}
	if g.config.PendingPrivateKeyB64u == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			g.mu.Unlock()
			return err
		}
		g.config.PendingPrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
		if err := gatewaystate.Write(g.path, g.config); err != nil {
			g.mu.Unlock()
			return err
		}
	}
	pending := g.config.PendingPrivateKeyB64u
	g.mu.Unlock()
	key, err := gc.DecodeKey(pending)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return ErrState
	}
	if err := g.client.RotateKey(ctx, identity, ed25519.PrivateKey(key)); err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.config.PrivateKeyB64u = pending
	g.config.PendingPrivateKeyB64u = ""
	g.config.KeyRotatedAtUnixMS = time.Now().UnixMilli()
	return gatewaystate.Write(g.path, g.config)
}
