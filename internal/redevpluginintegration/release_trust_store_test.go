package redevpluginintegration

import (
	"errors"
	"slices"
	"testing"

	"github.com/floegence/redevplugin/pkg/releasetrust"
)

func TestTrustedTimeConsistencyUsesCommittedCheckpointSize(t *testing.T) {
	leaves := [][]byte{
		trustMerkleLeafHash([]byte("committed")),
		trustMerkleLeafHash([]byte("orphan")),
		trustMerkleLeafHash([]byte("next")),
	}

	initial, err := trustedTimeConsistencyProof(leaves, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(initial) != 0 {
		t.Fatalf("initial consistency proof = %v, want empty proof", initial)
	}

	advanced, err := trustedTimeConsistencyProof(leaves, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := trustEncodeProof(trustMerkleConsistencyProof(leaves, 1))
	if len(advanced) == 0 || !slices.Equal(advanced, want) {
		t.Fatalf("advanced consistency proof = %v, want %v", advanced, want)
	}
}

func TestTrustedTimeConsistencyRejectsCheckpointBeyondLocalLog(t *testing.T) {
	leavesWithNext := [][]byte{trustMerkleLeafHash([]byte("next"))}
	if _, err := trustedTimeConsistencyProof(leavesWithNext, 1); !errors.Is(err, releasetrust.ErrInvalidTrustedTimeRequest) {
		t.Fatalf("trustedTimeConsistencyProof() error = %v, want ErrInvalidTrustedTimeRequest", err)
	}
}
