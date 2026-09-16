package runtimemanagement

import "testing"

func TestLocalUIExposureValidate(t *testing.T) {
	t.Parallel()

	if err := NewLocalUIExposure("https", false, false).Validate(); err != nil {
		t.Fatalf("loopback exposure validation failed: %v", err)
	}
	if err := NewLocalUIExposure("https", true, true).Validate(); err != nil {
		t.Fatalf("network exposure validation failed: %v", err)
	}
	if err := NewLocalUIExposure("https", true, false).Validate(); err == nil {
		t.Fatal("network exposure without password was accepted")
	}
}
