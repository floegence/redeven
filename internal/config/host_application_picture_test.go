package config

import (
	"path/filepath"
	"testing"
)

func TestHostApplicationPictureAcceptsOnlyPublishedModesAndLimits(t *testing.T) {
	for _, mode := range []string{"auto", "clarity", "smooth", "data"} {
		for _, dimension := range []int{0, 1600, 1920, 2560, 3840, 4096} {
			for _, rate := range []int{0, 15, 24, 30, 60} {
				if err := (HostApplicationPicture{Mode: mode, MaxDimension: dimension, FrameRate: rate}).Validate(); err != nil {
					t.Fatalf("valid preference rejected: %s/%d/%d: %v", mode, dimension, rate, err)
				}
			}
		}
	}
	for _, value := range []HostApplicationPicture{
		{}, {Mode: "automatic"}, {Mode: "AUTO"}, {Mode: "auto", MaxDimension: -1},
		{Mode: "auto", MaxDimension: 1921}, {Mode: "auto", FrameRate: -1}, {Mode: "auto", FrameRate: 120},
	} {
		if err := value.Validate(); err == nil {
			t.Fatalf("invalid preference accepted: %+v", value)
		}
	}
}

func TestHostApplicationPictureConfigurationPreservesEachOwnerOnRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	alice := HostApplicationPicture{Mode: "clarity", MaxDimension: 2560, FrameRate: 30}
	bob := HostApplicationPicture{Mode: "data", MaxDimension: 1600, FrameRate: 15}
	cfg := &Config{HostApplicationPictures: map[string]HostApplicationPicture{"alice": alice, "bob": bob}}
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.HostApplicationPictures) != 2 || loaded.HostApplicationPictures["alice"] != alice || loaded.HostApplicationPictures["bob"] != bob {
		t.Fatalf("preferences changed on restart: %+v", loaded.HostApplicationPictures)
	}
	for _, pictures := range []map[string]HostApplicationPicture{
		{"": alice}, {"   ": alice}, {"alice": {Mode: "invalid"}},
	} {
		if err := (&Config{HostApplicationPictures: pictures}).ValidateLocalMinimal(); err == nil {
			t.Fatalf("invalid owner configuration admitted: %+v", pictures)
		}
	}
}
