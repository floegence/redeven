package processenv

import (
	"reflect"
	"testing"
)

func TestFilterRemovesRuntimeStartupSecrets(t *testing.T) {
	input := []string{
		"PATH=/usr/bin",
		"REDEVEN_LOCAL_UI_PASSWORD=password-secret",
		"REDEVEN_BOOTSTRAP_TICKET=ticket-secret",
		"redeven_desktop_bootstrap_ticket=legacy-ticket",
		"HOME=/Users/tester",
	}
	want := []string{"PATH=/usr/bin", "HOME=/Users/tester"}
	if got := Filter(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("Filter() = %#v, want %#v", got, want)
	}
}
