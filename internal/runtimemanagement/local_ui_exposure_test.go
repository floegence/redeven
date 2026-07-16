package runtimemanagement

import "testing"

func TestLocalUIExposureValidate(t *testing.T) {
	t.Parallel()

	if err := NewLocalUIExposure(false, false).Validate(); err != nil {
		t.Fatalf("loopback exposure validation failed: %v", err)
	}
	if err := NewLocalUIExposure(true, true).Validate(); err != nil {
		t.Fatalf("network exposure validation failed: %v", err)
	}
	if err := NewLocalUIExposure(true, false).Validate(); err == nil {
		t.Fatal("network exposure without password was accepted")
	}
}
